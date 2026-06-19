// Product cross planner (ADR-0024) — the FORWARD decision: "which product cross is most likely to
// succeed?" A pure, client-side derivation over the combining_ability the bundle already carries
// (per-line per-trait GCA, heterotic pool, marker alleles, the market objective) — the same pattern as
// the GCA lenses in ./ca. It pairs the best general combiners ACROSS heterotic pools, ranks each A×B by
// the market-weighted sum of parental GCA, gates a cross on whether it DELIVERS the required allele
// (either parent carries the favourable allele → a dominant resistance fixes in the F1), and greedily
// composes a portfolio under a per-parent use cap.
//
// GCA-only BY DESIGN: these crosses are unmade, so SCA (the cross-specific deviation) is unknowable until
// they are tested — GCA is exactly the predictable, transmissible part, and is the correct predictor of
// an unobserved cross. OCS / coancestry control is deliberately ABSENT at the product level: the
// heterotic-pool split already supplies the diversity, and the F1 is a terminal product with no
// inbreeding to manage. Coancestry belongs to the pool-RECYCLING planner (ADR-0024, deferred), not here.
import { activeGateLoci, type CaGca, type CaIndexWeight, type CombiningAbility, type MarkerGates } from "./ca";

export interface CrossTraitTerm {
  variable_id: string; mode: "max" | "min"; weight: number;
  combined_gca: number;     // gca(parent1) + gca(parent2), trait units
  p1: number; p2: number;   // per-parent GCA, trait units
  merit: number;            // standardized, direction- & weight-adjusted contribution to the cross index
}
export interface CrossGateStatus { locus: string; trait: string; delivered: boolean; carriers: string[] }
export interface CrossCandidate {
  key: string;              // `${parent1}×${parent2}`
  parent1: string; parent2: string;
  merit: number;            // market-weighted standardized cross index (z-units)
  rank: number;             // 1-based over all candidates (gated pushed below survivors)
  perTrait: CrossTraitTerm[];
  gates: CrossGateStatus[];
  gatedOut: boolean;
  selected: boolean;        // in the greedy portfolio
  reasons: string[];        // deterministic "why" chips
}
export interface CrossPlanParams { gates: MarkerGates; maxPerParent: number; nCrosses: number; excluded: Set<string> }
export interface CrossPlan {
  pools: [string, string] | null;
  objective: CaIndexWeight[];
  candidates: CrossCandidate[];   // every A×B, ranked
  selected: CrossCandidate[];     // the portfolio, in plan order
  nParentsUsed: number;
  note: string | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => { const m = mean(xs); const v = mean(xs.map((x) => (x - m) ** 2)); return Math.sqrt(v) || 1; };
const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const humanizeTrait = (id: string) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** The market objective the cross index ranks on (the same signed weights the kernel used for GCA). */
export function objectiveFromCa(ca: CombiningAbility): CaIndexWeight[] {
  if (ca.index_weights?.length) return ca.index_weights;
  return ca.index_traits.map((id) => ({ variable_id: id, mode: "max" as const, weight: 1 }));
}

/** The two largest named heterotic pools — the across-pool product cross pairs these. */
export function twoPools(ca: CombiningAbility): [string, string] | null {
  const pools = [...ca.topology.pools].filter((p) => p.pool && p.pool !== "Unassigned").sort((a, b) => b.n - a.n).map((p) => p.pool);
  return pools.length >= 2 ? [pools[0], pools[1]] : null;
}

function reasonsFor(c: CrossCandidate): string[] {
  const out: string[] = [];
  // strongest objective trait by the cross's standardized merit contribution
  const ranked = [...c.perTrait].sort((a, b) => b.merit - a.merit);
  if (ranked[0] && ranked[0].merit > 0.15) out.push(`strong ${humanizeTrait(ranked[0].variable_id)}`);
  // complementarity: an objective trait where one parent is a weakness (wrong-direction GCA) and the
  // partner more than covers it — the classic "B fills A's gap" expert read.
  for (const t of ranked) {
    const dir = t.mode === "min" ? -1 : 1;
    const d1 = dir * t.p1, d2 = dir * t.p2;            // favourable-direction GCA per parent
    if (Math.min(d1, d2) < 0 && Math.max(d1, d2) > 0 && d1 + d2 > 0) {
      const strong = d1 >= d2 ? c.parent1 : c.parent2;
      const weak = d1 >= d2 ? c.parent2 : c.parent1;
      out.push(`${strong} covers ${weak}'s ${humanizeTrait(t.variable_id)}`);
      break;
    }
  }
  for (const g of c.gates) if (g.delivered) out.push(`carries ${g.locus}`);
  return out.slice(0, 4);
}

export function buildCrossPlan(ca: CombiningAbility, params: CrossPlanParams): CrossPlan {
  const objective = objectiveFromCa(ca);
  const pp = twoPools(ca);
  if (!pp) return { pools: null, objective, candidates: [], selected: [], nParentsUsed: 0, note: "Two heterotic pools are needed to plan across-pool product crosses; this cut has one." };
  const [poolA, poolB] = pp;
  const A = ca.gca.filter((g) => g.pool === poolA);
  const B = ca.gca.filter((g) => g.pool === poolB);
  if (!A.length || !B.length) return { pools: pp, objective, candidates: [], selected: [], nParentsUsed: 0, note: "A pool has no genotyped lines to cross." };

  // enumerate every across-pool A×B and its per-trait combined GCA (parent sum, trait units)
  type Raw = { a: CaGca; b: CaGca; key: string; sums: Record<string, number> };
  const raws: Raw[] = [];
  for (const a of A) for (const b of B) {
    const sums: Record<string, number> = {};
    for (const w of objective) sums[w.variable_id] = (a.values[w.variable_id] ?? 0) + (b.values[w.variable_id] ?? 0);
    raws.push({ a, b, key: `${a.line}×${b.line}`, sums });
  }

  // standardize each objective trait's combined GCA across all candidates → a transparent weighted index
  const stat: Record<string, { m: number; s: number }> = {};
  for (const w of objective) { const xs = raws.map((r) => r.sums[w.variable_id]); stat[w.variable_id] = { m: mean(xs), s: sd(xs) }; }

  const activeLoci = activeGateLoci(params.gates);
  const lociTrait = new Map((ca.loci_catalog ?? []).map((L) => [L.locus, L.trait]));

  const candidates: CrossCandidate[] = raws.map((r) => {
    const perTrait: CrossTraitTerm[] = objective.map((w) => {
      const z = (r.sums[w.variable_id] - stat[w.variable_id].m) / stat[w.variable_id].s;
      return {
        variable_id: w.variable_id, mode: w.mode, weight: w.weight,
        combined_gca: r3(r.sums[w.variable_id]), p1: r3(r.a.values[w.variable_id] ?? 0), p2: r3(r.b.values[w.variable_id] ?? 0),
        merit: (w.mode === "min" ? -z : z) * w.weight,
      };
    });
    const merit = perTrait.reduce((acc, t) => acc + t.merit, 0);
    const gates: CrossGateStatus[] = activeLoci.map((locus) => {
      const want = params.gates[locus] ?? [];
      const a1 = r.a.loci?.[locus], b1 = r.b.loci?.[locus];
      const aHas = !!a1 && want.includes(a1), bHas = !!b1 && want.includes(b1);
      const carriers = [aHas ? r.a.line : null, bHas ? r.b.line : null].filter(Boolean) as string[];
      return { locus, trait: lociTrait.get(locus) ?? locus, delivered: aHas || bHas, carriers };
    });
    return {
      key: r.key, parent1: r.a.line, parent2: r.b.line,
      merit, rank: 0, perTrait, gates, gatedOut: gates.some((g) => !g.delivered), selected: false, reasons: [],
    };
  });

  // rank survivors by merit; gated crosses fall below them
  candidates.sort((x, y) => Number(x.gatedOut) - Number(y.gatedOut) || y.merit - x.merit);
  candidates.forEach((c, i) => { c.rank = i + 1; });

  // greedy portfolio: take the best crosses under the per-parent use cap, skipping gated/excluded
  const uses = new Map<string, number>();
  const selected: CrossCandidate[] = [];
  for (const c of candidates) {
    if (selected.length >= params.nCrosses) break;
    if (c.gatedOut || params.excluded.has(c.key)) continue;
    const u1 = uses.get(c.parent1) ?? 0, u2 = uses.get(c.parent2) ?? 0;
    if (u1 >= params.maxPerParent || u2 >= params.maxPerParent) continue;
    c.selected = true; selected.push(c);
    uses.set(c.parent1, u1 + 1); uses.set(c.parent2, u2 + 1);
  }
  for (const c of selected) c.reasons = reasonsFor(c);

  return { pools: pp, objective, candidates, selected, nParentsUsed: uses.size, note: null };
}
