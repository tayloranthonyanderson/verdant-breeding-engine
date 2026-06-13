// Data Quality (pre-fit) + Model QC (post-fit) + raw-data selection — the pipeline glue (ADR-0021).
//
// Drives services/kernel/data-quality.R (the crude pre-fit value-level pass) and model-qc.R (the
// proper post-fit residual pass), and applies the breeder's `data_overrides` exclusion overlay BEFORE
// the fit so a data choice re-plans the model (decision-C: exclusion is the sole data→model channel).
// The kernel stays advisory — it never removes data; this module only filters what the breeder chose.
import { runRKernel } from './kernel';
import type { PlotRecord } from './stage1';
import type { ResultBundle, AnalysisRequest } from '@verdant/contracts';

/** A plot record carrying a stable id, so plot-level findings/exclusions can name an observation. */
export type QcRecord = PlotRecord & { plotId: string };

type Exclusions = NonNullable<AnalysisRequest['data_overrides']>['exclusions'];
type TraitDiagnostics = NonNullable<ResultBundle['traits'][number]['diagnostics']>;

/** Stable, human-readable plot id. The trailing original index guarantees uniqueness + stability
 *  across re-parses (deterministic CSV order), so an observation-unit exclusion still resolves on
 *  the next run even though duplicate (env,geno,row,col) cells legitimately exist. */
export function attachPlotIds(records: PlotRecord[]): QcRecord[] {
  return records.map((r, i) => ({
    ...r,
    plotId: `${r.environment} · ${r.genotype} · r${r.row ?? '?'}/c${r.col ?? '?'} #${i}`,
  }));
}

export interface AppliedExclusions {
  records: QcRecord[];
  removed: number;
  environments: string[];
  germplasm: string[];
  plots: string[];
}

/** Apply the analysis-scoped exclusion overlay to the records before the fit. The contract allows
 *  environment / germplasm / observation_unit — every kind is handled here, so nothing is silently
 *  dropped. (Trait selection is a separate concern: the objective's index weights, not this overlay.) */
export function applyDataOverrides(records: QcRecord[], exclusions: Exclusions = []): AppliedExclusions {
  const envs = new Set<string>();
  const genos = new Set<string>();
  const plots = new Set<string>();
  for (const ex of exclusions ?? []) {
    if (ex.target.kind === 'environment') envs.add(ex.target.id);
    else if (ex.target.kind === 'germplasm') genos.add(ex.target.id);
    else if (ex.target.kind === 'observation_unit') plots.add(ex.target.id);
  }
  const kept = records.filter(
    (r) => !envs.has(r.environment) && !genos.has(r.genotype) && !plots.has(r.plotId),
  );
  return {
    records: kept,
    removed: records.length - kept.length,
    environments: [...envs],
    germplasm: [...genos],
    plots: [...plots],
  };
}

/** Build the shared {parallel-arrays + values_by_trait} payload the two QC kernels read. */
function qcPayload(records: QcRecord[], traits: string[]) {
  const values_by_trait: Record<string, Array<number | null>> = {};
  traits.forEach((t, j) => {
    values_by_trait[t] = records.map((r) => r.values[j] ?? null);
  });
  return {
    variable_ids: traits,
    genotype: records.map((r) => r.genotype),
    environment: records.map((r) => r.environment),
    row: records.map((r) => r.row),
    col: records.map((r) => r.col),
    rep: records.map((r) => r.rep),
    plot_id: records.map((r) => r.plotId),
    values_by_trait,
  };
}

/** Pre-fit Data Quality: the structured `data_quality` bundle section (ADR-0021). Best-effort — a QC
 *  failure must never sink the analysis. */
export function runDataQuality(records: QcRecord[], traits: string[]): ResultBundle['data_quality'] | null {
  try {
    return runRKernel<ResultBundle['data_quality']>('data-quality.R', qcPayload(records, traits), {
      transport: 'cfg-file',
    });
  } catch (e) {
    console.log(`data-quality skipped: ${(e as Error).message}`);
    return null;
  }
}

/** Per-trait Model QC raw output from model-qc.R (residual diagnostics keyed by trait). */
export type ModelQcByTrait = Record<
  string,
  {
    residual_normality_p?: number | null;
    residual_skew?: number | null;
    residual_kurtosis?: number | null;
    heteroscedasticity_p?: number | null;
    heteroscedasticity_rho?: number | null;
    spatial_residual_autocorr?: number | null;
    residual_source?: 'fit' | 'reconstructed' | null;
    n_resid?: number;
    n_influential?: number;
    influential?: TraitDiagnostics['influential'];
    viz?: TraitDiagnostics['viz'];
  }
>;

/** Post-fit Model QC: reconstructs conditional residuals from the fitted BLUPs (no refit) and returns
 *  per-trait residual diagnostics. `blupsByTrait[trait][genotype] = blup`. Best-effort. */
export function runModelQc(
  records: QcRecord[],
  traits: string[],
  blupsByTrait: Record<string, Record<string, number>>,
): ModelQcByTrait {
  try {
    return runRKernel<ModelQcByTrait>(
      'model-qc.R',
      { ...qcPayload(records, traits), blups_by_trait: blupsByTrait },
      { transport: 'cfg-file' },
    );
  } catch (e) {
    console.log(`model-qc skipped: ${(e as Error).message}`);
    return {};
  }
}

/** Variance-component sanity flags computed in TS from the components already in hand (ADR-0021). */
export function boundaryFlags(vg: number, vge: number, ve: number): { h2_boundary: boolean; varcomp_boundary: boolean } {
  const denom = vg + vge + ve;
  const h2 = denom > 0 ? vg / denom : 0;
  return {
    h2_boundary: !Number.isFinite(h2) || h2 <= 1e-4 || h2 >= 1 - 1e-4,
    varcomp_boundary: vg <= 1e-8 || ve <= 1e-8,
  };
}

/** Merge the residual diagnostics + boundary flags into a trait's `diagnostics` object. */
export function mergeTraitDiagnostics(
  base: TraitDiagnostics,
  mq: ModelQcByTrait[string] | undefined,
  flags: { h2_boundary: boolean; varcomp_boundary: boolean },
): TraitDiagnostics {
  return {
    ...base,
    ...(mq
      ? {
          residual_normality_p: mq.residual_normality_p ?? null,
          residual_skew: mq.residual_skew ?? null,
          residual_kurtosis: mq.residual_kurtosis ?? null,
          heteroscedasticity_p: mq.heteroscedasticity_p ?? null,
          heteroscedasticity_rho: mq.heteroscedasticity_rho ?? null,
          spatial_residual_autocorr: mq.spatial_residual_autocorr ?? null,
          residual_source: mq.residual_source ?? null,
          influential: mq.influential ?? [],
          viz: mq.viz ?? null,
        }
      : {}),
    h2_boundary: flags.h2_boundary,
    varcomp_boundary: flags.varcomp_boundary,
  };
}
