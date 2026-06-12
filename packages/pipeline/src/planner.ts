// Planner driver — runs the deterministic Model Planner (services/kernel/met-plan.R) and returns
// its data-readiness + Model Plan (ADR-0016). Planning needs only dataset STRUCTURE (no trait
// values), so this is cheap. The TS tier executes whatever the plan names; it makes no scientific
// choice. Crop-agnostic: consumes the generic plot record.
import { runRKernel } from './kernel';
import type { PlotRecord } from './stage1';

export interface ModelDecision {
  factor: 'spatial' | 'genotype_effect' | 'staging' | 'gxe' | 'relationship' | 'engine';
  choice: string;
  reason: string;
  diagnostic?: Record<string, unknown> | null;
  source?: 'recommended' | 'overridden';
  recommended?: string | null;
  feasible?: boolean;
  refused_reason?: string | null;
  evidence?: Record<string, unknown> | null;
}
export interface ReadinessUnlock {
  capability: string;
  blocked_by: string;
  hint: string;
}
export interface OverridableFactor {
  factor: 'spatial' | 'staging' | 'gxe' | 'relationship' | 'engine';
  options: Array<{ value: string; feasible: boolean; reason?: string | null }>;
}
/** The breeder's override intents (ADR-0018) — preferred values for decisions the planner makes. */
export interface ModelOverrides {
  spatial?: 'spats' | 'none' | null;
  staging?: 'single_stage' | 'two_stage' | null;
  gxe?: 'include' | 'skip' | null;
  relationship?: 'identity' | 'A' | 'G' | 'H' | null;
  engine?: 'rrblup' | 'blupf90' | null;
}
/** Genomic readiness the plot structure can't see — supplied by the driver from buildGenomicInputs. */
export interface GenomicReadiness {
  markers_present: boolean;
  pedigree_present: boolean;
  n_genotyped: number;
}
export interface ModelPlan {
  model_class: 'single_stage' | 'two_stage';
  staging_weighted: boolean;
  genotype_effect: 'random';
  spatial_method: 'spats' | 'none';
  gxe: { include: boolean; reason: string };
  engine: string;
  /** resolved genomic prediction engine (rrblup | blupf90), or null when no markers. */
  genomic_engine: string | null;
  relationship: string;
  decisions: ModelDecision[];
  unlocks: ReadinessUnlock[];
  overridable: OverridableFactor[];
}
export interface Readiness {
  scale: { n_obs: number; n_geno: number; n_env: number; n_cells: number; n_traits: number };
  is_met: boolean;
  connectivity: { connectors: number; frac_connectors: number; median_env_per_geno: number; gxe_connectivity_ok: boolean };
  replication: { environments_with_within_rep: number; residual_identifiable: boolean };
  grids: { any_grid: boolean; all_grid: boolean };
  gxe_estimable: boolean;
  environments: Array<Record<string, unknown>>;
}

export interface PlannerExtras {
  intent?: string;
  relationship?: string;
  /** Breeder overrides (ADR-0018); the planner validates + may refuse each. */
  overrides?: ModelOverrides;
  /** Relationship CV summary (model → mean predictive ability) so the recommendation is the CV winner. */
  evidence?: Record<string, number>;
  /** Genomic data presence the plot structure can't see. */
  genomic?: GenomicReadiness;
}

export function runPlanner(
  variableIds: string[],
  records: PlotRecord[],
  extras: PlannerExtras = {},
): { readiness: Readiness; plan: ModelPlan } {
  const input = {
    variableIds,
    environment: records.map((r) => r.environment),
    genotype: records.map((r) => r.genotype),
    row: records.map((r) => r.row),
    col: records.map((r) => r.col),
    rep: records.map((r) => r.rep),
    intent: extras.intent ?? 'selection',
    relationship: extras.relationship ?? 'identity',
    overrides: extras.overrides,
    evidence: extras.evidence,
    genomic: extras.genomic,
  };
  return runRKernel<{ readiness: Readiness; plan: ModelPlan }>('met-plan.R', input);
}
