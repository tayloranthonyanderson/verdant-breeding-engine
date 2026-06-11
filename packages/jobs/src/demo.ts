// Proves the durable-queue path end-to-end: enqueue an analysis for the already-ingested
// OHH1_2019 study, drain the worker once, and confirm the worker persisted the bundle and
// advanced the run's status — all through Postgres, no direct kernel call here.
//
//   pnpm --filter @verdant/jobs run demo
//
import { eq } from 'drizzle-orm';
import { pool, db, study, analysisRun, resultBundle } from '@verdant/db';
import { buildRequestFromDb, type ObjectiveSpec } from '@verdant/pipeline';
import { createGraphileQueue, enqueueAnalysis, runWorkerOnce } from './index';

const OBJECTIVE: ObjectiveSpec = {
  gates: [{ variable_id: 'Yield_Mg_ha', operator: '>=', threshold: 8.0 }],
  index_weights: [
    { variable_id: 'Yield_Mg_ha', mode: 'max', weight: 0.7 },
    { variable_id: 'Grain_Moisture', mode: 'min', weight: 0.3 },
  ],
};

async function main() {
  const [s] = await db.select().from(study).where(eq(study.name, 'OHH1_2019'));
  if (!s) throw new Error('OHH1_2019 not ingested yet — run `@verdant/pipeline analyze` first.');

  const request = await buildRequestFromDb(s.id, {
    analyzeColumns: ['Yield_Mg_ha', 'Grain_Moisture'],
    objective: OBJECTIVE,
    segmentId: 'g2f-demo',
  });

  const queue = await createGraphileQueue();
  const runId = await enqueueAnalysis(queue, { programId: s.programId, studyId: s.id, request });
  const [queued] = await db.select().from(analysisRun).where(eq(analysisRun.id, runId));
  console.log(`enqueued analysis_run=${runId}  status=${queued.status}  (no result yet)`);

  console.log('draining worker…');
  await runWorkerOnce();

  const [run] = await db.select().from(analysisRun).where(eq(analysisRun.id, runId));
  const [rb] = await db.select().from(resultBundle).where(eq(resultBundle.analysisRunId, runId));
  console.log(`after worker:  status=${run.status}  bundle_persisted=${!!rb}`);
  if (rb) {
    const bundle = rb.bundle as { chosen_model: { spatial_method: string }; indices?: { ranking: { rank: number; germplasm_id: string }[] }[] };
    const top = bundle.indices?.[0]?.ranking?.slice(0, 3) ?? [];
    console.log(`               model=${bundle.chosen_model.spatial_method}  top=${top.map((r) => `#${r.rank} ${r.germplasm_id}`).join(', ')}`);
  }

  await queue.close();
  await pool.end();
  if (run.status !== 'ok' || !rb) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
