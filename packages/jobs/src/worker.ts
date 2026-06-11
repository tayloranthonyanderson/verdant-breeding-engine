// The long-lived worker process entrypoint: `pnpm --filter @verdant/jobs run worker`.
// Polls the queue and runs analysis jobs until stopped.
import { startWorker } from './runner';

async function main() {
  const runner = await startWorker();
  console.log('[worker] running — waiting for analyze jobs (Ctrl-C to stop)');
  await runner.promise;
}

main().catch((e) => {
  console.error('[worker] fatal', e);
  process.exit(1);
});
