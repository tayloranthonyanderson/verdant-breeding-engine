// Typed view over bundle.combining_ability. The facet shapes live ONCE in the engine contract
// (@verdant/contracts) — re-exported here so web components keep importing them from "@/lib/ca", while
// this module adds the web-only selection/index helpers. Kernel source: combining-ability.R /
// cross-recycling.R (ADR-0019/0020/0024).
import { combiningAbilityOf, recyclingOf } from "@verdant/contracts";
import type {
  ResultBundle, CombiningAbility, CaDecision, CaTopology, CaDiagnostics, CaTraitSummary, CaLocus, CaGca,
  CaRankRow, CaPoolRanking, CaHybrid, CaScaCell, CaDivergence, CaIndexWeight,
  RecycleCross, RecyclePlanBlock, RecyclePoint, RecyclePool, Recycling,
} from "@verdant/contracts";
export type {
  CombiningAbility, CaDecision, CaTopology, CaDiagnostics, CaTraitSummary, CaLocus, CaGca,
  CaRankRow, CaPoolRanking, CaHybrid, CaScaCell, CaDivergence, CaIndexWeight,
  RecycleCross, RecyclePlanBlock, RecyclePoint, RecyclePool, Recycling,
};

/** Narrow bundle.combining_ability into the rich facet view (delegates to the contract's one read seam). */
export const getCombiningAbility = combiningAbilityOf;

// Marker gates: locus → the desired allele(s). A line is gated OUT if, at any locus with a non-empty
// selection, its homozygous allele is not among the desired ones (independent culling — ADR-0020).
export type MarkerGates = Record<string, string[]>;
export function activeGateLoci(gates: MarkerGates): string[] {
  return Object.keys(gates).filter((l) => (gates[l]?.length ?? 0) > 0);
}
export function lineFailsGates(g: CaGca, gates: MarkerGates): boolean {
  for (const locus of activeGateLoci(gates)) {
    const allele = g.loci?.[locus];
    if (!allele || !gates[locus].includes(allele)) return true;
  }
  return false;
}
/** The set of line names culled by the active gates (across all pools). */
export function gatedSet(ca: CombiningAbility, gates: MarkerGates): Set<string> {
  const out = new Set<string>();
  if (activeGateLoci(gates).length === 0) return out;
  for (const g of ca.gca) if (lineFailsGates(g, gates)) out.add(g.line);
  return out;
}

// Advancement wiring shared across the selection levels.
export interface AdvancementRow { candidate: string; unit: string; pool: string | null; disposition: string }
export type AdvanceFn = (candidate: string, unit: "inbred" | "hybrid", pool: string | null, disposition: string) => void;
export type AdvanceManyFn = (rows: Array<{ candidate: string; unit: "inbred" | "hybrid"; pool: string | null; disposition: string }>) => void;

/** A line's GCA facts joined to its rank within pool, for the ranking table. */
export interface GcaRow extends CaGca { rank: number; score: number; gated_out: boolean; gate_failures: string[] }
export function gcaRowsForPool(ca: CombiningAbility, pool: string): GcaRow[] {
  const byLine = new Map(ca.gca.map((g) => [g.line, g]));
  const pr = ca.pool_rankings.find((p) => p.pool === pool);
  if (!pr) return [];
  return pr.ranking.map((r) => ({ ...(byLine.get(r.line) as CaGca), rank: r.rank, score: r.score, gated_out: r.gated_out, gate_failures: r.gate_failures }));
}

export const fmt = (v: number | null | undefined, d = 2): string =>
  v == null || Number.isNaN(v) ? "–" : v.toFixed(d);

// --- Genetic (desired-gains) GCA lens: synthesize a per-pool bundle so the EXISTING
// DesiredGainsExplorer / IndexDivergence run on GCA verbatim (within pool). ---------------------

/** Fallback desired gains (genetic-SD units) for legacy G2F bundles that don't carry the signed
 *  objective. Keyed by trait so order-independent. */
export const DEFAULT_GCA_GAINS: Record<string, number> = {
  Yield_Mg_ha: 1, Grain_Moisture: -1, Plant_Height_cm: 0.5, Ear_Height_cm: -0.5,
};

/** Desired gains derived from the CA objective the kernel actually used (direction from mode, magnitude
 *  from weight) — dataset-agnostic. Falls back to the maize default for bundles without index_weights. */
export function gcaGains(ca: CombiningAbility): Record<string, number> {
  const iw = ca.index_weights;
  if (!iw?.length) return DEFAULT_GCA_GAINS;
  const out: Record<string, number> = {};
  for (const w of iw) out[w.variable_id] = (w.mode === "min" ? -1 : 1) * (w.weight || 1);
  return out;
}

/** The kernel's within-pool transparent (stated) GCA ranking as {germplasm_id, rank}, gated lines culled. */
export function statedRankingForPool(ca: CombiningAbility, pool: string, exclude?: Set<string>): Array<{ germplasm_id: string; rank: number }> {
  const pr = ca.pool_rankings.find((p) => p.pool === pool);
  return (pr?.ranking ?? [])
    .filter((r) => !exclude?.has(r.line))
    .map((r, i) => ({ germplasm_id: r.line, rank: i + 1 }));
}

function solveLin(A: number[][], rhs: number[]): number[] {
  const n = rhs.length, M = A.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / piv; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** The genetically-aware (desired-gains) within-pool GCA ranking: b = G⁻¹(d·σ), rank on b·GCA. */
export function geneticRankingForPool(ca: CombiningAbility, pool: string, gains = gcaGains(ca), exclude?: Set<string>): Array<{ germplasm_id: string; rank: number }> {
  const traits = ca.gca_genetic_correlations.variable_ids;
  const sd = traits.map((id) => ca.traits.find((t) => t.variable_id === id)?.genetic_sd ?? 1);
  const C = ca.gca_genetic_correlations.matrix;
  const G = C.map((row, i) => row.map((c, j) => (c ?? 0) * (sd[i] ?? 1) * (sd[j] ?? 1)));
  const b = solveLin(G, traits.map((id, j) => (gains[id] ?? 0) * (sd[j] ?? 1)));
  const members = ca.gca.filter((g) => g.pool === pool && !exclude?.has(g.line));
  return members
    .map((g) => ({ id: g.line, s: traits.reduce((acc, id, j) => acc + b[j] * (g.values[id] ?? 0), 0) }))
    .sort((a, z) => z.s - a.s)
    .map((r, i) => ({ germplasm_id: r.id, rank: i + 1 }));
}

/** A ResultBundle-shaped slice for one pool: per-line GCA as the trait effects, the GCA genetic
 *  correlation as G, and the stated + desired-gains seed indices. Only the fields the index
 *  components read are populated; the rest is a typed stub. */
export function gcaBundleForPool(ca: CombiningAbility, pool: string, exclude?: Set<string>): ResultBundle {
  const traits = ca.gca_genetic_correlations.variable_ids;
  const members = ca.gca.filter((g) => g.pool === pool && !exclude?.has(g.line));
  const sdByTrait = new Map(ca.traits.map((t) => [t.variable_id, t.genetic_sd]));
  const traitObjs = traits.map((id) => ({
    variable_id: id, status: "ok" as const, genetic_sd: sdByTrait.get(id) ?? 1,
    effects: members.map((g) => ({ germplasm_id: g.line, value: g.values[id] ?? null, type: "BLUP" as const })),
    varcomp: [], diagnostics: null, warnings: [],
  }));
  const stub = {
    contract_version: "v0", status: "ok", intent: "selection",
    chosen_model: { genotype_effect: "random", relationship: "identity", rationale: "" },
    traits: traitObjs,
    genetic_correlations: { variable_ids: traits, matrix: ca.gca_genetic_correlations.matrix },
    indices: [
      { kind: "weighted", segment_id: `pool-${pool}`, ranking: statedRankingForPool(ca, pool, exclude).map((r) => ({ ...r, score: null, gated_out: false, gate_failures: [] })) },
      { kind: "desired_gains", segment_id: `pool-${pool}`, ranking: [], weights_used: traits.map((id) => { const g = gcaGains(ca); return { variable_id: id, weight: g[id] ?? 0, direction: ((g[id] ?? 0) < 0 ? -1 : 1) as 1 | -1 }; }) },
    ],
    divergence: null, warnings: [], provenance: { contract_version: "v0" },
  };
  return stub as unknown as ResultBundle;
}

// --- Within-pool recycling (ADR-0024 mode 2): usefulness vs OCS, per heterotic pool ------------
// The shapes (RecyclePool / Recycling / …) live in @verdant/contracts and are re-exported at the top.
/** The per-pool recycling plans attached to combining_ability (delegates to the contract's read seam). */
export const getRecycling = recyclingOf;
