// The rich "facet" shapes the R compute kernel emits inside the result bundle — the combining_ability
// view (ADR-0019/0020) and its within-pool recycling sub-block (ADR-0024 mode 2). The generated
// ResultBundle types these loosely (additionalProperties, to accept whatever the kernel emits); THIS is
// the one typed home both the pipeline (which builds them) and the web tier (which renders them) import,
// plus the two helpers that cross the loose→rich seam in a single place.
import type { ResultBundle } from './generated/result-bundle';

// --- combining ability (ADR-0019/0020) ---------------------------------------------------------
export interface CaDecision { factor: string; choice: string; reason: string; diagnostic?: Record<string, unknown> }
export interface CaTopology {
  kind: string; n_lines: number; n_testers: number; eff_testers: number; n_crosses: number;
  tester_effect: "fixed" | "random"; sca_included: boolean;
  pools: Array<{ pool: string; n: number }>;
  decisions: CaDecision[];
}
export interface CaDiagnostics {
  degree: { min: number; median: number; max: number; distribution: Record<string, number> };
  connectivity: { components: number; connected: boolean };
  replication: { replicated_crosses: number; total_crosses: number };
}
export interface CaTraitSummary { variable_id: string; varcomp: Array<{ component: string; variance: number }>; genetic_sd: number | null; baker_ratio: number | null }
export interface CaLocus { locus: string; trait: string; alleles: [string, string]; favorable: string; freq: number }
export interface CaGca {
  line: string; pool: string;
  cross_degree: { n_testers: number; n_plots: number };
  per_se: number | null; nclb_resistant: number | null;
  loci?: Record<string, string> | null;
  values: Record<string, number | null>;
}
export interface CaRankRow { line: string; pool: string; score: number; rank: number; gated_out: boolean; gate_failures: string[] }
export interface CaPoolRanking { pool: string; n: number; ranking: CaRankRow[] }
export interface CaHybrid {
  hybrid: string; line: string; tester: string; pool: string; n_plots: number; rank: number; score: number;
  observed: Record<string, number | null>; line_gca: Record<string, number | null>;
}
export interface CaScaCell { line: string; tester: string; value: number }
export interface CaDivergence {
  compared: string[]; rank_correlation: number | null;
  notable_movers: Array<{ line: string; pool: string; rank_delta: number; per_se: number; gca_score: number }>;
}
export interface CaIndexWeight { variable_id: string; mode: "max" | "min"; weight: number }

// --- within-pool recycling (ADR-0024 mode 2): usefulness vs OCS, per heterotic pool -------------
export interface RecycleCross { p1: string; p2: string; midparent: number; sigma: number; usefulness: number; coancestry: number }
export interface RecyclePlanBlock { crosses: RecycleCross[]; n_crosses: number; n_parents: number; gain: number; coancestry: number; eff_parents: number; target_coancestry?: number }
export interface RecyclePoint { gain: number; coancestry: number; eff_parents: number }
export interface RecyclePool {
  pool: string; n_members: number; sel_prop: number; selection_intensity: number; n_crosses: number;
  members: Array<{ id: string; bv: number; contribution: number }>;
  candidates: RecycleCross[];
  usefulness_plan: RecyclePlanBlock;
  ocs_plan: RecyclePlanBlock;
  frontier: Array<{ gain: number; coancestry: number }>;
  comparison: {
    coancestry_floor: number; shared_crosses: number;
    usefulness_point: RecyclePoint; ocs_point: RecyclePoint;
    gain_cost: number; coancestry_saved: number; eff_parents_gained: number;
  };
}
export type Recycling = Record<string, RecyclePool>;

export interface CombiningAbility {
  topology: CaTopology;
  diagnostics: CaDiagnostics;
  traits: CaTraitSummary[];
  gca_genetic_correlations: { variable_ids: string[]; matrix: number[][] };
  loci_catalog?: CaLocus[];
  index_traits: string[];
  index_weights?: CaIndexWeight[];
  gca: CaGca[];
  pool_rankings: CaPoolRanking[];
  hybrids: CaHybrid[];
  sca: CaScaCell[];
  divergence: CaDivergence;
  recycling?: Recycling | null;
}

/** Narrow the loosely-typed `bundle.combining_ability` into the rich facet view — the single read seam. */
export function combiningAbilityOf(bundle: ResultBundle): CombiningAbility | null {
  const ca = (bundle as { combining_ability?: unknown }).combining_ability;
  return ca ? (ca as unknown as CombiningAbility) : null;
}
/** The per-pool recycling plans attached to combining_ability (null when the pools were too small). */
export function recyclingOf(ca: CombiningAbility | null): Recycling | null {
  const r = ca?.recycling;
  return r && typeof r === "object" && Object.keys(r).length ? r : null;
}
