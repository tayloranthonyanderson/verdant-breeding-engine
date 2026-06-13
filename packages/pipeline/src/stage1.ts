// Stage 1 of the two-stage MET (ADR-0014, ADR-0015): within-environment spatial de-trending.
// Drives services/kernel/stage1-spatial.R, which fits a spatial model per environment × trait and
// returns spatially-adjusted entry means (BLUEs) + weights. Crop-agnostic: consumes the generic plot
// record (no dataset column names) and hands the adjusted means to the multi-trait BLUPF90 adapter.
import { runRKernel } from './kernel';

/** Generic plot record (ADR-0015) — what every ingestion adapter emits, no crop/dataset names. */
export interface PlotRecord {
  genotype: string;
  environment: string;
  row: number | null; // generic field coordinate
  col: number | null;
  rep: string | number | null; // generic design factor
  values: Array<number | null>; // aligned to variableIds
}

/** One spatially-adjusted entry mean per genotype × environment, with per-trait weights (1/SE²). */
export interface AdjustedMean {
  environment: string;
  genotype: string;
  values: Array<number | null>;
  weights: Array<number | null>;
}

export interface Stage1Provenance {
  environment: string;
  variable_id: string;
  method: 'spats' | 'lsmeans' | 'means' | 'skipped';
  n_obs: number;
  n_geno: number;
}

export interface Stage1Result {
  adjusted: AdjustedMean[];
  stage1: Stage1Provenance[];
  /** Per-trait Model QC computed from the REAL spatially-adjusted residuals (ADR-0021). Keyed by
   *  variable_id; shape matches model-qc.R's per-trait output (residual_source = 'fit'). */
  model_qc?: Record<string, unknown>;
  /** Per-trait field triptych (raw → fitted spatial trend → residual, same env) for the "see the
   *  spatial correction" view (ADR-0021). Keyed by variable_id. */
  field_trends?: Record<string, unknown>;
}

/** Run the spatial de-trending kernel over plot records, returning adjusted entry means per env +
 *  Model QC from the real residuals. `plotId` (when present) tags residuals back to their plot. */
export function spatialStage1(variableIds: string[], records: Array<PlotRecord & { plotId?: string }>): Stage1Result {
  const input = {
    variableIds,
    environment: records.map((r) => r.environment),
    genotype: records.map((r) => r.genotype),
    row: records.map((r) => r.row),
    col: records.map((r) => r.col),
    rep: records.map((r) => r.rep),
    plot_id: records.map((r) => r.plotId ?? null),
    values: records.map((r) => r.values),
  };
  return runRKernel<Stage1Result>('stage1-spatial.R', input);
}
