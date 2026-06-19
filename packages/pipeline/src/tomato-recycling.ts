// Within-pool recycling facet (ADR-0024 mode 2) for the tomato corpus. For each heterotic pool it builds
// two mating plans side by side — USEFULNESS (greedy μ + i·σ) and OCS (gain capped on group coancestry) —
// plus the gain-vs-coancestry frontier, so the Cross step can teach the contrast. Pure parent-level data:
// the pool roster + per-se merit come from inbreds.csv, the genotypes from markers.csv; marker effects for
// the progeny-variance term are trained on the FULL pool germplasm (both pools) so σ is identifiable.
// Runs the generic cross-recycling.R kernel once per pool. Best-effort: callers wrap in try/catch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { tomatoCorpusDir } from './paths';
import { runRKernel } from './kernel';
import { loadInbreds } from './tomato-corpus';

let _mm: { byId: Map<string, number[]>; cols: string[] } | null = null;
function markerMatrix(): { byId: Map<string, number[]>; cols: string[] } {
  if (_mm) return _mm;
  const rows = parse(readFileSync(join(tomatoCorpusDir(), 'markers.csv')), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const cols = Object.keys(rows[0] ?? {}).filter((c) => c !== 'genotype');
  const byId = new Map<string, number[]>();
  for (const r of rows) byId.set(r.genotype, cols.map((c) => Number(r[c])));
  return (_mm = { byId, cols });
}

// The kernel's recycling block (loosely typed here; the web tier's lib/ca.ts gives it a rich shape).
export type RecyclingByPool = Record<string, unknown>;

/** Within-pool recycling plans (usefulness vs OCS) for each heterotic pool, from inbreds.csv + markers.csv.
 *  Independent of the cut's trials — it operates on the program's inbred pools. Returns null when there
 *  aren't enough genotyped pool lines for a meaningful fit. */
export function buildTomatoRecycling(opts: { nCrosses?: number; selProp?: number } = {}): RecyclingByPool | null {
  const inbreds = [...loadInbreds().values()];
  if (!inbreds.length) return null;
  const mm = markerMatrix();
  const usable = inbreds.filter((f) => f.per_se != null && f.pool && f.pool !== 'Unassigned' && mm.byId.has(f.name));
  if (usable.length < 16) return null;
  // marker effects are trained on the FULL set of usable pool lines (both pools) → σ identifiable.
  const train_bv = usable.map((f) => f.per_se as number);
  const train_dosage = usable.map((f) => mm.byId.get(f.name) as number[]);

  const pools = [...new Set(usable.map((f) => f.pool))];
  const out: RecyclingByPool = {};
  for (const pool of pools) {
    const members = usable.filter((f) => f.pool === pool);
    if (members.length < 8) continue; // too few lines to recycle within this pool
    const res = runRKernel<{ recycling: unknown }>('cross-recycling.R', {
      pool,
      members: members.map((f) => f.name),
      bv: members.map((f) => f.per_se),
      dosage: members.map((f) => mm.byId.get(f.name)),
      train_bv, train_dosage,
      n_crosses: opts.nCrosses ?? 15, max_per_parent: 15, sel_prop: opts.selProp ?? 0.10,
    }, { transport: 'cfg-file', maxBuffer: 1 << 28 });
    out[pool] = res.recycling;
  }
  return Object.keys(out).length ? out : null;
}
