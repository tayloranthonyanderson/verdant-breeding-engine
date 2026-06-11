// The JobQueue PORT (ADR-0012). Callers depend only on this interface, never on graphile-worker.
// That is the refactor insurance: swap the adapter (pg-boss, Redis, Cloud Tasks) at scale without
// touching a single enqueue site. The graphile-worker adapter is the one implementation today.
import { makeWorkerUtils, type WorkerUtils } from 'graphile-worker';
import { DATABASE_URL } from '@verdant/db';

/** Enqueue side of the durable job queue. The only surface the web tier depends on. */
export interface JobQueue {
  enqueue(task: string, payload: unknown): Promise<void>;
  close(): Promise<void>;
}

/** graphile-worker adapter: Postgres-backed, SKIP LOCKED, retries/backoff/cron built in. */
export async function createGraphileQueue(
  connectionString: string = DATABASE_URL,
): Promise<JobQueue> {
  const utils: WorkerUtils = await makeWorkerUtils({ connectionString });
  await utils.migrate(); // idempotent: installs the graphile_worker schema if absent
  return {
    async enqueue(task, payload) {
      await utils.addJob(task, payload as Record<string, unknown>);
    },
    async close() {
      await utils.release();
    },
  };
}
