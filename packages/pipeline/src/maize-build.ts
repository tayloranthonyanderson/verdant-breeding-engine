// Build a contract-valid ResultBundle for ONE data cut of the synthetic maize program, and persist
// it tagged with the cut descriptor so the web tier can load "the analysis of this cut" (ADR-0023,
// docs/sim-corpus-spec.md). The cut model (which trials, broad vs narrow) lives in maize-corpus.ts;
// this module is the analysis: pool the cut's plots → multi-trait AI-REML (the same crop-agnostic
// BLUPF90 engine the G2F MET path uses) → transparent + genetically-aware index for the market →
// bundle. The prediction (broad) and advancement (narrow) cuts run through the identical analysis;
// only the data scope differs — which is the whole point.
//
// Run (build + persist every canonical cut):  pnpm --filter @verdant/pipeline exec tsx src/maize-build.ts
import { eq, desc, and } from 'drizzle-orm';
import { db, program, study, analysisRun, resultBundle } from '@verdant/db';
import { validateResultBundle, type ResultBundle, type AnalysisRequest } from '@verdant/contracts';
import { estimateGeneticCovariance } from './blupf90';
import { spatialStage1 } from './stage1';
import { buildGenomicBlock, markerReadiness } from './maize-genomic';
import { buildMaizeCombiningAbility, cutHasCrosses } from './maize-combining-ability';
import { runRKernel } from './kernel';
import { isEntrypoint } from './entry';
import { runPlanner, type ModelPlan, type ModelOverrides } from './planner';
import { attachPlotIds, applyDataOverrides, runDataQuality, runModelQc, mergeTraitDiagnostics, boundaryFlags } from './data-quality-build';
import { assembleCut, assembleCustom, listCuts, cutById, loadManifest, type Cut, type CutDef, type AssembledCut } from './maize-corpus';

const PROGRAM = 'Verdant maize (synthetic)';

/** Pre-fit setup for a cut: the breeder reviews these BEFORE pressing Run (ADR-0021/0016). */
export type CutExclusions = NonNullable<AnalysisRequest['data_overrides']>['exclusions'];
export interface CutRunOpts { overrides?: ModelOverrides; exclusions?: CutExclusions }
export interface CutPreview {
  composition: AssembledCut['composition'];
  data_quality: ResultBundle['data_quality'];
  chosen_model: ResultBundle['chosen_model'];
  data_readiness: ResultBundle['data_readiness'];
  removed: number; // plot rows dropped by the exclusion overlay
}

/** The shared pre-fit pass: attach ids → apply the exclusion overlay → data quality + the planner's
 *  model plan + readiness. No BLUP fit — cheap, so the Data + Model steps can show it live. */
function prefit(assembled: AssembledCut, opts: CutRunOpts) {
  const { traits } = assembled;
  const all = attachPlotIds(assembled.records);
  const applied = applyDataOverrides(all, opts.exclusions ?? []);
  const recs = applied.records;
  let dataQuality: ResultBundle['data_quality'] = null;
  try { dataQuality = runDataQuality(recs, traits); } catch (e) { console.log(`data_quality skipped: ${(e as Error).message}`); }
  // Tell the planner markers exist for this cohort so it offers relationship=G and the genomic engine
  // choice (rrBLUP vs native BLUPF90). The plot structure can't see markers — the driver supplies it.
  const genomicReadiness = markerReadiness(assembled.germplasm);
  const { plan, readiness } = runPlanner(traits, recs, { overrides: opts.overrides, genomic: genomicReadiness });
  return { recs, applied, dataQuality, plan, readiness };
}

/** Build the data_readiness block (planner readiness + the cut descriptor) — shared by preview + fit. */
function readinessBlock(assembled: AssembledCut, readiness: { scale: unknown; connectivity: unknown; replication: unknown; grids: unknown }, plan: ModelPlan): ResultBundle['data_readiness'] {
  const { cut, composition, trials } = assembled;
  return {
    scale: readiness.scale, connectivity: readiness.connectivity, replication: readiness.replication,
    grids: readiness.grids, unlocks: plan.unlocks,
    cut: { id: cut.id, purpose: cut.purpose, market: cut.market, market_label: cut.market_label, tpe: cut.tpe,
      label: cut.label, custom: cut.custom ?? false, n_testers: composition.n_testers, trial_ids: trials.map((tt) => tt.trial_id),
      trials: trials.map((tt) => ({ trial_id: tt.trial_id, stage: tt.stage, year: tt.year, market_tag: tt.market_tag, n_entries: tt.n_entries, n_loc: tt.n_loc })),
      stages: composition.stages, years: composition.years },
  } as unknown as ResultBundle['data_readiness'];
}

/** Pre-fit PREVIEW (no BLUP): data quality + the planner's recommended model, for review before Run. */
export function previewCut(assembled: AssembledCut, opts: CutRunOpts = {}): CutPreview {
  const { plan, readiness, dataQuality, applied } = prefit(assembled, opts);
  const relationship = (opts.overrides?.relationship as 'identity' | 'A' | 'G' | 'H' | undefined) ?? 'identity';
  return {
    composition: assembled.composition,
    data_quality: dataQuality ?? null,
    chosen_model: chosenModel(plan, 'blupf90+', assembled.cut, assembled.composition,
      { twoStage: opts.overrides?.spatial === 'spats', fittedGxe: opts.overrides?.gxe === 'include', relationship }),
    data_readiness: readinessBlock(assembled, readiness, plan),
    removed: applied.removed,
  };
}

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
interface Applied { twoStage: boolean; fittedGxe: boolean; relationship: 'identity' | 'A' | 'G' | 'H'; genomicEngine?: 'rrblup' | 'blupf90' }
function chosenModel(plan: ModelPlan, engine: string, cut: Cut, composition: AssembledCut['composition'], ap: Applied): ResultBundle['chosen_model'] {
  const scope = cut.purpose === 'prediction'
    ? `the broad prediction cut (${composition.n_trials} trials across stages ${composition.stages.join('–')} / years ${composition.years.join('/')}, ${composition.n_geno} genotypes)`
    : `the narrow advancement cut (${composition.n_geno} entries at the latest stage)`;
  // The decision log reports what was actually APPLIED (choice), keeping the planner's recommendation
  // visible (recommended). Spatial/GxE/genomic are breeder opt-ins (the Model Studio), default off.
  const appliedChoice = (d: ModelPlan['decisions'][number]): ModelPlan['decisions'][number] => {
    const rec = d.recommended ?? (d as { choice?: string }).choice ?? null;
    if (d.factor === 'spatial') return { ...d, choice: ap.twoStage ? 'spats' : 'none', recommended: rec, source: ap.twoStage ? 'overridden' : (d.source ?? 'recommended') };
    if (d.factor === 'staging') return { ...d, choice: ap.twoStage ? 'two_stage' : 'single_stage', recommended: rec };
    if (d.factor === 'gxe') return { ...d, choice: ap.fittedGxe ? 'include' : 'skip', recommended: rec ?? 'include', feasible: true };
    if (d.factor === 'relationship') return { ...d, choice: ap.relationship, recommended: rec };
    // The genomic engine actually used (only meaningful at relationship=G; rrBLUP is the default).
    if (d.factor === 'engine' && ap.relationship === 'G' && ap.genomicEngine)
      return { ...d, choice: ap.genomicEngine, recommended: rec ?? 'rrblup' };
    return d;
  };
  return {
    description: `${ap.twoStage ? 'Two-stage: SpATS spatial de-trending per environment, then ' : 'Single-stage '}multi-trait AI-REML on ${scope}${ap.fittedGxe ? ' with a genotype×environment term' : ''}; genotype random (BLUPs)${ap.relationship === 'G' ? `; ranked on two-step genomic GBLUP (G) breeding values (${ap.genomicEngine === 'blupf90' ? 'BLUPF90/preGSf90' : 'rrBLUP'} solver)` : ''}.`,
    formula: ap.twoStage
      ? `stage 1: trait ~ PSANOVA(col,row) + genotype(fixed) [per env];  stage 2: adjusted_mean ~ environment + genotype(random)${ap.fittedGxe ? ' + genotype:environment(random)' : ''}`
      : `trait ~ environment + genotype(random)${ap.fittedGxe ? ' + genotype:environment(random)' : ''}`,
    genotype_effect: 'random',
    spatial_method: ap.twoStage ? 'spats' : 'none',
    relationship: ap.relationship,
    engine,
    rationale: plan.decisions.find((d) => d.factor === 'staging')?.reason ?? '',
    model_class: ap.twoStage ? 'two_stage' : 'single_stage',
    staging_weighted: ap.twoStage,
    decisions: plan.decisions.map(appliedChoice),
    overridable: plan.overridable,
  };
}

/** Fit the cut and assemble a FULL contract-valid bundle (no persist): pre-fit data quality, the
 *  planner's model decisions + readiness, the multi-trait fit (+ GxE when estimable), one index per
 *  market the cut touches (the Select-step switcher), and post-fit model-QC diagnostics. */
export function buildCutBundle(assembled: AssembledCut, opts: CutRunOpts = {}): ResultBundle {
  const { cut, traits, composition, relevantMarkets } = assembled;
  // Shared pre-fit pass (data quality + planner) on the exclusion-filtered records.
  const { recs, dataQuality, plan, readiness } = prefit(assembled, opts);

  // FIT. The default is a FAST single-stage phenotypic BLUP. The more-correct, more-expensive options —
  // SpATS spatial de-trending (two-stage), GxE, genomic GRM — are breeder OPT-INS via the Model Studio
  // (the planner recommends them in the decision log; the breeder turns them on, accepting a longer run).
  const twoStage = opts.overrides?.spatial === 'spats';
  const wantGxe = opts.overrides?.gxe === 'include';
  let stage1FieldTrends: Record<string, unknown> | undefined;
  let stage1ModelQc: Record<string, unknown> | undefined;
  let fitRows: Array<{ genotype: string; environment: string; values: Array<number | null>; weights?: Array<number | null> }>;
  if (twoStage) {
    const s1 = spatialStage1(traits, recs);
    stage1FieldTrends = s1.field_trends;
    stage1ModelQc = s1.model_qc as Record<string, unknown> | undefined;
    fitRows = s1.adjusted.map((a) => ({ genotype: a.genotype, environment: a.environment, values: a.values, weights: a.weights }));
  } else {
    fitRows = recs.map((r) => ({ genotype: r.genotype, environment: r.environment, values: r.values }));
  }

  let g: ReturnType<typeof estimateGeneticCovariance> | null = null;
  let fittedGxe = false;
  if (wantGxe) {
    try { g = estimateGeneticCovariance({ variableIds: traits, rows: fitRows, interaction: true }); fittedGxe = true; }
    catch (e) { console.log(`GxE fit not estimable for this cut (${(e as Error).message}); phenotypic BLUPs`); }
  }
  if (!g) g = estimateGeneticCovariance({ variableIds: traits, rows: fitRows });
  const blupMap = new Map(g.blups.map((b) => [b.genotype, b.values]));
  const genos = g.blups.map((b) => b.genotype);

  // Genomic GRM/GBLUP — opt-in (relationship = G). Builds bundle.genomic (CV, GEBVs, PCA, GRM heatmap)
  // from markers.csv, and re-points the selection index onto the chosen genomic engine's GEBVs (rrBLUP
  // by default, native BLUPF90/preGSf90 GBLUP when engine = blupf90). Phenotypic BLUPs are the genomic
  // kernel's phenotype. Best-effort: failure leaves the phenotypic ranking intact.
  let genomic: Record<string, unknown> | null = null;
  let relationship: 'identity' | 'G' = 'identity';
  let genomicEngine: 'rrblup' | 'blupf90' = 'rrblup';
  let rankMap = blupMap; let rankGenos = genos;
  if (opts.overrides?.relationship === 'G') {
    try {
      const phenoByTrait: Record<string, Array<number | null>> = {};
      traits.forEach((id, j) => { phenoByTrait[id] = genos.map((gn) => blupMap.get(gn)![j]); });
      genomic = buildGenomicBlock({
        cohort: genos, traits, phenoByTrait,
        engine: opts.overrides?.engine ?? null,
        geneticCovariance: g.geneticCovariance, residualCovariance: g.residualCovariance,
      });
      const gbm = genomic?.gebv_by_model as Record<string, Record<string, { values: number[] }>> | undefined;
      const nat = genomic?.gebv_blupf90 as Record<string, { values: number[] }> | undefined;
      const cohort = genomic?.cohort as string[] | undefined;
      if (genomic && gbm?.genomic_G && cohort) {
        relationship = 'G';
        // BLUPF90 GEBVs when requested AND they were produced; otherwise rrBLUP (the fast default).
        const useNat = opts.overrides?.engine === 'blupf90' && !!nat;
        genomicEngine = useNat ? 'blupf90' : 'rrblup';
        const gMap = new Map<string, Array<number | null>>();
        cohort.forEach((id, i) => gMap.set(id, traits.map((tr) =>
          (useNat ? nat![tr]?.values?.[i] : gbm.genomic_G[tr]?.values?.[i]) ?? null)));
        rankMap = gMap; rankGenos = cohort;
      }
    } catch (e) { console.log(`genomic block skipped: ${(e as Error).message}`); }
  }

  // Combining-ability facet — when the cut includes an F1 testcross trial (records carry parent1/parent2),
  // decompose the hybrids into GCA (the parent selection target) + SCA. Lights up the Understand
  // combining-ability panel and the Select Parents·GCA / Hybrids switcher (incl. the marker/native gates).
  let combiningAbility: ReturnType<typeof buildMaizeCombiningAbility> = null;
  if (cutHasCrosses(assembled)) {
    try { combiningAbility = buildMaizeCombiningAbility(assembled); }
    catch (e) { console.log(`combining ability skipped: ${(e as Error).message}`); }
  }

  // One transparent + genetically-aware index PER market the cut touches (one fit, many lenses); the
  // Select-step target-market switcher flips between them (ADR-0023). Ranked on the chosen relationship's
  // breeding values (phenotypic BLUPs, or genomic_G GEBVs when relationship = G).
  const indices: NonNullable<ResultBundle['indices']> = [];
  let divergence: ResultBundle['divergence'] = null;
  for (const mk of relevantMarkets) {
    const t = transparentIndex(traits, rankMap, mk.weights); t.segment_id = mk.id;
    const gi = geneticIndex(traits, g.geneticCovariance, rankGenos, rankGenos.map((gn) => rankMap.get(gn)!), mk.weights, t.ranking);
    gi.index.segment_id = mk.id;
    indices.push(t, gi.index);
    if (divergence == null || mk.id === cut.market) divergence = gi.divergence;
  }

  // Post-fit model QC — the REAL Stage-1 spatial residuals (two-stage) or reconstructed from BLUPs.
  let modelQc: ReturnType<typeof runModelQc> = {};
  if (stage1ModelQc && Object.keys(stage1ModelQc).length) {
    modelQc = stage1ModelQc as ReturnType<typeof runModelQc>;
  } else {
    const blupsByTrait: Record<string, Record<string, number>> = {};
    traits.forEach((id, j) => { const mp: Record<string, number> = {}; for (const b of g!.blups) if (b.values[j] != null) mp[b.genotype] = b.values[j] as number; blupsByTrait[id] = mp; });
    try { modelQc = runModelQc(recs, traits, blupsByTrait); } catch { /* best-effort */ }
  }
  if (dataQuality && stage1FieldTrends && Object.keys(stage1FieldTrends).length) {
    (dataQuality as { field_trends?: unknown }).field_trends = stage1FieldTrends;
  }

  const Ve = g.residualCovariance.map((r, i) => r[i]);
  const Vge = fittedGxe ? g.gxeVariances : undefined;
  const bundleTraits: ResultBundle['traits'] = traits.map((id, j) => {
    const vg = g!.geneticVariances[j]; const vge = Vge?.[j] ?? 0; const ve = Ve[j];
    const nObs = recs.filter((r) => r.values[j] != null).length;
    return {
      variable_id: id, status: 'ok',
      effects: g!.blups.map((b) => ({ germplasm_id: b.genotype, value: b.values[j], type: 'BLUP' as const })),
      heritability: { method: 'standard', value: vg + vge + ve > 0 ? Number((vg / (vg + vge + ve)).toFixed(4)) : null },
      genetic_sd: Number(Math.sqrt(Math.max(vg, 0)).toFixed(6)),
      varcomp: [
        { component: 'genotype', variance: Number(vg.toFixed(6)) },
        ...(Vge ? [{ component: 'genotype:environment', variance: Number(vge.toFixed(6)) }] : []),
        { component: 'residual', variance: Number(ve.toFixed(6)) },
      ],
      diagnostics: mergeTraitDiagnostics({ converged: g!.converged, n_genotypes: g!.blups.length, n_obs: nObs }, modelQc[id], boundaryFlags(vg, vge, ve)),
      warnings: [],
    };
  });

  const broad = cut.purpose === 'prediction';
  const warnings: ResultBundle['warnings'] = [];
  if (broad) warnings.push({ code: 'cut_pools_stages', message: `This prediction cut pools ${composition.n_trials} trials across stages ${composition.stages.join('+')} and years ${composition.years.join('+')}, connected by ${composition.n_testers} common testers (every entry is an F1 testcross). Including the early-stage records the selection used de-biases the variance components.`, severity: 'info' });
  else warnings.push({ code: 'cut_is_narrow', message: `This advancement cut is the latest-stage decision set (${composition.n_geno} entries); variance components from so few lines are less precise than the broad prediction cut.`, severity: 'info' });
  if (wantGxe && !fittedGxe) warnings.push({ code: 'gxe_not_separated', message: 'GxE was requested but not estimable for this cut (early-stage founders appear in a single environment); fit uses phenotypic BLUPs.', severity: 'info' });
  if (combiningAbility) warnings.push({ code: 'synthetic_inbred_data', message: 'Combining-ability inbred facts (heterotic pool, per-se merit, native disease trait) are SYNTHETIC scaffolding (ADR-0020). Real maize inbred genotyping replaces them.', severity: 'info' });

  const bundle: ResultBundle = {
    contract_version: 'v0', status: 'ok', intent: broad ? 'prediction' : 'selection',
    chosen_model: chosenModel(plan, g.engine, cut, composition, { twoStage, fittedGxe, relationship, genomicEngine }),
    traits: bundleTraits,
    genetic_correlations: { variable_ids: traits, matrix: g.geneticCorrelation },
    gxe: fittedGxe && g.gxeCovariance ? { variable_ids: traits, covariance: g.gxeCovariance, correlation: g.gxeCorrelation, variances: g.gxeVariances } : null,
    ...(genomic ? { genomic: genomic as unknown as ResultBundle['genomic'] } : {}),
    ...(combiningAbility ? { combining_ability: combiningAbility as unknown as ResultBundle['combining_ability'] } : {}),
    data_readiness: readinessBlock(assembled, readiness, plan),
    data_quality: dataQuality ?? null,
    indices,
    divergence,
    warnings,
    provenance: { contract_version: 'v0', engine_versions: { blupf90: g.engine }, source: 'maize-sim-corpus' } as ResultBundle['provenance'],
  };
  return validateResultBundle(bundle);
}

async function maizeStudyId(cut: Cut, source: string): Promise<{ programId: number; studyId: number }> {
  await db.insert(program).values({ name: PROGRAM }).onConflictDoNothing();
  const [prog] = await db.select().from(program).where(eq(program.name, PROGRAM));
  // One study per cut (name = cut.id) so getCutResult can find the latest bundle for a cut. source
  // distinguishes the built-in templates ('sim') from breeder-saved presets ('maize-cut').
  await db.insert(study).values({ programId: prog.id, name: cut.id, fieldLocation: cut.label, year: 2025, source }).onConflictDoNothing();
  const [s] = await db.select().from(study).where(and(eq(study.programId, prog.id), eq(study.name, cut.id)));
  return { programId: prog.id, studyId: s.id };
}

export async function persistCutBundle(cut: Cut, bundle: ResultBundle, source = 'sim'): Promise<number> {
  const { programId, studyId } = await maizeStudyId(cut, source);
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

/** Preview (no fit) a built-in template cut by id — for the pre-fit Data + Model review. */
export function previewMaizeCut(cutId: string, opts: CutRunOpts = {}): CutPreview {
  const cut = cutById(cutId);
  if (!cut) throw new Error(`unknown maize cut: ${cutId}`);
  return previewCut(assembleCut(cut), opts);
}

/** Build (and optionally persist) one built-in template cut by id — the Server Action's run path. */
export async function runMaizeCut(cutId: string, opts: { persist?: boolean } & CutRunOpts = {}): Promise<{ bundle: ResultBundle; analysisRunId: number | null }> {
  const cut = cutById(cutId);
  if (!cut) throw new Error(`unknown maize cut: ${cutId}`);
  const assembled = assembleCut(cut);
  const bundle = buildCutBundle(assembled, opts);
  const analysisRunId = (opts.persist ?? true) ? await persistCutBundle(cut, bundle) : null;
  return { bundle, analysisRunId };
}

/** Preview (no fit) a breeder-defined composite, for the pre-fit Data + Model review. */
export function previewCustomCut(def: CutDef, opts: CutRunOpts = {}): CutPreview {
  return previewCut(assembleCustom(def), opts);
}

/** Build + persist a BREEDER-DEFINED cut (a saved preset): fit the hand-picked trials (with any model
 *  overrides / data exclusions) and store it as its own re-runnable study (source='maize-cut'). */
export async function buildCustomCut(def: CutDef, opts: CutRunOpts = {}): Promise<{ cutId: string; analysisRunId: number }> {
  const assembled = assembleCustom(def);
  const bundle = buildCutBundle(assembled, opts);
  const analysisRunId = await persistCutBundle(assembled.cut, bundle, 'maize-cut');
  return { cutId: def.id, analysisRunId };
}

/** Fit a breeder-defined cut WITHOUT persisting — the ephemeral "run without saving" path. Returns the
 *  full bundle for in-memory viewing; the breeder Saves later (a server re-fit + persist), so nothing is
 *  written to the database here. Synchronous fit; no DB access. */
export function fitCustomCut(def: CutDef, opts: CutRunOpts = {}): { bundle: ResultBundle } {
  return { bundle: buildCutBundle(assembleCustom(def), opts) };
}

async function cli() {
  loadManifest();
  const cuts = listCuts();
  console.log(`building ${cuts.length} maize cuts ...`);
  for (const cut of cuts) {
    const t0 = Date.now();
    const { analysisRunId } = await runMaizeCut(cut.id, { persist: true });
    console.log(`  ${cut.id.padEnd(24)} → run ${analysisRunId} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  await db.$client.end();
}

if (isEntrypoint(import.meta.url)) cli().catch((e) => { console.error(e); process.exit(1); });
