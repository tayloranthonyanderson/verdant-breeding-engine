// The CLI-vs-import seam. A driver script can export its core flow AND still run as a CLI: guard the
// CLI shell with isEntrypoint(import.meta.url) so importing the module (from a test, an API route, or
// the job queue worker) does not trigger its subprocess + DB side effects.
import { fileURLToPath } from 'node:url';

/** True when this module is the script the runtime was invoked with, not one imported by another. */
export function isEntrypoint(moduleUrl: string): boolean {
  return process.argv[1] !== undefined && fileURLToPath(moduleUrl) === process.argv[1];
}
