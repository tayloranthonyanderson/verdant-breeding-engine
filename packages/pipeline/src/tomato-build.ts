// Build a contract-valid ResultBundle for ONE data cut of the synthetic tomato program, and persist
// it tagged with the cut descriptor so the web tier can load "the analysis of this cut" (ADR-0023,
// docs/sim-corpus-spec.md). The cut model (which trials, broad vs narrow) lives in tomato-corpus.ts;
// this module is the analysis: pool the cut's plots → multi-trait AI-REML (the same crop-agnostic
// BLUPF90 engine the G2F MET path uses) → transparent + genetically-aware index for the market →
// bundle. The prediction (broad) and advancement (narrow) cuts run through the identical analysis;
// only the data scope differs — which is the whole point.
//
// Run (build + persist every canonical cut):  pnpm --filter @verdant/pipeline exec tsx src/tomato-build.ts
import { eq, desc, and } from 'drizzle-orm';
import { db, program, study, analysisRun, resultBundle } from '@verdant/db';
import { validateResultBundle, type ResultBundle, type AnalysisRequest } from '@verdant/contracts';
import { estimateGeneticCovariance } from './blupf90';
import { runRKernel } from './kernel';
import { isEntrypoint } from './entry';
import { runPlanner, type ModelPlan } from './planner';
import { attachPlotIds, runDataQuality, runModelQc, mergeTraitDiagnostics, boundaryFlags } from './data-quality-build';
import { assembleCut, assembleCustom, listCuts, cutById, loadManifest, type Cut, type CutDef, type AssembledCut } from './tomato-corpus';

const PROGRAM = 'Verdant tomato (synthetic)';

/** Transparent weighted index for a market's signed weights (negative weight = minimise the trait). */
function transparentIndex(
  traits: string[],
  blups: Map<string, Array<number | null>>,
  weights: Record<string, number>,
): NonNullable<ResultBundle['indices']>[number] {
  const genos = [...blups.keys()];
  const z: number[][] = traits.map((_, j) => {
    const vals = genos.map((g) => blups.get(g)![j]).filter((v): v is number => v != null);
    const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / ((vals.length - 1) || 1)) || 1;
    return genos.map((g) => { const v = blups.get(g)![j]; return v == null ? 0 : (v - mean) / sd; });
  });
  const entries = Object.entries(weights);
  const totalW = entries.reduce((a, [, w]) => a + Math.abs(w), 0) || 1;
  const contrib: number[] = genos.map(() => 0);
  for (const [tr, w] of entries) {
    const j = traits.indexOf(tr);
    if (j < 0) continue;
    const merit = z[j].map((zz) => (w < 0 ? -zz : zz));
    const mean = merit.reduce((a, b) => a + b, 0) / (merit.length || 1);
    const sd = Math.sqrt(merit.reduce((a, b) => a + (b - mean) ** 2, 0) / ((merit.length - 1) || 1)) || 1;
    merit.forEach((mm, i) => { contrib[i] += ((mm - mean) / sd) * (Math.abs(w) / totalW); });
  }
  const ranking = genos
    .map((g, i) => ({ germplasm_id: g, score: Number(contrib[i].toFixed(5)) }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ germplasm_id: r.germplasm_id, rank: i + 1, score: r.score, gated_out: false, gate_failures: [] }));
  return {
    kind: 'weighted', segment_id: null, ranking,
    weights_used: entries.map(([variable_id, w]) => ({ variable_id, mode: (w < 0 ? 'min' : 'max') as 'min' | 'max', direction: (w < 0 ? -1 : 1) as 1 | -1, weight: Math.abs(w) })),
  };
}

/** Genetically-aware desired-gains index + divergence (R science layer). Desired gains are the
 *  market's signed weights read as genetic-sd targets — so the index accounts for how traits co-inherit. */
function geneticIndex(
  traits: string[], G: number[][], germplasmIds: string[], blups: Array<Array<number | null>>,
  weights: Record<string, number>, transparentRanking: Array<{ germplasm_id: string; rank: number }>,
) {
  const desiredGains = traits.map((t) => weights[t] ?? 0);
  return runRKernel<{ index: NonNullable<ResultBundle['indices']>[number]; divergence: ResultBundle['divergence'] }>(
    'select-index.R',
    { variable_ids: traits, genetic_covariance: G, germplasm_ids: germplasmIds, blups, desired_gains: desiredGains,
      transparent_ranking: transparentRanking.map((r) => ({ germplasm_id: r.germplasm_id, rank: r.rank })) },
  );
}

/** chosen_model from the planner's resolved plan (the decision log + overridable factors the Model
 *  step renders) — generic strings, no maize assumptions. */
function chosenModel(plan: ModelPlan, engine: string, cut: Cut, composition: AssembledCut['composition'], fittedGxe: boolean): ResultBundle['chosen_model'] {
  const scope = cut.purpose === 'prediction'
    ? `the broad prediction cut (${composition.n_trials} trials across stages ${composition.stages.join('–')} / years ${composition.years.join('/')}, ${composition.n_geno} genotypes)`
    : `the narrow advancement cut (${composition.n_geno} entries at the latest stage)`;
  return {
    description: `Single-stage multi-trait AI-REML on ${scope}${fittedGxe ? ' with a genotype×environment term' : ''}; genotype random (BLUPs).`,
    formula: `trait ~ environment + genotype(random)${fittedGxe ? ' + genotype:environment(random)' : ''}`,
    genotype_effect: 'random',
    spatial_method: plan.spatial_method,
    relationship: plan.relationship as 'identity' | 'A' | 'G' | 'H',
    engine,
    rationale: plan.decisions.find((d) => d.factor === 'staging')?.reason ?? '',
    model_class: plan.model_class,
    staging_weighted: plan.staging_weighted,
    // Reflect what was actually FIT: GxE is recommended by structure but not fitted (a pooled cut's
    // early-stage founders sit in a single environment → a genotype×environment term isn't stably
    // estimable; fitting it is non-convergent). Keep the planner's recommendation visible.
    decisions: plan.decisions.map((d) => d.factor === 'gxe'
      ? { ...d, choice: 'skip', recommended: d.recommended ?? (d as { choice?: string }).choice ?? 'include', feasible: false,
          reason: 'Recommended by structure, but a pooled cut spans stages where early founders appear in a single environment — a genotype×environment term is not stably estimable here, so the fit uses phenotypic BLUPs.' }
      : d),
    overridable: plan.overridable,
  };
}

/** Fit the cut and assemble a FULL contract-valid bundle (no persist): pre-fit data quality, the
 *  planner's model decisions + readiness, the multi-trait fit (+ GxE when estimable), one index per
 *  market the cut touches (the Select-step switcher), and post-fit model-QC diagnostics. */
export function buildCutBundle(assembled: AssembledCut): ResultBundle {
  const { cut, traits, records, composition, trials, relevantMarkets } = assembled;
  const qcRecords = attachPlotIds(records);

  // Pre-fit data quality (ADR-0021) — crop-agnostic; the grid checks no-op with null row/col.
  let dataQuality: ResultBundle['data_quality'] = null;
  try { dataQuality = runDataQuality(qcRecords, traits); } catch (e) { console.log(`data_quality skipped: ${(e as Error).message}`); }

  // Planner (ADR-0016) — the model decisions + readiness the Model step renders. Generic: with no field
  // grid it returns spatial='none' (single-stage), and GxE only when the cut's connectivity supports it.
  const { plan, readiness } = runPlanner(traits, records);

  // Multi-trait fit. GxE is NOT fitted: a pooled cut is severely unbalanced (early-stage founders sit
  // in a single environment), so a genotype×environment term is non-estimable / unstable. The planner
  // still REPORTS its GxE stance in the decision log (chosen_model.decisions) — recommendation vs what's
  // safely fittable here — but the fit stays phenotypic BLUPs.
  const g = estimateGeneticCovariance({ variableIds: traits, rows: records });
  const blupMap = new Map(g.blups.map((b) => [b.genotype, b.values]));
  const genos = g.blups.map((b) => b.genotype);

  // One transparent + genetically-aware index PER market the cut touches (one fit, many lenses); the
  // Select-step target-market switcher flips between them (ADR-0023).
  const indices: NonNullable<ResultBundle['indices']> = [];
  let divergence: ResultBundle['divergence'] = null;
  for (const mk of relevantMarkets) {
    const t = transparentIndex(traits, blupMap, mk.weights); t.segment_id = mk.id;
    const gi = geneticIndex(traits, g.geneticCovariance, genos, genos.map((gn) => blupMap.get(gn)!), mk.weights, t.ranking);
    gi.index.segment_id = mk.id;
    indices.push(t, gi.index);
    if (divergence == null || mk.id === cut.market) divergence = gi.divergence;
  }

  // Post-fit model QC — residuals reconstructed from the BLUPs (no Stage-1 on tomato).
  const blupsByTrait: Record<string, Record<string, number>> = {};
  traits.forEach((id, j) => { const mp: Record<string, number> = {}; for (const b of g.blups) if (b.values[j] != null) mp[b.genotype] = b.values[j] as number; blupsByTrait[id] = mp; });
  let modelQc: ReturnType<typeof runModelQc> = {};
  try { modelQc = runModelQc(qcRecords, traits, blupsByTrait); } catch { /* best-effort */ }

  const Ve = g.residualCovariance.map((r, i) => r[i]);
  const bundleTraits: ResultBundle['traits'] = traits.map((id, j) => {
    const vg = g.geneticVariances[j]; const ve = Ve[j];
    const nObs = records.filter((r) => r.values[j] != null).length;
    return {
      variable_id: id, status: 'ok',
      effects: g.blups.map((b) => ({ germplasm_id: b.genotype, value: b.values[j], type: 'BLUP' as const })),
      heritability: { method: 'standard', value: vg + ve > 0 ? Number((vg / (vg + ve)).toFixed(4)) : null },
      genetic_sd: Number(Math.sqrt(Math.max(vg, 0)).toFixed(6)),
      varcomp: [
        { component: 'genotype', variance: Number(vg.toFixed(6)) },
        { component: 'residual', variance: Number(ve.toFixed(6)) },
      ],
      diagnostics: mergeTraitDiagnostics({ converged: g.converged, n_genotypes: g.blups.length, n_obs: nObs }, modelQc[id], boundaryFlags(vg, 0, ve)),
      warnings: [],
    };
  });

  const broad = cut.purpose === 'prediction';
  const warnings: ResultBundle['warnings'] = [];
  if (broad) warnings.push({ code: 'cut_pools_stages', message: `This prediction cut pools ${composition.n_trials} trials across stages ${composition.stages.join('+')} and years ${composition.years.join('+')}, connected by ${composition.n_checks} common checks. Including the early-stage records the selection used de-biases the variance components.`, severity: 'info' });
  else warnings.push({ code: 'cut_is_narrow', message: `This advancement cut is the latest-stage decision set (${composition.n_geno} entries); variance components from so few lines are less precise than the broad prediction cut.`, severity: 'info' });
  if (!plan.gxe.include) warnings.push({ code: 'gxe_not_separated', message: plan.gxe.reason, severity: 'info' });

  const bundle: ResultBundle = {
    contract_version: 'v0', status: 'ok', intent: broad ? 'prediction' : 'selection',
    chosen_model: chosenModel(plan, g.engine, cut, composition, false),
    traits: bundleTraits,
    genetic_correlations: { variable_ids: traits, matrix: g.geneticCorrelation },
    gxe: null,
    data_readiness: {
      scale: readiness.scale, connectivity: readiness.connectivity, replication: readiness.replication,
      grids: readiness.grids, unlocks: plan.unlocks,
      // The cut descriptor — what data this analysis was run on (ADR-0023 provenance) + n_checks.
      cut: { id: cut.id, purpose: cut.purpose, market: cut.market, market_label: cut.market_label, tpe: cut.tpe,
        label: cut.label, custom: cut.custom ?? false, n_checks: composition.n_checks, trial_ids: trials.map((tt) => tt.trial_id),
        trials: trials.map((tt) => ({ trial_id: tt.trial_id, stage: tt.stage, year: tt.year, market_tag: tt.market_tag, n_entries: tt.n_entries, n_loc: tt.n_loc })),
        stages: composition.stages, years: composition.years },
    } as unknown as ResultBundle['data_readiness'],
    data_quality: dataQuality ?? null,
    indices,
    divergence,
    warnings,
    provenance: { contract_version: 'v0', engine_versions: { blupf90: g.engine }, source: 'tomato-sim-corpus' } as ResultBundle['provenance'],
  };
  return validateResultBundle(bundle);
}

async function tomatoStudyId(cut: Cut, source: string): Promise<{ programId: number; studyId: number }> {
  await db.insert(program).values({ name: PROGRAM }).onConflictDoNothing();
  const [prog] = await db.select().from(program).where(eq(program.name, PROGRAM));
  // One study per cut (name = cut.id) so getCutResult can find the latest bundle for a cut. source
  // distinguishes the built-in templates ('sim') from breeder-saved presets ('tomato-cut').
  await db.insert(study).values({ programId: prog.id, name: cut.id, fieldLocation: cut.label, year: 2025, source }).onConflictDoNothing();
  const [s] = await db.select().from(study).where(and(eq(study.programId, prog.id), eq(study.name, cut.id)));
  return { programId: prog.id, studyId: s.id };
}

export async function persistCutBundle(cut: Cut, bundle: ResultBundle, source = 'sim'): Promise<number> {
  const { programId, studyId } = await tomatoStudyId(cut, source);
  const request: AnalysisRequest = {
    contract_version: 'v0', analysis_request_id: cut.id, intent: bundle.intent,
    variables: bundle.traits.map((t) => ({ variable_id: t.variable_id, name: t.variable_id, data_type: 'numeric' as const })) as AnalysisRequest['variables'],
    observation_units: [{ observation_unit_id: cut.id, germplasm_id: 'g' }] as AnalysisRequest['observation_units'],
    observations: [], relationship: { type: 'identity' },
  };
  const [run] = await db.insert(analysisRun).values({ programId, studyId, intent: bundle.intent, status: 'ok', contractVersion: 'v0', request, finishedAt: new Date() }).returning({ id: analysisRun.id });
  await db.insert(resultBundle).values({ analysisRunId: run.id, contractVersion: 'v0', bundle });
  return run.id;
}

/** Build (and optionally persist) one built-in template cut by id — the Server Action's re-run path. */
export async function runTomatoCut(cutId: string, opts: { persist?: boolean } = {}): Promise<{ bundle: ResultBundle; analysisRunId: number | null }> {
  const cut = cutById(cutId);
  if (!cut) throw new Error(`unknown tomato cut: ${cutId}`);
  const assembled = assembleCut(cut);
  const bundle = buildCutBundle(assembled);
  const analysisRunId = (opts.persist ?? true) ? await persistCutBundle(cut, bundle) : null;
  return { bundle, analysisRunId };
}

/** Build + persist a BREEDER-DEFINED cut (a saved preset): fit the hand-picked trials and store it as
 *  its own re-runnable study (source='tomato-cut'). Returns the cut id the page loads by. */
export async function buildCustomCut(def: CutDef): Promise<{ cutId: string; analysisRunId: number }> {
  const assembled = assembleCustom(def);
  const bundle = buildCutBundle(assembled);
  const analysisRunId = await persistCutBundle(assembled.cut, bundle, 'tomato-cut');
  return { cutId: def.id, analysisRunId };
}

async function cli() {
  loadManifest();
  const cuts = listCuts();
  console.log(`building ${cuts.length} tomato cuts ...`);
  for (const cut of cuts) {
    const t0 = Date.now();
    const { analysisRunId } = await runTomatoCut(cut.id, { persist: true });
    console.log(`  ${cut.id.padEnd(24)} → run ${analysisRunId} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  await db.$client.end();
}

if (isEntrypoint(import.meta.url)) cli().catch((e) => { console.error(e); process.exit(1); });
