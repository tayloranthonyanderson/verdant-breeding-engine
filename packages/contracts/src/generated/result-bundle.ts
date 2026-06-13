/* AUTO-GENERATED from v0/result-bundle.schema.json — do not edit by hand.
 * Regenerate with: pnpm --filter @verdant/contracts codegen */

/**
 * The single object an analysis produces (CONTEXT.md 'result bundle'). The GUI renders it and the AI queries it; it is NEVER re-derived elsewhere — statistics live only in the kernel (ADR-0001/0002). Persisted whole as JSONB. The AI narrates this bundle and may cite only what is in it (groundedness; ADR-0002). See contracts/README.md and DOMAIN-MODEL §6.
 */
export interface ResultBundle {
  contract_version: 'v0';
  /**
   * Echo of the request's id, if supplied.
   */
  analysis_request_id?: string | null;
  /**
   * ok = every requested trait fit; partial = some traits failed (see per-trait status + warnings); error = the run could not produce usable results (see warnings).
   */
  status: 'ok' | 'partial' | 'error';
  /**
   * Echo of the request intent, for renderers/AI that read only the bundle.
   */
  intent: 'selection' | 'comparison' | 'prediction';
  /**
   * The kernel's record of WHAT model it chose and WHY (ADR-0002). This is what the AI narrates; the AI explains the choice and never makes it. The most load-bearing field for trust.
   */
  chosen_model: {
    /**
     * Plain-language one-liner, e.g. 'Spatial mixed model with AR1×AR1 errors; genotype random (BLUPs).'
     */
    description?: string;
    /**
     * The actual fitted model formula, for the curious/advanced view. Hidden by default (PRD §6 progressive disclosure).
     */
    formula?: string | null;
    /**
     * random -> BLUPs (selection); fixed -> BLUEs (comparison); mixed where structure differs by trait.
     */
    genotype_effect: 'random' | 'fixed' | 'mixed';
    /**
     * Which spatial correction the kernel applied (or 'none' if layout did not support one).
     */
    spatial_method?: 'none' | 'row_col' | 'ar1xar1' | 'spats' | 'splines' | null;
    /**
     * Echo of the relationship structure actually used.
     */
    relationship: 'identity' | 'A' | 'G' | 'H';
    /**
     * Backend that produced the fit (e.g. 'lme4', 'sommer', 'SpATS'). Internal; not shown to breeders by default.
     */
    engine?: string | null;
    /**
     * Why this model fits this data + intent — the human-readable justification the AI surfaces ('your trial has spatial trend across rows, so…').
     */
    rationale: string;
    /**
     * Whether the model was fit in one joint pass (gold standard) or staged (Stage-1 spatial de-trend → Stage-2 cross-environment), the latter chosen for scale (ADR-0016).
     */
    model_class?: 'single_stage' | 'two_stage' | null;
    /**
     * For a two-stage fit, whether Stage-1 standard errors were carried into Stage 2 as weights (makes GxE identifiable without within-location replication).
     */
    staging_weighted?: boolean | null;
    /**
     * The deterministic Model Planner's decision log: each scientific choice with its reason and the diagnostic that triggered it (ADR-0016). The trust/teaching surface — the AI narrates these, never makes them. Each may be recommended or breeder-overridden (ADR-0018).
     */
    decisions?: ModelDecision[];
    /**
     * Per-axis feasibility map for the override UI (ADR-0018): which values of each decision are currently selectable vs blocked-with-reason, so controls grey out impossible choices before a re-run. Optional/additive.
     */
    overridable?: OverridableFactor[];
  };
  /**
   * One result per analyzed ObservationVariable.
   */
  traits: {
    variable_id: string;
    /**
     * Whether this trait fit succeeded; on error see the trait's warnings.
     */
    status: 'ok' | 'error';
    /**
     * √Vg — the model's genetic standard deviation for this trait (from the genotype variance component). The standardization scale for the selection index: merit is expressed in genetic-sd units so traits are comparable and the client reproduces the kernel's index exactly. Model-based (not the empirical spread of the shrunken BLUPs), hence robust to outliers (ADR-0006).
     */
    genetic_sd?: number | null;
    /**
     * Per-genotype estimated values — the core output selection acts on.
     */
    effects: {
      germplasm_id: string;
      /**
       * The estimated genotype value (BLUP or BLUE), on the trait's scale.
       */
      value: number | null;
      /**
       * BLUP (genotype random) or BLUE (genotype fixed).
       */
      type: 'BLUP' | 'BLUE';
      /**
       * Standard error / PEV-derived uncertainty. Mapped; may be omitted by the MVP kernel.
       */
      std_error?: number | null;
      /**
       * Per-genotype reliability (1 − PEV/Vg). Mapped; powers shrinkage/uncertainty views later.
       */
      reliability?: number | null;
    }[];
    /**
     * Trait heritability. Cullis form preferred for unbalanced/spatial trials (ADR-0006). Null/absent for fixed-genotype (BLUE) fits where h² is undefined.
     */
    heritability?: {
      /**
       * Estimator used.
       */
      method: 'cullis' | 'standard' | 'line_mean';
      value: number | null;
    } | null;
    /**
     * Variance components from the fit.
     */
    varcomp?: {
      /**
       * e.g. 'genotype', 'genotype:environment', 'residual', 'row', 'col'.
       */
      component: string;
      variance: number | null;
      /**
       * SE of the variance component, if available.
       */
      std_error?: number | null;
    }[];
    /**
     * Post-fit Model QC for the 'did the model actually work?' view (ADR-0021). Readiness says a model is FEASIBLE; these say it WORKED. The proper (residual-based) outlier pass lives here; the crude pre-fit pass is in top-level `data_quality`.
     */
    diagnostics?: {
      converged?: boolean | null;
      n_obs?: number | null;
      n_genotypes?: number | null;
      /**
       * Residual distribution summary for outlier/assumption checks.
       */
      residual_summary?: {} | null;
      /**
       * p-value of a residual-normality test (Shapiro/Anderson-Darling). Reference only — at real trait sizes (n in the thousands) it rejects almost always, so the UI judges normality by effect size (skew/kurtosis) instead.
       */
      residual_normality_p?: number | null;
      /**
       * Residual skewness (effect size). ~0 symmetric; |skew| ≳ 1 is materially skewed → consider a transformation.
       */
      residual_skew?: number | null;
      /**
       * Residual EXCESS kurtosis (0 = normal tails). Large positive → heavy tails / outliers.
       */
      residual_kurtosis?: number | null;
      /**
       * p-value for non-constant residual variance (|resid| vs fitted, Spearman). Low → variance changes with the fitted value.
       */
      heteroscedasticity_p?: number | null;
      /**
       * Spearman correlation of |residual| with fitted value (effect size for heteroscedasticity); near 0 = constant variance.
       */
      heteroscedasticity_rho?: number | null;
      /**
       * 'fit' = the model's own residuals (e.g. spatially-adjusted Stage-1 SpATS residuals — preferred); 'reconstructed' = rebuilt from the BLUPs when per-plot residuals aren't available (one-stage).
       */
      residual_source?: 'fit' | 'reconstructed' | null;
      /**
       * Moran's I on the residuals over the row×col field layout. Far from 0 → spatial trend the model did not remove.
       */
      spatial_residual_autocorr?: number | null;
      /**
       * Observations with a large studentized/deletion residual — the residual-based outlier pass. Each carries its observation_unit_id so it can become a one-click suggested_exclusion (ADR-0021).
       */
      influential?:
        | {
            observation_unit_id: string;
            germplasm_id?: string | null;
            environment_id?: string | null;
            value?: number | null;
            studentized_resid: number | null;
            [k: string]: unknown;
          }[]
        | null;
      /**
       * True when heritability sits at a boundary (≈0 or ≈1) — the genetic signal is degenerate; treat BLUPs with care.
       */
      h2_boundary?: boolean | null;
      /**
       * True when a variance component was estimated at (or pinned to) zero — the fit is at a boundary.
       */
      varcomp_boundary?: boolean | null;
      /**
       * Convergence / boundary warnings emitted by the REML engine.
       */
      reml_warnings?: string[] | null;
      /**
       * Mean per-genotype reliability (1 − PEV/Vg) — an overall trust read on the BLUPs.
       */
      mean_reliability?: number | null;
      /**
       * Compact, downsampled diagnostic-plot data so scientists can SEE the residuals (ADR-0021): a residual-vs-fitted scatter, a residual histogram + normal overlay, and (only when spatial autocorrelation is flagged) the most-structured environment's field residuals. Downsampled in the kernel to keep the bundle lean.
       */
      viz?: {
        /**
         * Residual-vs-fitted points {f, r, o} — o=1 marks an influential (outlier) point. Sampled, but every influential point is kept.
         */
        scatter?:
          | {
              [k: string]: unknown;
            }[]
          | null;
        /**
         * Normal Q-Q plot — the trustworthy normality diagnostic (replaces the histogram). { points:[{t,s,o}], n, n_outliers }: t = theoretical normal quantile, s = standardized residual, o=1 = tail/outlier. Points on the y=x line ⇒ normal; ends peeling off ⇒ heavy tails / outliers. Downsampled but every tail point kept.
         */
        qq?: {
          [k: string]: unknown;
        } | null;
        /**
         * DEPRECATED (superseded by `qq`). Residual histogram: { bins:[{x0,x1,n}], mean, sd, n }. May be absent on new bundles.
         */
        hist?: {
          [k: string]: unknown;
        } | null;
        /**
         * { environment, moran, cells:[{row,col,r}] } for the field residual heatmap of the most spatially-structured environment. Null when no environment is flagged.
         */
        spatial?: {
          [k: string]: unknown;
        } | null;
        [k: string]: unknown;
      } | null;
      [k: string]: unknown;
    } | null;
    /**
     * Trait-scoped warnings (e.g. boundary fit, few reps).
     */
    warnings?: Warning[];
  }[];
  /**
   * Genetic-correlation matrix across analyzed traits (M1+). Null when not requested/estimable.
   */
  genetic_correlations?: {
    /**
     * Row/column order of the matrix.
     */
    variable_ids?: string[];
    /**
     * Symmetric correlation matrix aligned to variable_ids.
     */
    matrix?: (number | null)[][];
  } | null;
  /**
   * MET genotype-by-environment / stability view (M1+; Finlay–Wilkinson / AMMI / GGE). Mapped; null in single-trial or when not requested.
   */
  gxe?: {
    [k: string]: unknown;
  } | null;
  /**
   * Genomic/pedigree prediction view (M6): relationship-model cross-validation comparison (identity/A/G predictive ability), population-structure PCA, per-genotype GEBVs + reliability, the clustered covariance (GRM) heatmap, and the relationship distribution. Null when no markers/pedigree. The full GRM is NOT inlined (cache table, ADR-0017); this carries viz-ready derived data.
   */
  genomic?: {
    cohort_n?: number | null;
    n_markers?: number | null;
    /**
     * G structural checks: scaled/raw diagonal mean, off-diagonal spread, PD/rank.
     */
    sanity?: {
      [k: string]: unknown;
    } | null;
    /**
     * Per trait × model {identity,pedigree_A,genomic_G}: cross-validated predictive_ability + dispersion.
     */
    model_comparison?:
      | {
          [k: string]: unknown;
        }[]
      | null;
    /**
     * Per trait: genomic breeding values + per-genotype reliability (1−PEV/Vg) + Vg/Ve.
     */
    gebv?: {
      [k: string]: unknown;
    } | null;
    /**
     * Population structure: variance explained + per-genotype PC coordinates (family-colored).
     */
    pca?: {
      [k: string]: unknown;
    } | null;
    /**
     * Clustered, down-sampled genotype×genotype relationship block for the covariance heatmap.
     */
    heatmap?: {
      [k: string]: unknown;
    } | null;
    /**
     * Histograms of off-diagonal relatedness + diagonal (genomic inbreeding).
     */
    distribution?: {
      [k: string]: unknown;
    } | null;
    [k: string]: unknown;
  } | null;
  /**
   * Combining-ability view (ADR-0019/0020): the hybrid trial decomposed into parent GCA (random→BLUP, the parent-selection target, carried with cross-degree) and SCA (specific-cross deviation, where estimable). Selected from the measured cross-graph topology (diallel/line×tester/sparse factorial); ranking is WITHIN heterotic pool. Null when germplasm are not crosses. Like `genomic`, this carries viz-ready derived data, not the raw fit.
   */
  combining_ability?: {
    /**
     * Detected mating-design topology (kind, n_lines, n_testers, n_crosses, tester fixed/random, sca_included), the heterotic pools, and the decision log (each with reason + diagnostic).
     */
    topology?: {
      [k: string]: unknown;
    } | null;
    /**
     * Cross-graph readiness: per-line cross-degree distribution (crosses per inbred → GCA precision), connectivity (components — are GCAs on one scale), and cross-replication (SCA separability).
     */
    diagnostics?: {
      [k: string]: unknown;
    } | null;
    /**
     * Per trait: GCA/SCA/GCA×E/residual variance components + Baker's ratio (additive share of combining ability).
     */
    traits?:
      | {
          [k: string]: unknown;
        }[]
      | null;
    /**
     * The trait subset the GCA index ranks on (the inbred objective is typically simpler than the hybrid one — complementation, ADR-0020).
     */
    index_traits?: string[] | null;
    /**
     * Per line: pool, per-trait GCA BLUP (shrinkage baked in), cross-degree (testers/plots — the visual trust signal), per-se value, native-trait calls.
     */
    gca?:
      | {
          [k: string]: unknown;
        }[]
      | null;
    /**
     * Within-pool GCA ranking (ranking pools jointly would advance only the stronger pool — ADR-0020). Each entry: pool, n, ranking[] with rank/score/gated_out/gate_failures.
     */
    pool_rankings?:
      | {
          [k: string]: unknown;
        }[]
      | null;
    /**
     * Observed-cross SCA deviations (line, tester, value) for the heatmap, where SCA is estimable.
     */
    sca?:
      | {
          [k: string]: unknown;
        }[]
      | null;
    /**
     * Per-se ↔ GCA disagreement: a line strong per se but a poor combiner (or vice versa) — itself the insight (mirrors transparent-vs-Smith–Hazel).
     */
    divergence?: {
      [k: string]: unknown;
    } | null;
    [k: string]: unknown;
  } | null;
  /**
   * Deterministic structural diagnostics that gated the model choices (grid, replication, cross-environment connectivity, scale), plus what additional data would unlock richer models (ADR-0016). Surfaced to the breeder as the 'why this model / what would unlock more' panel.
   */
  data_readiness?: {
    /**
     * n_obs, n_geno, n_env, n_cells, n_traits.
     */
    scale?: {
      [k: string]: unknown;
    } | null;
    /**
     * Cross-environment genotype overlap — connectors (genotypes in ≥2 environments), median environments per genotype — which gates GxE estimability.
     */
    connectivity?: {
      [k: string]: unknown;
    } | null;
    /**
     * Within-environment replication that identifies residual error for a one-stage GxE fit.
     */
    replication?: {
      [k: string]: unknown;
    } | null;
    /**
     * What is NOT estimated and the data that would unlock it (e.g. GxE blocked by low connectivity; genomic prediction blocked by no markers).
     */
    unlocks?: ReadinessUnlock[];
    [k: string]: unknown;
  } | null;
  /**
   * Pre-fit, VALUE-level audit of the assembled dataset (ADR-0021) — distinct from `data_readiness` (structural, gates model choice) and from per-trait `diagnostics` (post-fit Model QC). The crude-robust first pass a statistician runs before fitting: missingness, raw outliers, duplicate plot coordinates, near-duplicate genotype names, distribution shape, factor-level sanity. Advisory only — the kernel never removes data; each finding may carry a `suggested_exclusion` the breeder disposes via `data_overrides`. Always present (even when a trait fails to fit).
   */
  data_quality?: {
    /**
     * Individual value-level findings, each tagged with the data it concerns so the UI can wire it to a one-click exclude.
     */
    findings?: DataQualityFinding[];
    /**
     * Rollup: { n_findings, by_severity: {error,warning,info}, by_check } for the quiet headline before the breeder expands the detail.
     */
    summary?: {
      n_findings?: number | null;
      by_severity?: {
        [k: string]: unknown;
      } | null;
      by_check?: {
        [k: string]: unknown;
      } | null;
      [k: string]: unknown;
    } | null;
    /**
     * Raw-measurement distributions for the 'see the spread + outliers of the actual data' view (ADR-0021) — a PRE-fit data-sanity check, distinct from the post-fit residual Q-Q. Keyed by variable_id; each is an array of per-environment Tukey box-and-whisker stats { environment, n, min, q1, median, q3, max, whisker_lo, whisker_hi, n_outliers, outliers:[values] } so the UI can draw box-and-whisker-by-environment with the out-of-whisker points flagged.
     */
    distributions?: {
      [k: string]: unknown;
    } | null;
    /**
     * Per-trait field triptych for the 'see the spatial correction' view (ADR-0021): the raw measurement, the fitted SpATS spatial-trend surface (the smooth field trend the model estimated and removed), and the residual — all by field position, for the most spatially-structured environment (same env across all three so it's a true before → correction → after). Keyed by variable_id; each is { environment, n, cells:[{row,col,raw,trend,resid}] }. Present only when a spatial model was fitted (two-stage SpATS).
     */
    field_trends?: {
      [k: string]: unknown;
    } | null;
  } | null;
  /**
   * Selection rankings. Both index kinds may appear so the GUI can show their DIVERGENCE as insight (ADR-0006). The transparent weighted index is also client-recomputable for live re-weighting (PRD §6).
   */
  indices?: {
    /**
     * weighted = transparent standardized-weighted index (alignment/communication tool, statistically naive); smith_hazel / desired_gains = genetically-aware optimal index.
     */
    kind: 'weighted' | 'smith_hazel' | 'desired_gains';
    /**
     * The Segment whose objective produced this ranking. Same data + different segment -> different ranking (DOMAIN-MODEL §2.2).
     */
    segment_id?: string | null;
    /**
     * Genotypes ordered best-first by this index, with gate outcomes.
     */
    ranking: {
      germplasm_id: string;
      rank: number;
      /**
       * The index score.
       */
      score: number | null;
      /**
       * True if the candidate failed one or more gates (excluded from selection regardless of score).
       */
      gated_out?: boolean;
      /**
       * variable_ids of failed gates, for explanation.
       */
      gate_failures?: string[];
    }[];
    /**
     * Echo of the selection modes + weights this ranking used, for transparency and client-side recompute. The kernel emits `mode` (and a consistent `direction`) so the live re-weighting UI reproduces the same merit each trait contributed.
     */
    weights_used?:
      | {
          variable_id: string;
          /**
           * Resolved selection mode the kernel applied for this trait.
           */
          mode?: 'max' | 'min' | 'target';
          /**
           * The optimum value used, for mode='target'; null/absent otherwise.
           */
          target?: number | null;
          /**
           * Consistent legacy encoding of the mode (max/target→+1, min→−1) for older consumers.
           */
          direction?: 1 | -1;
          weight: number;
        }[]
      | null;
  }[];
  /**
   * Where the transparent and genetically-aware indices disagree — itself an insight the AI narrates (ADR-0006). Null when fewer than two indices are present.
   */
  divergence?: {
    /**
     * The index kinds compared, e.g. ['weighted','smith_hazel'].
     */
    compared?: string[];
    /**
     * Spearman correlation between the two rankings.
     */
    rank_correlation?: number | null;
    /**
     * Genotypes whose rank differs most between the indices — the actionable disagreements.
     */
    notable_movers?: {
      germplasm_id?: string;
      /**
       * Rank position difference between the two indices.
       */
      rank_delta?: number;
    }[];
  } | null;
  /**
   * Run-level warnings and notes (design issues, convergence, data quality). Surfaced to the breeder in plain language.
   */
  warnings: Warning[];
  /**
   * How this bundle was produced — for reproducibility and audit (the formal audit layer is deferred; this is the seed).
   */
  provenance: {
    contract_version: 'v0';
    /**
     * Versions of the kernel and key R packages used, e.g. {"SpATS":"1.0-18"}.
     */
    engine_versions?: {} | null;
    /**
     * ISO-8601 timestamp set by the kernel/worker when the bundle was produced.
     */
    generated_at?: string | null;
    [k: string]: unknown;
  };
}
/**
 * One model choice with its reason and the diagnostic that triggered it (ADR-0016). The planner recommends each; the breeder may override it (ADR-0018). `source`/`recommended`/`feasible`/`refused_reason` record whether the active choice is the recommendation or an override, and — when an override was infeasible — why it was refused (the planner kept its recommendation).
 */
export interface ModelDecision {
  /**
   * Which decision this is.
   */
  factor: 'spatial' | 'genotype_effect' | 'staging' | 'gxe' | 'relationship' | 'engine';
  /**
   * What was chosen (and actually fitted), e.g. 'included' / 'skipped' / 'two-stage' / 'spats' / 'G'.
   */
  choice: string;
  /**
   * Plain-language justification the AI surfaces to the breeder.
   */
  reason: string;
  /**
   * The structural numbers behind the choice (e.g. connectors, median environments per genotype).
   */
  diagnostic?: {
    [k: string]: unknown;
  } | null;
  /**
   * Whether the active `choice` is the planner's recommendation or a breeder override.
   */
  source?: 'recommended' | 'overridden';
  /**
   * What the planner would have chosen, so the UI can badge it and offer reset-to-recommended.
   */
  recommended?: string | null;
  /**
   * False only when an override was requested but refused; `choice` then falls back to `recommended`.
   */
  feasible?: boolean;
  /**
   * When feasible=false: why the requested override could not be fit (e.g. 'no marker data supplied').
   */
  refused_reason?: string | null;
  /**
   * Optional supporting numbers for the recommendation — for relationship, the cross-validation predictive-ability summary per model.
   */
  evidence?: {
    [k: string]: unknown;
  } | null;
}
/**
 * The selectable values for one decision axis and whether each is currently feasible — the UI's feasibility map, so override controls grey out impossible choices before a re-run (ADR-0018).
 */
export interface OverridableFactor {
  factor: 'spatial' | 'staging' | 'gxe' | 'relationship' | 'engine';
  options: {
    value: string;
    feasible: boolean;
    /**
     * When feasible=false, why it's blocked + how to unlock it; null when feasible.
     */
    reason?: string | null;
  }[];
}
export interface Warning {
  /**
   * Stable machine code for the warning class, for filtering/eval.
   */
  code?: string | null;
  /**
   * Plain-language explanation for the breeder.
   */
  message: string;
  severity?: 'info' | 'warning' | 'error';
}
/**
 * A capability not estimated and the data that would unlock it (ADR-0016).
 */
export interface ReadinessUnlock {
  /**
   * What could be added, e.g. 'GxE / stability'.
   */
  capability: string;
  /**
   * The structural reason it isn't estimated.
   */
  blocked_by: string;
  /**
   * Actionable guidance — what data the breeder would collect to enable it.
   */
  hint: string;
}
/**
 * One pre-fit, value-level finding (ADR-0021). Target-tagged so the UI can wire it to a one-click `data_overrides` exclude. Advisory — never auto-applied.
 */
export interface DataQualityFinding {
  /**
   * Which check produced this finding.
   */
  check: 'missingness' | 'outlier' | 'duplicate_coords' | 'duplicate_name' | 'distribution' | 'factor_sanity';
  /**
   * error = corrupts the fit if kept; warning = likely problem; info = FYI (e.g. mild skew).
   */
  severity: 'info' | 'warning' | 'error';
  /**
   * Plain-language explanation the AI narrates and the breeder reads — the rule and the value that triggered it.
   */
  detail: string;
  /**
   * The data this finding concerns — what a one-click exclude would drop. `kind` names the level; `id` is the corresponding identifier in the request.
   */
  target: {
    /**
     * Exclusion level. 'dataset' = a whole-trial note with no single excludable target.
     */
    kind: 'environment' | 'observation_unit' | 'germplasm' | 'variable' | 'dataset';
    /**
     * The environment_id / observation_unit_id / germplasm_id / variable_id; null for 'dataset'.
     */
    id?: string | null;
    /**
     * A second id for pairwise findings (e.g. the other genotype in a near-duplicate-name pair).
     */
    id2?: string | null;
  };
  /**
   * The trait this finding is scoped to, when applicable (e.g. an outlier or missingness is per-trait).
   */
  variable_id?: string | null;
  /**
   * The offending value or the metric that triggered the finding (e.g. the MAD score, the missing fraction).
   */
  value?: number | null;
  /**
   * Whether the kernel suggests this target be excluded. The disposition policy turns suggestions into a `data_overrides` set; the kernel never removes anything itself (ADR-0021).
   */
  suggested_exclusion?: boolean;
}
