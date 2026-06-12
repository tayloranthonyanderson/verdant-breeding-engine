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
import { runPlanner } from './planner';

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

  // Deterministic Model Planner (ADR-0016): decides the model from data STRUCTURE; we execute it.
  const { readiness, plan } = runPlanner(variableIds, records);
  console.log(`planner: model_class=${plan.model_class} gxe=${plan.gxe.include} — ${plan.decisions.find((d) => d.factor === 'staging')?.reason ?? ''}`);

  // Execute the plan. One-stage = joint AI-REML on plots (the only path that yields GxE); two-stage =
  // SpATS spatial de-trend (Stage 1) → multi-trait AI-REML on adjusted means (Stage 2), the scale path.
  let g: ReturnType<typeof estimateGeneticCovariance>;
  if (plan.model_class === 'single_stage') {
    console.log(`Single-stage multi-trait AI-REML on plots${plan.gxe.include ? ' (+ genotype×environment)' : ''} ...`);
    g = estimateGeneticCovariance({
      variableIds: TRAITS,
      rows: records.map((r) => ({ genotype: r.genotype, environment: r.environment, values: r.values })),
      interaction: plan.gxe.include,
    });
  } else {
    console.log('Stage 1: within-environment spatial de-trending (SpATS) ...');
    const s1 = spatialStage1(variableIds, records);
    const nSpats = s1.stage1.filter((p) => p.method === 'spats').length;
    console.log(`Stage 1 done: ${s1.adjusted.length} adjusted entry×env means; ${nSpats}/${s1.stage1.length} env×trait fits used a spatial spline`);
    console.log('Stage 2: multi-trait AI-REML (BLUPF90) on adjusted means ...');
    g = estimateGeneticCovariance({
      variableIds: TRAITS,
      rows: s1.adjusted.map((a) => ({ genotype: a.genotype, environment: a.environment, values: a.values })),
    });
  }
  console.log(`converged in ${g.rounds} rounds; ${g.blups.length} genotype BLUPs${g.gxeVariances ? `; GxE diag ${g.gxeVariances.map((v) => v.toFixed(2)).join('/')}` : ''}`);

  const genoBlups = new Map(g.blups.map((b) => [b.genotype, b.values]));
  const Ve = g.residualCovariance.map((r, i) => r[i]);

  // Transparent index (seed) + genetically-aware desired-gains index + their divergence.
  const transIdx = transparentIndex(genoBlups);
  const gi = geneticIndex(g.geneticCovariance, g.blups.map((b) => b.genotype), g.blups.map((b) => b.values), transIdx.ranking);
  console.log(`desired-gains index built; divergence rank-correlation vs transparent = ${gi.divergence?.rank_correlation}`);

  const traits: ResultBundle['traits'] = TRAITS.map((id, j) => {
    const vg = g.geneticVariances[j];
    const vge = g.gxeVariances?.[j] ?? 0; // present only in the one-stage GxE fit
    const ve = Ve[j];
    return {
      variable_id: id,
      status: 'ok' as const,
      effects: g.blups.map((b) => ({ germplasm_id: b.genotype, value: b.values[j], type: 'BLUP' as const })),
      heritability: { method: 'standard' as const, value: Number((vg / (vg + vge + ve)).toFixed(4)) },
      genetic_sd: Number(Math.sqrt(vg).toFixed(6)),
      varcomp: [
        { component: 'genotype', variance: Number(vg.toFixed(6)) },
        ...(g.gxeVariances ? [{ component: 'genotype:environment', variance: Number(vge.toFixed(6)) }] : []),
        { component: 'residual', variance: Number(ve.toFixed(6)) },
      ],
      diagnostics: { converged: g.converged, n_genotypes: g.blups.length },
      warnings: [],
    };
  });

  const oneStage = plan.model_class === 'single_stage';
  const bundle: ResultBundle = {
    contract_version: 'v0',
    status: 'ok',
    intent: 'selection',
    chosen_model: {
      description: oneStage
        ? `Single-stage multi-trait AI-REML${plan.gxe.include ? ' with a genotype×environment term' : ''}; genotype random (BLUPs).`
        : 'Two-stage MET: SpATS within-environment spatial de-trending, then multi-trait AI-REML across environments; genotype random (BLUPs).',
      formula: oneStage
        ? `trait ~ environment + genotype(random)${plan.gxe.include ? ' + genotype:environment(random)' : ''}`
        : 'stage 1: trait ~ PSANOVA(col,row) + genotype(fixed)  [per env];  stage 2: adjusted_mean ~ environment + genotype(random)',
      genotype_effect: 'random',
      spatial_method: plan.spatial_method,
      relationship: plan.relationship as 'identity' | 'A' | 'G' | 'H',
      engine: plan.engine,
      // headline only; the full per-decision reasoning lives in `decisions[]` (the readiness panel).
      rationale: plan.decisions.find((d) => d.factor === 'staging')?.reason ?? '',
      model_class: plan.model_class,
      staging_weighted: plan.staging_weighted,
      decisions: plan.decisions,
    },
    traits,
    genetic_correlations: { variable_ids: TRAITS, matrix: g.geneticCorrelation },
    gxe: g.gxeCovariance
      ? { variable_ids: TRAITS, covariance: g.gxeCovariance, correlation: g.gxeCorrelation, variances: g.gxeVariances }
      : null,
    data_readiness: {
      scale: readiness.scale,
      connectivity: readiness.connectivity,
      replication: readiness.replication,
      grids: readiness.grids,
      unlocks: plan.unlocks,
    },
    indices: [transIdx, gi.index],
    divergence: gi.divergence,
    warnings: plan.gxe.include ? [] : [{ code: 'gxe_not_separated', message: plan.gxe.reason, severity: 'info' as const }],
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
