import type { Bundle, IndexRow } from "./types";

// Client-side mirror of the engine's build_selection_index(): standardize each
// trait's BLUP across genotypes (sample SD, matching R's scale()), sign by
// direction, weight, sum, sort. Runs instantly on slider changes; the server
// remains the source of truth for the BLUPs themselves.
export function recomputeIndex(
  bundle: Bundle,
  weights: Record<string, number>,
  directions: Record<string, number>
): IndexRow[] {
  const traits = bundle.traits;

  const genoSet = new Set<string>();
  for (const t of traits)
    for (const e of bundle.effects[t] ?? []) genoSet.add(e.genotype);
  const genos = Array.from(genoSet).sort();

  // trait -> genotype -> raw BLUP value
  const vmap: Record<string, Record<string, number>> = {};
  for (const t of traits) {
    vmap[t] = {};
    for (const e of bundle.effects[t] ?? []) vmap[t][e.genotype] = e.value;
  }

  // z-score per trait
  const z: Record<string, Record<string, number>> = {};
  for (const t of traits) {
    const vals = genos
      .map((g) => vmap[t][g])
      .filter((v) => v != null && !Number.isNaN(v));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd =
      Math.sqrt(
        vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1)
      ) || 1;
    z[t] = {};
    for (const g of genos) {
      const v = vmap[t][g];
      z[t][g] = v == null || Number.isNaN(v) ? 0 : (v - mean) / sd;
    }
  }

  const rows: IndexRow[] = genos.map((g) => {
    let idx = 0;
    for (const t of traits)
      idx += (z[t][g] ?? 0) * (weights[t] ?? 0) * (directions[t] ?? 1);
    const row: IndexRow = {
      rank: 0,
      genotype: g,
      index: Math.round(idx * 1000) / 1000,
    };
    for (const t of traits) {
      const v = vmap[t][g];
      row[t] = v == null ? NaN : Math.round(v * 1000) / 1000;
    }
    return row;
  });

  rows.sort((a, b) => b.index - a.index);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// Sensible defaults: most traits higher-is-better; maturity lower (earlier) is better.
export function defaultDirections(traits: string[]): Record<string, number> {
  const d: Record<string, number> = {};
  for (const t of traits) d[t] = /matur|days|disease|defect/i.test(t) ? -1 : 1;
  return d;
}

export function defaultWeights(traits: string[]): Record<string, number> {
  const w: Record<string, number> = {};
  for (const t of traits) w[t] = 1;
  return w;
}
