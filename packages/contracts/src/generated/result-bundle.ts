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
     * Model-fit diagnostics for the 'is this trustworthy?' view (ADR-0006). Mapped; MVP populates a subset.
     */
    diagnostics?: {
      converged?: boolean | null;
      n_obs?: number | null;
      n_genotypes?: number | null;
      /**
       * Residual distribution summary for outlier/assumption checks.
       */
      residual_summary?: {} | null;
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
