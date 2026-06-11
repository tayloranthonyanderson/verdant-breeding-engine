// M0 tracer-bullet driver: CSV -> tables -> request -> kernel -> persisted bundle, end to end
// on real G2F data. Later this orchestration moves into the web tier + JobQueue worker.
//
//   pnpm --filter @verdant/pipeline run analyze -- data/g2f/OHH1_2019.csv
//
import { pool } from '@verdant/db';
import { parseG2fCsv, type TraitSpec } from './g2f';
import { ingestStudy, buildRequestFromDb, runKernel, persistResult, type ObjectiveSpec } from './pipeline';

const TRAITS: TraitSpec[] = [
  { column: 'Yield_Mg_ha', name: 'Yield', unit: 'Mg/ha' },
  { column: 'Grain_Moisture', name: 'Grain moisture', unit: '%' },
];

const OBJECTIVE: ObjectiveSpec = {
  gates: [{ variable_id: 'Yield_Mg_ha', operator: '>=', threshold: 8.0 }],
  index_weights: [
    { variable_id: 'Yield_Mg_ha', mode: 'max', weight: 0.7 },
    { variable_id: 'Grain_Moisture', mode: 'min', weight: 0.3 },
  ],
};

async function main() {
  const csv = process.argv.slice(2).find((a) => a !== '--') ?? 'data/g2f/OHH1_2019.csv';
  console.log(`[1/4] parsing ${csv}`);
  const parsed = parseG2fCsv(csv, TRAITS);
  console.log(`      env=${parsed.env} units=${parsed.units.length} observations=${parsed.observations.length}`);

  console.log('[2/4] ingesting into Postgres');
  const { programId, studyId } = await ingestStudy(parsed);
  console.log(`      program=${programId} study=${studyId}`);

  console.log('[3/4] building request from DB + running kernel');
  const request = await buildRequestFromDb(studyId, {
    analyzeColumns: TRAITS.map((t) => t.column),
    objective: OBJECTIVE,
    segmentId: 'g2f-demo',
  });
  const bundle = runKernel(request);
  const cm = bundle.chosen_model;
  console.log(`      model: spatial=${cm.spatial_method} engine=${cm.engine} geno=${cm.genotype_effect}`);
  for (const t of bundle.traits) {
    const h = t.heritability;
    console.log(`      ${t.variable_id}: h2=${h ? `${h.value} (${h.method})` : 'n/a'}, ${t.effects.length} BLUPs`);
  }

  console.log('[4/4] persisting analysis_run + result_bundle');
  const { analysisRunId } = await persistResult({ programId, studyId, request, bundle });
  const top = bundle.indices?.[0]?.ranking?.slice(0, 3) ?? [];
  console.log(`      analysis_run=${analysisRunId}`);
  console.log(`      top selections: ${top.map((r) => `#${r.rank} ${r.germplasm_id}`).join(', ')}`);
  console.log('done.');
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
