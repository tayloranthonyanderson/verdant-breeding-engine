// Within-pool recycling facet (ADR-0024 mode 2) for the tomato corpus. For each heterotic pool it builds
// two mating plans side by side — USEFULNESS (greedy μ + i·σ) and OCS (gain capped on group coancestry) —
// plus the gain-vs-coancestry frontier, so the Cross step can teach the contrast. Pure parent-level data:
// the pool roster + per-se merit come from inbreds.csv, the genotypes from markers.csv; marker effects for
// the progeny-variance term are trained on the FULL pool germplasm (both pools) so σ is identifiable.
// Runs the generic cross-recycling.R kernel once per pool. Best-effort: callers wrap in try/catch.
import type { Recycling, RecyclePool } from '@verdant/contracts';
import { runRKernel } from './kernel';
import { loadInbreds, markerPanel } from './tomato-corpus';

// The per-pool recycling block — the shape lives once in the engine contract; the only cast is the
// kernel's `unknown` output narrowed to RecyclePool, at the single point it's consumed (below).
export type RecyclingByPool = Recycling;

/** Within-pool recycling plans (usefulness vs OCS) for each heterotic pool, from inbreds.csv + markers.csv.
 *  Independent of the cut's trials — it operates on the program's inbred pools. Returns null when there
 *  aren't enough genotyped pool lines for a meaningful fit. */
export function buildTomatoRecycling(opts: { nCrosses?: number; selProp?: number } = {}): RecyclingByPool | null {
  const inbreds = [...loadInbreds().values()];
  if (!inbreds.length) return null;
  const mm = markerPanel();
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
    out[pool] = res.recycling as RecyclePool;
  }
  return Object.keys(out).length ? out : null;
}
