// The worker side: process `analyze` jobs from the queue. runWorkerOnce drains and exits
// (deterministic, for tests/CLI); startWorker runs continuously (the long-lived worker process).
import { run, runOnce, type Runner } from 'graphile-worker';
import { DATABASE_URL } from '@verdant/db';
import { taskList } from './tasks';

export async function runWorkerOnce(connectionString: string = DATABASE_URL): Promise<void> {
  await runOnce({ connectionString, taskList });
}

export async function startWorker(connectionString: string = DATABASE_URL): Promise<Runner> {
  return run({ connectionString, taskList, concurrency: 4, pollInterval: 1000 });
}
