// Planner driver — runs the deterministic Model Planner (services/kernel/met-plan.R) and returns
// its data-readiness + Model Plan (ADR-0016). Planning needs only dataset STRUCTURE (no trait
// values), so this is cheap. The TS tier executes whatever the plan names; it makes no scientific
// choice. Crop-agnostic: consumes the generic plot record.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { PlotRecord } from './stage1';

export interface ModelDecision {
  factor: 'spatial' | 'genotype_effect' | 'staging' | 'gxe' | 'engine';
  choice: string;
  reason: string;
  diagnostic?: Record<string, unknown> | null;
}
export interface ReadinessUnlock {
  capability: string;
  blocked_by: string;
  hint: string;
}
export interface ModelPlan {
  model_class: 'single_stage' | 'two_stage';
  staging_weighted: boolean;
  genotype_effect: 'random';
  spatial_method: 'spats' | 'none';
  gxe: { include: boolean; reason: string };
  engine: string;
  relationship: string;
  decisions: ModelDecision[];
  unlocks: ReadinessUnlock[];
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

export function runPlanner(
  variableIds: string[],
  records: PlotRecord[],
  intent = 'selection',
  relationship = 'identity',
): { readiness: Readiness; plan: ModelPlan } {
  const input = {
    variableIds,
    environment: records.map((r) => r.environment),
    genotype: records.map((r) => r.genotype),
    row: records.map((r) => r.row),
    col: records.map((r) => r.col),
    rep: records.map((r) => r.rep),
    intent,
    relationship,
  };
  const script = resolve(import.meta.dirname, '../../../services/kernel/met-plan.R');
  const proc = spawnSync('Rscript', [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (proc.status !== 0) throw new Error(`met-plan.R failed:\n${proc.stderr}`);
  return JSON.parse(proc.stdout) as { readiness: Readiness; plan: ModelPlan };
}
