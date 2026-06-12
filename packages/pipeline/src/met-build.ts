// MET tracer: parse the multi-environment fixture, run the BLUPF90 adapter for the multi-trait
// genetic covariance + BLUPs, assemble a contract-valid ResultBundle (traits, heritabilities,
// genetic correlations, and a seed transparent index), and persist it for the web tier.
//
// Run: pnpm --filter @verdant/pipeline exec tsx src/met-build.ts
//
// The transparent index is computed inline here as the seed (the client recomputes it live, and the
// rigorous Smith–Hazel index is added later in R). Engine-agnostic apart from the column mapping.
import { resolve, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { desc, eq } from 'drizzle-orm';
import { db, program, study, analysisRun, resultBundle } from '@verdant/db';
import { validateResultBundle, type ResultBundle, type AnalysisRequest } from '@verdant/contracts';
import { estimateGeneticCovariance } from './blupf90';
import { genomicGblup } from './genomic-blupf90';
import { parseG2fMet } from './g2f';
import { spatialStage1 } from './stage1';
import { runPlanner, type ModelOverrides, type GenomicReadiness } from './planner';
import { buildGenomicInputs } from './genomic-inputs';
import { runRKernel } from './kernel';
import { isEntrypoint } from './entry';
import { metFixture } from './paths';

// Native BLUPF90 needs its inputs under $HOME (colima mounts $HOME, not /tmp). The SNP file lands here.
const GENO_WORK = join(homedir(), '.verdant', 'blupf90');

const TRAITS = ['Plant_Height_cm', 'Ear_Height_cm', 'Yield_Mg_ha', 'Grain_Moisture'];
// Objective for the seed transparent index (mode + relative weight per trait).
const WEIGHTS = [
  { variable_id: 'Yield_Mg_ha', mode: 'max' as const, weight: 0.4 },
  { variable_id: 'Grain_Moisture', mode: 'min' as const, weight: 0.25 },
  { variable_id: 'Plant_Height_cm', mode: 'max' as const, weight: 0.2 },
  { variable_id: 'Ear_Height_cm', mode: 'min' as const, weight: 0.15 },
];

/** Transparent weighted index (ADR-0013): z-standardize each trait, merit by mode, normalize each
 *  merit column to unit spread, weight, sum. Seed only — the client recomputes live. */
function transparentIndex(genoBlups: Map<string, Array<number | null>>) {
  const genos = [...genoBlups.keys()];
  const n = TRAITS.length;
  // z per trait (empirical sample sd)
  const z: number[][] = TRAITS.map((_, j) => {
    const vals = genos.map((g) => genoBlups.get(g)![j]).filter((v): v is number => v != null);
    const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / ((vals.length - 1) || 1)) || 1;
    return genos.map((g) => { const v = genoBlups.get(g)![j]; return v == null ? 0 : (v - mean) / sd; });
  });
  const totalW = WEIGHTS.reduce((a, w) => a + w.weight, 0) || 1;
  const contrib: number[] = genos.map(() => 0);
  for (const w of WEIGHTS) {
    const j = TRAITS.indexOf(w.variable_id);
    const merit = z[j].map((zz) => (w.mode === 'min' ? -zz : zz)); // max/min (no target in seed)
    const mean = merit.reduce((a, b) => a + b, 0) / (merit.length || 1);
    const sd = Math.sqrt(merit.reduce((a, b) => a + (b - mean) ** 2, 0) / ((merit.length - 1) || 1)) || 1;
    merit.forEach((m, i) => { contrib[i] += ((m - mean) / sd) * w.weight / totalW; });
  }
  const ranking = genos
    .map((g, i) => ({ germplasm_id: g, score: Number(contrib[i].toFixed(5)) }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ germplasm_id: r.germplasm_id, rank: i + 1, score: r.score, gated_out: false, gate_failures: [] }));
  return {
    kind: 'weighted' as const,
    segment_id: 'g2f-met-2019',
    ranking,
    weights_used: WEIGHTS.map((w) => ({ variable_id: w.variable_id, mode: w.mode, direction: (w.mode === 'min' ? -1 : 1) as 1 | -1, weight: w.weight })),
  };
}

/** Genetically-aware desired-gains index + divergence, computed in R (science layer). Default gains
 *  (genetic-sd units): yield +1, moisture −1, height neutral. */
function geneticIndex(
  G: number[][],
  germplasmIds: string[],
  blups: Array<Array<number | null>>,
  transparentRanking: Array<{ germplasm_id: string; rank: number }>,
) {
  const input = {
    variable_ids: TRAITS,
    genetic_covariance: G,
    germplasm_ids: germplasmIds,
    blups,
    // [Plant_Height_cm, Ear_Height_cm, Yield_Mg_ha, Grain_Moisture] in genetic-sd units.
    // Decent height but LOW ear placement (lodging resistance) deliberately fights the strong
    // height–ear genetic correlation — that's what makes the genetic-aware index diverge.
    desired_gains: [0.5, -0.5, 1, -1],
    transparent_ranking: transparentRanking.map((r) => ({ germplasm_id: r.germplasm_id, rank: r.rank })),
  };
  return runRKernel<{ index: NonNullable<ResultBundle['indices']>[number]; divergence: ResultBundle['divergence'] }>(
    'select-index.R',
    input,
  );
}

const PROG = 'G2F (public dev data)';
const FIXTURE = metFixture();

// The genomic block fields runMetAnalysis consumes (the full block has more, carried through as-is).
interface GenomicBlock {
  cohort: string[];
  model_comparison: Array<{ trait: string; model: string; predictive_ability: number }>;
  gebv_by_model: Record<string, Record<string, { values: number[] }>>;
  // single-step H GEBVs over ALL phenotyped lines (genotyped + un-genotyped), its own cohort.
  h_model?: { cohort: string[]; gebv: Record<string, { values: number[] }> };
  // native BLUPF90/preGSf90 GBLUP GEBVs (G) over genomic.cohort — the engine=blupf90 re-point source.
  gebv_blupf90?: Record<string, { values: number[] }>;
  [k: string]: unknown;
}

/** Mean cross-validated predictive ability per relationship model (the planner's evidence). */
function evidenceFromComparison(mc: GenomicBlock['model_comparison']): Record<string, number> {
  const sum: Record<string, { s: number; n: number }> = {};
  for (const r of mc) {
    const a = (sum[r.model] ??= { s: 0, n: 0 });
    if (Number.isFinite(r.predictive_ability)) { a.s += r.predictive_ability; a.n += 1; }
  }
  return Object.fromEntries(Object.entries(sum).map(([m, a]) => [m, a.n ? a.s / a.n : 0]));
}

const REL_TO_MODEL: Record<string, string> = { identity: 'identity', A: 'pedigree_A', G: 'genomic_G' };

/** The per-genotype breeding values the selection index ranks on, for the chosen relationship model.
 *  identity → phenotypic BLUPs (all lines); A/G → the model's GEBVs over the genotyped cohort;
 *  H → single-step GEBVs over ALL phenotyped lines (genotyped + un-genotyped via the pedigree link). */
function activeBreedingValues(
  relationship: string,
  engine: string,
  phenotypic: { genos: string[]; map: Map<string, Array<number | null>> },
  genomic: GenomicBlock | null,
): { genos: string[]; map: Map<string, Array<number | null>>; subset: boolean } {
  const mapFrom = (cohort: string[], byTrait: Record<string, { values: number[] }>) => {
    const map = new Map<string, Array<number | null>>();
    cohort.forEach((gn, i) => map.set(gn, TRAITS.map((tr) => byTrait[tr]?.values?.[i] ?? null)));
    return map;
  };
  // engine=blupf90 with the genomic relationship → rank on the native BLUPF90 GBLUP GEBVs.
  if (relationship === 'G' && engine === 'blupf90' && genomic?.gebv_blupf90) {
    return { genos: genomic.cohort, map: mapFrom(genomic.cohort, genomic.gebv_blupf90), subset: true };
  }
  if (relationship === 'H' && genomic?.h_model?.gebv) {
    const { cohort, gebv } = genomic.h_model;
    return { genos: cohort, map: mapFrom(cohort, gebv), subset: cohort.length < phenotypic.genos.length };
  }
  const key = REL_TO_MODEL[relationship];
  if (relationship === 'identity' || !key || !genomic?.gebv_by_model?.[key]) {
    return { ...phenotypic, subset: false };
  }
  return { genos: genomic.cohort, map: mapFrom(genomic.cohort, genomic.gebv_by_model[key]), subset: true };
}

async function persistBundle(bundle: ResultBundle, relationship: string): Promise<number> {
  const validated = validateResultBundle(bundle);
  await db.insert(program).values({ name: PROG }).onConflictDoNothing();
  const [prog] = await db.select().from(program).where(eq(program.name, PROG));
  await db.insert(study).values({ programId: prog.id, name: 'MET_2019', fieldLocation: '8-env MET', year: 2019, source: 'g2f' }).onConflictDoNothing();
  const [s] = await db.select().from(study).where(eq(study.name, 'MET_2019'));
  const request: AnalysisRequest = {
    contract_version: 'v0', analysis_request_id: 'met-2019', intent: 'selection',
    variables: TRAITS.map((id) => ({ variable_id: id, name: id, data_type: 'numeric' as const })) as AnalysisRequest['variables'],
    observation_units: [{ observation_unit_id: 'met', germplasm_id: 'g' }] as AnalysisRequest['observation_units'],
    observations: [],
    relationship: { type: relationship as 'identity' | 'A' | 'G' | 'H' },
  };
  const [run] = await db.insert(analysisRun).values({ programId: prog.id, studyId: s.id, intent: 'selection', status: 'ok', contractVersion: 'v0', request, finishedAt: new Date() }).returning({ id: analysisRun.id });
  await db.insert(resultBundle).values({ analysisRunId: run.id, contractVersion: 'v0', bundle: validated });
  return run.id;
}

/** Assemble chosen_model from a resolved plan + the relationship it actually fitted. */
function chosenModel(plan: ReturnType<typeof runPlanner>['plan'], relationship: string): ResultBundle['chosen_model'] {
  const oneStage = plan.model_class === 'single_stage';
  const relNote = relationship !== 'identity'
    ? ` Genotypes ranked by the ${relationship === 'G' ? 'genomic (G)' : relationship} relationship model (GEBVs).`
    : '';
  return {
    description: (oneStage
      ? `Single-stage multi-trait AI-REML${plan.gxe.include ? ' with a genotype×environment term' : ''}; genotype random (BLUPs).`
      : 'Two-stage MET: SpATS within-environment spatial de-trending, then multi-trait AI-REML across environments; genotype random (BLUPs).') + relNote,
    formula: oneStage
      ? `trait ~ environment + genotype(random)${plan.gxe.include ? ' + genotype:environment(random)' : ''}`
      : 'stage 1: trait ~ PSANOVA(col,row) + genotype(fixed)  [per env];  stage 2: adjusted_mean ~ environment + genotype(random)',
    genotype_effect: 'random',
    spatial_method: plan.spatial_method,
    relationship: relationship as 'identity' | 'A' | 'G' | 'H',
    engine: plan.engine,
    rationale: plan.decisions.find((d) => d.factor === 'staging')?.reason ?? '',
    model_class: plan.model_class,
    staging_weighted: plan.staging_weighted,
    decisions: plan.decisions,
    overridable: plan.overridable,
  };
}

export interface RunMetOptions {
  /** Breeder overrides of the planner's recommendations (ADR-0018). */
  overrides?: ModelOverrides;
  /** 'full' refits everything; 'relationship_only' re-points the ranking from the latest bundle (fast). */
  scope?: 'full' | 'relationship_only';
  /** Persist the bundle (default true). */
  persist?: boolean;
}
export interface RunMetResult { bundle: ResultBundle; analysisRunId: number | null }

/** The MET analysis entrypoint (ADR-0016/0018): plan (recommend + apply breeder overrides) → fit →
 *  reconcile the chosen relationship with the cross-validation winner → re-point the ranking → persist.
 *  Importable so the web Server Action / job queue can call it; the CLI shell is at the bottom. */
export async function runMetAnalysis(opts: RunMetOptions = {}): Promise<RunMetResult> {
  if ((opts.scope ?? 'full') === 'relationship_only') return rerunRelationshipOnly(opts);
  const persist = opts.persist ?? true;

  const { variableIds, records } = parseG2fMet(FIXTURE, TRAITS);
  console.log(`parsed ${records.length} plot rows, ${new Set(records.map((r) => r.genotype)).size} genotypes, ${new Set(records.map((r) => r.environment)).size} environments`);

  // Genomic readiness the plot structure can't see: export the cohort's dosages (markers/pedigree).
  // Also write the SNP file (under $HOME) so the native BLUPF90 GBLUP engine is available on demand.
  mkdirSync(GENO_WORK, { recursive: true });
  const snpPath = join(GENO_WORK, 'met.snp.txt');
  let genomicInputs: Awaited<ReturnType<typeof buildGenomicInputs>> | null = null;
  try {
    genomicInputs = await buildGenomicInputs({
      traits: TRAITS, binPath: join(tmpdir(), 'verdant-met.bin'), metaPath: join(tmpdir(), 'verdant-met.meta.json'),
      mafMin: 0.05, maxMarkers: 50000, snpPath,
    });
  } catch (e) {
    console.log(`no genomic data available (${(e as Error).message}); identity baseline`);
  }
  const genomicReadiness: GenomicReadiness = genomicInputs && genomicInputs.export.nMarkers > 0
    ? { markers_present: true, pedigree_present: genomicInputs.parents().length > 0, n_genotyped: genomicInputs.matched.length }
    : { markers_present: false, pedigree_present: false, n_genotyped: 0 };

  // Planner (structural pass): drives the phenotypic fit. Relationship recommendation is refined with
  // CV evidence after the genomic block runs (evidence doesn't change spatial/staging/gxe — deterministic).
  const struct = runPlanner(variableIds, records, { overrides: opts.overrides, genomic: genomicReadiness });
  const plan0 = struct.plan;
  console.log(`planner: model_class=${plan0.model_class} gxe=${plan0.gxe.include} relationship→${plan0.relationship}`);

  // Phenotypic fit (the field BLUPs). One-stage = joint AI-REML (yields GxE); two-stage = SpATS → AI-REML.
  let g: ReturnType<typeof estimateGeneticCovariance>;
  if (plan0.model_class === 'single_stage') {
    console.log(`Single-stage multi-trait AI-REML on plots${plan0.gxe.include ? ' (+ genotype×environment)' : ''} ...`);
    g = estimateGeneticCovariance({ variableIds: TRAITS, rows: records.map((r) => ({ genotype: r.genotype, environment: r.environment, values: r.values })), interaction: plan0.gxe.include });
  } else {
    console.log('Stage 1: within-environment spatial de-trending (SpATS) ...');
    const s1 = spatialStage1(variableIds, records);
    console.log('Stage 2: multi-trait AI-REML (BLUPF90) on adjusted means ...');
    g = estimateGeneticCovariance({ variableIds: TRAITS, rows: s1.adjusted.map((a) => ({ genotype: a.genotype, environment: a.environment, values: a.values })) });
  }
  console.log(`converged in ${g.rounds} rounds; ${g.blups.length} genotype BLUPs`);

  // Genomic block (CV comparison + per-model GEBVs) when markers are present.
  let genomic: GenomicBlock | null = null;
  if (genomicInputs && genomicReadiness.markers_present) {
    console.log(`genomic-analyze: ${genomicInputs.matched.length} genotyped × ${genomicInputs.export.nMarkers} markers ...`);
    genomic = runRKernel<GenomicBlock>('genomic-analyze.R', {
      bin: join(tmpdir(), 'verdant-met.bin'), meta: join(tmpdir(), 'verdant-met.meta.json'),
      pedigree: genomicInputs.pedigree(), pheno: { names: genomicInputs.matched, traits: genomicInputs.phenoByTrait() },
      folds: 5, reps: 2, heatmap_n: 100,
    }, { transport: 'cfg-file' });
    (genomic as Record<string, unknown>).traits = TRAITS;

    // Single-step H GEBVs over ALL phenotyped lines (genotyped + un-genotyped), so the index can rank
    // the un-genotyped lines through the pedigree link. Its own (larger) cohort.
    const hCohort = genomicInputs.genotypes;
    if (hCohort.length > genomicInputs.matched.length) {
      console.log(`genomic-h: single-step H over ${hCohort.length} phenotyped lines (${hCohort.length - genomicInputs.matched.length} un-genotyped) ...`);
      const h = runRKernel<{ cohort: string[]; gebv: Record<string, { values: number[] }> }>('genomic-h.R', {
        bin: join(tmpdir(), 'verdant-met.bin'), meta: join(tmpdir(), 'verdant-met.meta.json'),
        pedigree: genomicInputs.pedigree(hCohort), pheno: { names: hCohort, traits: genomicInputs.phenoByTrait(hCohort) },
        genotyped: genomicInputs.matched,
      }, { transport: 'cfg-file' });
      genomic.h_model = { cohort: h.cohort, gebv: h.gebv };
    }

    // Native BLUPF90/preGSf90 GBLUP GEBVs (the engine=blupf90 option) — precomputed alongside rrBLUP so
    // the engine toggle is an instant re-point, not an 8-minute live refit. Multi-trait, G built once,
    // fixed (co)variances from the phenotypic fit. Best-effort: if it fails the rrBLUP path still stands.
    try {
      console.log('native BLUPF90 GBLUP (engine option) ...');
      const nat = genomicGblup({
        ids: genomic.cohort, traits: TRAITS, phenoByTrait: genomicInputs.phenoByTrait(),
        snpPath, geneticCovariance: g.geneticCovariance, residualCovariance: g.residualCovariance,
      });
      genomic.gebv_blupf90 = Object.fromEntries(TRAITS.map((tr) => {
        const m = new Map(nat.gebvByTrait[tr].map((x) => [x.id, x.gebv]));
        return [tr, { values: genomic!.cohort.map((id) => m.get(id) ?? 0) }];
      }));
    } catch (e) {
      console.log(`native BLUPF90 GBLUP skipped: ${(e as Error).message}`);
    }
  }

  // Planner (final): CV evidence makes the relationship recommendation the measured winner.
  const evidence = genomic ? evidenceFromComparison(genomic.model_comparison) : undefined;
  const { plan } = runPlanner(variableIds, records, { overrides: opts.overrides, genomic: genomicReadiness, evidence });
  const relationship = plan.relationship;
  console.log(`relationship resolved → ${relationship} (recommended ${plan.decisions.find((d) => d.factor === 'relationship')?.recommended})`);

  const Ve = g.residualCovariance.map((r, i) => r[i]);
  const phenotypic = { genos: g.blups.map((b) => b.genotype), map: new Map(g.blups.map((b) => [b.genotype, b.values])) };
  const active = activeBreedingValues(relationship, plan.genomic_engine ?? 'rrblup', phenotypic, genomic);

  // Indices ranked by the CHOSEN model's breeding values; traits keep the field BLUPs (the per-trait estimates).
  const transIdx = transparentIndex(active.map);
  const gi = geneticIndex(g.geneticCovariance, active.genos, active.genos.map((gn) => active.map.get(gn)!), transIdx.ranking);

  const traits: ResultBundle['traits'] = TRAITS.map((id, j) => {
    const vg = g.geneticVariances[j]; const vge = g.gxeVariances?.[j] ?? 0; const ve = Ve[j];
    return {
      variable_id: id, status: 'ok' as const,
      effects: g.blups.map((b) => ({ germplasm_id: b.genotype, value: b.values[j], type: 'BLUP' as const })),
      heritability: { method: 'standard' as const, value: Number((vg / (vg + vge + ve)).toFixed(4)) },
      genetic_sd: Number(Math.sqrt(vg).toFixed(6)),
      varcomp: [
        { component: 'genotype', variance: Number(vg.toFixed(6)) },
        ...(g.gxeVariances ? [{ component: 'genotype:environment', variance: Number(vge.toFixed(6)) }] : []),
        { component: 'residual', variance: Number(ve.toFixed(6)) },
      ],
      diagnostics: { converged: g.converged, n_genotypes: g.blups.length }, warnings: [],
    };
  });

  const warnings: ResultBundle['warnings'] = [];
  if (!plan.gxe.include) warnings.push({ code: 'gxe_not_separated', message: plan.gxe.reason, severity: 'info' });
  if (active.subset && phenotypic.genos.length > active.genos.length)
    warnings.push({ code: 'ranking_genotyped_subset', message: `Ranking under the ${relationship} model covers the ${active.genos.length} genotyped lines; ${phenotypic.genos.length - active.genos.length} un-genotyped lines are not ranked (single-step H is Phase 2).`, severity: 'info' });

  const bundle: ResultBundle = {
    contract_version: 'v0', status: 'ok', intent: 'selection',
    chosen_model: chosenModel(plan, relationship),
    traits,
    genetic_correlations: { variable_ids: TRAITS, matrix: g.geneticCorrelation },
    gxe: g.gxeCovariance ? { variable_ids: TRAITS, covariance: g.gxeCovariance, correlation: g.gxeCorrelation, variances: g.gxeVariances } : null,
    data_readiness: { scale: struct.readiness.scale, connectivity: struct.readiness.connectivity, replication: struct.readiness.replication, grids: struct.readiness.grids, unlocks: plan.unlocks },
    indices: [transIdx, gi.index],
    divergence: gi.divergence,
    ...(genomic ? { genomic: genomic as unknown as ResultBundle['genomic'] } : {}),
    warnings,
    provenance: { contract_version: 'v0', engine_versions: { blupf90: 'blupf90+', genomic: 'rrBLUP' } },
  };

  const analysisRunId = persist ? await persistBundle(bundle, relationship) : null;
  if (persist) console.log(`persisted MET bundle (analysis_run=${analysisRunId}); relationship=${relationship}`);
  return { bundle, analysisRunId };
}

/** Fast re-run: only the relationship changed. Re-point the ranking from the latest bundle's
 *  cross-validated per-model GEBVs — no phenotypic refit, no genomic recompute (ADR-0018). */
async function rerunRelationshipOnly(opts: RunMetOptions): Promise<RunMetResult> {
  const persist = opts.persist ?? true;
  const [latest] = await db.select().from(resultBundle).orderBy(desc(resultBundle.id)).limit(1);
  if (!latest) throw new Error('no base bundle to re-point — run a full analysis first');
  const base = latest.bundle as ResultBundle;
  const genomic = (base.genomic ?? null) as GenomicBlock | null;
  if (!genomic?.gebv_by_model) throw new Error('base bundle has no per-model GEBVs; run a full analysis first');

  const { variableIds, records } = parseG2fMet(FIXTURE, TRAITS);
  const hasPedigree = genomic.model_comparison.some((r) => r.model === 'pedigree_A');
  const genomicReadiness: GenomicReadiness = { markers_present: true, pedigree_present: hasPedigree, n_genotyped: genomic.cohort.length };
  const evidence = evidenceFromComparison(genomic.model_comparison);
  const { plan } = runPlanner(variableIds, records, { overrides: opts.overrides, genomic: genomicReadiness, evidence });
  const relationship = plan.relationship;

  // reconstruct the trait genetic covariance from the base bundle (corr × sd_i × sd_j) for the index
  const sd = TRAITS.map((id) => base.traits.find((t) => t.variable_id === id)?.genetic_sd ?? 0);
  const corr = base.genetic_correlations?.matrix ?? TRAITS.map((_, i) => TRAITS.map((__, j) => (i === j ? 1 : 0)));
  const G = corr.map((row, i) => row.map((c, j) => (c ?? 0) * sd[i] * sd[j]));

  const phenotypic = {
    genos: (base.traits[0]?.effects ?? []).map((e) => e.germplasm_id),
    map: new Map((base.traits[0]?.effects ?? []).map((e) => [e.germplasm_id, TRAITS.map((id) => base.traits.find((t) => t.variable_id === id)?.effects.find((x) => x.germplasm_id === e.germplasm_id)?.value ?? null)])),
  };
  const active = activeBreedingValues(relationship, plan.genomic_engine ?? 'rrblup', phenotypic, genomic);
  const transIdx = transparentIndex(active.map);
  const gi = geneticIndex(G, active.genos, active.genos.map((gn) => active.map.get(gn)!), transIdx.ranking);

  const warnings = (base.warnings ?? []).filter((w) => w.code !== 'ranking_genotyped_subset');
  if (active.subset && phenotypic.genos.length > active.genos.length)
    warnings.push({ code: 'ranking_genotyped_subset', message: `Ranking under the ${relationship} model covers the ${active.genos.length} genotyped lines; ${phenotypic.genos.length - active.genos.length} un-genotyped lines are not ranked (single-step H is Phase 2).`, severity: 'info' });

  const bundle: ResultBundle = {
    ...base,
    chosen_model: chosenModel(plan, relationship),
    indices: [transIdx, gi.index],
    divergence: gi.divergence,
    data_readiness: { ...base.data_readiness, unlocks: plan.unlocks } as ResultBundle['data_readiness'],
    warnings,
  };
  const analysisRunId = persist ? await persistBundle(bundle, relationship) : null;
  console.log(`re-pointed ranking → ${relationship} (relationship-only re-run; analysis_run=${analysisRunId})`);
  return { bundle, analysisRunId };
}

async function cli() {
  const { analysisRunId } = await runMetAnalysis();
  console.log(`done (analysis_run=${analysisRunId})`);
  await db.$client.end();
}

if (isEntrypoint(import.meta.url)) cli().catch((e) => { console.error(e); process.exit(1); });
