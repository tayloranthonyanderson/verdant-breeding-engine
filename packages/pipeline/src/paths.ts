// Repo-anchored paths. The pipeline runs in two contexts: the tsx CLI (cwd = a package dir) and the
// bundled Next.js server (where `import.meta.dirname` is undefined and module-relative paths don't
// survive bundling). So we locate the repo root by walking up from cwd (and, as a fallback, from this
// module's own dir under tsx) until `services/kernel` is found, and resolve everything from there.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

export function repoRoot(): string {
  if (cached) return cached;
  const starts: string[] = [process.cwd()];
  try {
    starts.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* import.meta.url unavailable in some bundlers — cwd is enough */
  }
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      if (existsSync(resolve(dir, 'services/kernel'))) return (cached = dir);
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error('could not locate repo root (no services/kernel walking up from cwd)');
}

/** services/kernel — where the R kernel scripts live. */
export const kernelDir = (): string => resolve(repoRoot(), 'services/kernel');
/** The G2F dev fixture CSV (ADR-0015: a fixture, not a built-in). */
export const metFixture = (): string => resolve(repoRoot(), 'data/g2f/MET_2019.csv');
/** The synthetic tomato program corpus (services/kernel/sim-corpus.R output). */
export const tomatoCorpusDir = (): string => resolve(repoRoot(), 'data/tomato');
