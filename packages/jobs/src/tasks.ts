// The job handlers run by the worker. The `analyze` task is the durable form of the M0 thread:
// load a queued AnalysisRun, run the R kernel (ADR-0012 Rscript subprocess), persist the
// ResultBundle, and advance the run's status. Throwing lets graphile-worker record the failure
// and apply its retry/backoff policy.
import type { Task, TaskList } from 'graphile-worker';
import { eq } from 'drizzle-orm';
import { db, analysisRun, resultBundle } from '@verdant/db';
import { validateAnalysisRequest } from '@verdant/contracts';
import { runKernel } from '@verdant/pipeline';

interface AnalyzePayload {
  analysisRunId: number;
}

export const analyzeTask: Task = async (payload) => {
  const { analysisRunId } = payload as AnalyzePayload;
  const [run] = await db.select().from(analysisRun).where(eq(analysisRun.id, analysisRunId));
  if (!run) throw new Error(`analysis_run ${analysisRunId} not found`);

  await db
    .update(analysisRun)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(analysisRun.id, analysisRunId));

  try {
    const request = validateAnalysisRequest(run.request);
    const bundle = runKernel(request); // R kernel; deterministic science (ADR-0002)
    await db
      .insert(resultBundle)
      .values({ analysisRunId, contractVersion: 'v0', bundle });
    await db
      .update(analysisRun)
      .set({ status: 'ok', finishedAt: new Date() })
      .where(eq(analysisRun.id, analysisRunId));
  } catch (err) {
    await db
      .update(analysisRun)
      .set({ status: 'error', error: String(err), finishedAt: new Date() })
      .where(eq(analysisRun.id, analysisRunId));
    throw err; // surface to graphile-worker for retry/backoff + visibility
  }
};

export const taskList: TaskList = { analyze: analyzeTask };
