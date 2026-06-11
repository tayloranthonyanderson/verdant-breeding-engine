// Enqueue an analysis: create the AnalysisRun row (status=queued) and put an `analyze` job on
// the queue. The web tier calls this; the worker (tasks.ts) does the work. The run row is the
// durable record; the queue job is the trigger.
import { db, analysisRun } from '@verdant/db';
import type { AnalysisRequest } from '@verdant/contracts';
import type { JobQueue } from './queue';

export async function enqueueAnalysis(
  queue: JobQueue,
  args: { programId: number; studyId: number; request: AnalysisRequest },
): Promise<number> {
  const [run] = await db
    .insert(analysisRun)
    .values({
      programId: args.programId,
      studyId: args.studyId,
      intent: args.request.intent,
      status: 'queued',
      contractVersion: 'v0',
      request: args.request,
    })
    .returning({ id: analysisRun.id });
  await queue.enqueue('analyze', { analysisRunId: run.id });
  return run.id;
}
