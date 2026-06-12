// MET tracer: parse the multi-environment fixture, run the BLUPF90 adapter for the multi-trait
// genetic covariance + BLUPs, assemble a contract-valid ResultBundle (traits, heritabilities,
// genetic correlations, and a seed transparent index), and persist it for the web tier.
//
// Run: pnpm --filter @verdant/pipeline exec tsx src/met-build.ts
//
// The transparent index is computed inline here as the seed (the client recomputes it live, and the
// rigorous Smith–Hazel index is added later in R). Engine-agnostic apart from the column mapping.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, program, study, analysisRun, resultBundle } from '@verdant/db';
import { validateResultBundle, type ResultBundle, type AnalysisRequest } from '@verdant/contracts';
import { estimateGeneticCovariance } from './blupf90';
import { parseG2fMet } from './g2f';
import { spatialStage1 } from './stage1';

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
  const script = resolve(import.meta.dirname, '../../../services/kernel/select-index.R');
  const proc = spawnSync('Rscript', [script], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (proc.status !== 0) throw new Error(`select-index.R failed:\n${proc.stderr}`);
  return JSON.parse(proc.stdout) as { index: NonNullable<ResultBundle['indices']>[number]; divergence: ResultBundle['divergence'] };
}

async function main() {
  // Ingestion (the ONLY place G2F column names live) → generic plot records.
  const csv = resolve(import.meta.dirname, '../../../data/g2f/MET_2019.csv');
  const { variableIds, records } = parseG2fMet(csv, TRAITS);
  console.log(`parsed ${records.length} plot rows, ${new Set(records.map((r) => r.genotype)).size} genotypes, ${new Set(records.map((r) => r.environment)).size} environments`);

  // Stage 1: within-environment spatial de-trending → spatially-adjusted entry means (BLUEs).
  console.log('Stage 1: within-environment spatial de-trending (SpATS) ...');
  const s1 = spatialStage1(variableIds, records);
  const nSpats = s1.stage1.filter((p) => p.method === 'spats').length;
  console.log(`Stage 1 done: ${s1.adjusted.length} adjusted entry×env means; ${nSpats}/${s1.stage1.length} env×trait fits used a spatial spline`);

  // Stage 2: multi-trait AI-REML across environments on the de-trended means → genetic covariance.
  console.log('Stage 2: multi-trait AI-REML (BLUPF90) on adjusted means ...');
  const g = estimateGeneticCovariance({
    variableIds: TRAITS,
    rows: s1.adjusted.map((a) => ({ genotype: a.genotype, environment: a.environment, values: a.values })),
  });
  console.log(`converged in ${g.rounds} rounds; ${g.blups.length} genotype BLUPs`);

  const genoBlups = new Map(g.blups.map((b) => [b.genotype, b.values]));
  const Ve = g.residualCovariance.map((r, i) => r[i]);

  // Transparent index (seed) + genetically-aware desired-gains index + their divergence.
  const transIdx = transparentIndex(genoBlups);
  const gi = geneticIndex(g.geneticCovariance, g.blups.map((b) => b.genotype), g.blups.map((b) => b.values), transIdx.ranking);
  console.log(`desired-gains index built; divergence rank-correlation vs transparent = ${gi.divergence?.rank_correlation}`);

  const traits: ResultBundle['traits'] = TRAITS.map((id, j) => ({
    variable_id: id,
    status: 'ok',
    effects: g.blups.map((b) => ({ germplasm_id: b.genotype, value: b.values[j], type: 'BLUP' as const })),
    heritability: { method: 'standard', value: Number((g.geneticVariances[j] / (g.geneticVariances[j] + Ve[j])).toFixed(4)) },
    genetic_sd: Number(Math.sqrt(g.geneticVariances[j]).toFixed(6)),
    varcomp: [
      { component: 'genotype', variance: Number(g.geneticVariances[j].toFixed(6)) },
      { component: 'residual', variance: Number(Ve[j].toFixed(6)) },
    ],
    diagnostics: { converged: g.converged, n_genotypes: g.blups.length },
    warnings: [],
  }));

  const bundle: ResultBundle = {
    contract_version: 'v0',
    status: 'ok',
    intent: 'selection',
    chosen_model: {
      description: 'Two-stage MET: Stage 1 removes within-environment field trend (SpATS 2D P-spline per environment × trait, genotype fixed → adjusted entry means); Stage 2 fits multi-trait AI-REML across 8 environments (genotype random) for the genetic covariance and BLUPs.',
      formula: 'stage 1: trait ~ PSANOVA(col,row) + genotype(fixed)  [per env];  stage 2: adjusted_mean ~ environment + genotype(random)',
      genotype_effect: 'random',
      spatial_method: 'spats',
      relationship: 'identity',
      engine: 'SpATS + blupf90+',
      rationale: 'Spatial de-trending stops field heterogeneity from contaminating the genetic correlations and heritabilities; the multi-trait AI-REML then estimates the across-environment genetic covariance G — the basis for genetic correlations and the genetically-aware Smith–Hazel index.',
    },
    traits,
    genetic_correlations: { variable_ids: TRAITS, matrix: g.geneticCorrelation },
    indices: [transIdx, gi.index],
    divergence: gi.divergence,
    warnings: [{ code: 'met_gxe_in_residual', message: 'Within-environment spatial trend is removed (Stage 1), so genetic correlations are no longer contaminated by field heterogeneity. Genotype×environment is not separated from residual error: the trial is largely unreplicated within environment, so a distinct GxE variance is not identifiable without replicated trials (or a weighted two-stage with fixed residual). GxE is folded into the residual here.', severity: 'info' }],
    provenance: { contract_version: 'v0', engine_versions: { blupf90: 'blupf90+' } },
  };

  const validated = validateResultBundle(bundle);

  // persist: program + MET study + run + bundle
  const PROG = 'G2F (public dev data)';
  await db.insert(program).values({ name: PROG }).onConflictDoNothing();
  const [prog] = await db.select().from(program).where(eq(program.name, PROG));
  await db.insert(study).values({ programId: prog.id, name: 'MET_2019', fieldLocation: '8-env MET', year: 2019, source: 'g2f' }).onConflictDoNothing();
  const [s] = await db.select().from(study).where(eq(study.name, 'MET_2019'));
  const request: AnalysisRequest = {
    contract_version: 'v0', analysis_request_id: 'met-2019', intent: 'selection',
    variables: TRAITS.map((id) => ({ variable_id: id, name: id, data_type: 'numeric' as const })) as AnalysisRequest['variables'],
    observation_units: [{ observation_unit_id: 'met', germplasm_id: g.blups[0]?.genotype ?? 'g' }] as AnalysisRequest['observation_units'],
    observations: [],
    relationship: { type: 'identity' },
  };
  const [run] = await db.insert(analysisRun).values({ programId: prog.id, studyId: s.id, intent: 'selection', status: 'ok', contractVersion: 'v0', request, finishedAt: new Date() }).returning({ id: analysisRun.id });
  await db.insert(resultBundle).values({ analysisRunId: run.id, contractVersion: 'v0', bundle: validated });
  console.log(`persisted MET bundle (analysis_run=${run.id}); genetic corr height-ear=${g.geneticCorrelation[0][1].toFixed(3)}`);
  await db.$client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
