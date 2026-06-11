/* AUTO-GENERATED from v0/analysis-request.schema.json — do not edit by hand.
 * Regenerate with: pnpm --filter @verdant/contracts codegen */

/**
 * The self-contained input the web tier enqueues for the R compute kernel. The kernel is stateless (ADR-0001): everything a fit needs is here. The request carries the breeder's INTENT, never a model specification — the kernel owns model choice and explains it back in the result bundle (ADR-0002). See contracts/README.md and DOMAIN-MODEL §6.
 */
export interface AnalysisRequest {
  /**
   * Pins the message to this schema version. Additive within a major version; breaking changes bump the major and live in a new vN/ directory.
   */
  contract_version: 'v0';
  /**
   * Optional caller-supplied id, echoed in the result bundle for correlation. Opaque to the kernel.
   */
  analysis_request_id?: string;
  /**
   * What the breeder is analyzing FOR. The kernel turns intent + data into a model choice: 'selection' -> genotype random -> BLUPs; 'comparison' -> genotype fixed -> BLUEs; 'prediction' -> uses the relationship structure (A/G/H) to predict un/under-tested material. The web tier MUST NOT send a formula or model form (ADR-0002).
   */
  intent: 'selection' | 'comparison' | 'prediction';
  /**
   * Deliberate data-scoping metadata (DOMAIN-MODEL §2.2 discovery isolation). What material feeds a model is an expert choice, not an accident of the table. Informational in v0; the web tier is responsible for actually filtering observations before sending.
   */
  scope?: {
    /**
     * The target Segment this analysis serves, if any. null = no commercial segment (e.g. discovery/unadapted screening), which excludes it from segment-pipeline training sets.
     */
    segment_id?: string | null;
    /**
     * The pipeline Stage this analysis pertains to, if scoped. Program-defined ordinal label.
     */
    stage?: string | null;
    /**
     * True for discovery/unadapted-material trials; signals the result should not feed segment-pipeline predictions.
     */
    is_discovery?: boolean;
  };
  /**
   * The ObservationVariables (Trait × Method × Scale, BrAPI-Phenotyping) referenced by observations. Declares which are to be analyzed and how each is treated.
   *
   * @minItems 1
   */
  variables: [
    {
      /**
       * Stable id used as the key in observations.
       */
      variable_id: string;
      /**
       * Human-readable trait name (e.g. 'Yield', 'Brix').
       */
      name: string;
      /**
       * Drives how the kernel can model the variable. MVP analyzes 'numeric'.
       */
      data_type: 'numeric' | 'ordinal' | 'nominal' | 'date' | 'boolean';
      /**
       * Measurement unit, if any.
       */
      unit?: string | null;
      /**
       * Whether this variable is a response to be fit. False = present for context/gating only.
       */
      analyze?: boolean;
    },
    ...{
      /**
       * Stable id used as the key in observations.
       */
      variable_id: string;
      /**
       * Human-readable trait name (e.g. 'Yield', 'Brix').
       */
      name: string;
      /**
       * Drives how the kernel can model the variable. MVP analyzes 'numeric'.
       */
      data_type: 'numeric' | 'ordinal' | 'nominal' | 'date' | 'boolean';
      /**
       * Measurement unit, if any.
       */
      unit?: string | null;
      /**
       * Whether this variable is a response to be fit. False = present for context/gating only.
       */
      analyze?: boolean;
    }[]
  ];
  /**
   * The plots/plants (BrAPI ObservationUnit). Each carries its germplasm reference and its AS-PLANTED layout position — the actual physical arrangement, gaps and all (ADR-0006). The kernel uses these coordinates for spatial correction.
   *
   * @minItems 1
   */
  observation_units: [
    {
      /**
       * Stable id; the join key for observations.
       */
      observation_unit_id: string;
      /**
       * The genotype/entry on this unit (BrAPI Germplasm). Multiple units share a germplasm_id across reps/environments.
       */
      germplasm_id: string;
      /**
       * Which environment (Location × Season) this unit belongs to. Required for MET/GxE; null/constant for single-trial.
       */
      environment_id?: string | null;
      /**
       * As-planted physical position. Provide row/col (and optionally range/pass) for spatial models. Absent or partial layout falls back to non-spatial analysis (the kernel decides and says so).
       */
      layout?: {
        /**
         * Field row index (spatial Y).
         */
        row?: number | null;
        /**
         * Field column index (spatial X).
         */
        col?: number | null;
        /**
         * Breeder-casual synonym some programs use for row-blocks; carried through for as-planted fidelity.
         */
        range?: number | null;
        /**
         * Breeder-casual synonym some programs use for the orthogonal direction.
         */
        pass?: number | null;
        /**
         * Design block/incomplete-block id, if any.
         */
        block?: string | null;
        /**
         * Replicate id, if any.
         */
        rep?: string | null;
      };
    },
    ...{
      /**
       * Stable id; the join key for observations.
       */
      observation_unit_id: string;
      /**
       * The genotype/entry on this unit (BrAPI Germplasm). Multiple units share a germplasm_id across reps/environments.
       */
      germplasm_id: string;
      /**
       * Which environment (Location × Season) this unit belongs to. Required for MET/GxE; null/constant for single-trial.
       */
      environment_id?: string | null;
      /**
       * As-planted physical position. Provide row/col (and optionally range/pass) for spatial models. Absent or partial layout falls back to non-spatial analysis (the kernel decides and says so).
       */
      layout?: {
        /**
         * Field row index (spatial Y).
         */
        row?: number | null;
        /**
         * Field column index (spatial X).
         */
        col?: number | null;
        /**
         * Breeder-casual synonym some programs use for row-blocks; carried through for as-planted fidelity.
         */
        range?: number | null;
        /**
         * Breeder-casual synonym some programs use for the orthogonal direction.
         */
        pass?: number | null;
        /**
         * Design block/incomplete-block id, if any.
         */
        block?: string | null;
        /**
         * Replicate id, if any.
         */
        rep?: string | null;
      };
    }[]
  ];
  /**
   * Long format: one entry per (observation_unit × variable) measured value. The kernel pivots as needed. Missing combinations are simply absent (unbalanced data is expected and handled).
   */
  observations: {
    observation_unit_id: string;
    variable_id: string;
    /**
     * The measured value. Numeric for quantitative traits; string for categorical; null for explicit missing.
     */
    value: number | string | null;
  }[];
  /**
   * Design HINTS, not a model spec. What the breeder believes the design was; the kernel validates against the actual layout and chooses the model. Optional — the kernel can infer from layout (ADR-0002/0006).
   */
  design?: {
    /**
     * What the breeder says the design is. The kernel treats this as a hint to confirm, not an instruction.
     */
    declared_design?:
      | 'rcbd'
      | 'alpha_lattice'
      | 'row_col'
      | 'augmented'
      | 'p_rep'
      | 'crd'
      | 'unreplicated'
      | 'unknown'
      | null;
    /**
     * Hint that this is a MET (genotypes across environments). The kernel confirms from environment_id counts.
     */
    is_multi_environment?: boolean | null;
  };
  /**
   * The relationship structure among genotypes — a FIRST-CLASS engine input, not a fork (DOMAIN-MODEL §6). A/G/H BLUP are one model with different relationship matrices (Mrode; Bernardo). MVP fills 'identity'.
   */
  relationship?: {
    /**
     * identity = no kinship (MVP); A = pedigree-based; G = marker-based; H = single-step (pedigree+markers). A/G/H are MAPPED, not built — present so the seam anticipates M5–M6 without a contract break.
     */
    type: 'identity' | 'A' | 'G' | 'H';
    /**
     * For A/G/H: a reference the kernel resolves to the matrix or its inputs (pedigree set / marker set). Unused for 'identity'. Transport of large matrices is an OPEN operational detail (see README).
     */
    source_ref?: string | null;
  };
  /**
   * The selection objective derived from the target Segment's TPP and the (Segment × Stage) SelectionCriteria (DOMAIN-MODEL §2.4). Drives gating and the index(es). Optional: absent for pure comparison/prediction runs.
   */
  objective?: {
    /**
     * Independent culling thresholds on must-have traits (DOMAIN-MODEL §2.4). A candidate failing any gate is excluded regardless of index. Gates tighten with Stage.
     */
    gates?: {
      variable_id: string;
      operator: '>=' | '<=' | '>' | '<' | '==' | '!=' | 'in' | 'not_in';
      /**
       * Number for quantitative gates; string/array for categorical (e.g. accepted fruit types).
       */
      threshold: number | string | unknown[];
    }[];
    /**
     * Per-trait selection modes + weights for the selection index. Used by the transparent weighted index (sum-to-100% alignment tool) and, with the genetic covariance the kernel estimates, the Smith–Hazel / desired-gains index (ADR-0006).
     */
    index_weights?: {
      variable_id: string;
      /**
       * Selection mode for this trait (ADR-0006). 'max' = higher is better (merit = +z); 'min' = lower is better (merit = −z); 'target' = an optimum where deviation from `target` is penalized quadratically (merit = −((value−target)/sd)², in genotype-sd units, so far-from-target genotypes are increasingly discounted). Authoritative when present. If absent, the kernel derives it from `direction` (+1→max, −1→min), defaulting to 'max'.
       */
      mode?: 'max' | 'min' | 'target';
      /**
       * The optimum value, on the trait's own scale, for mode='target'. Required when mode='target'; ignored for max/min.
       */
      target?: number | null;
      /**
       * Legacy shorthand for max/min: +1 = higher is better, −1 = lower is better. Retained for back-compat and as the weights_used echo; `mode` supersedes it and is preferred for new producers. Not used for mode='target'.
       */
      direction?: 1 | -1;
      /**
       * Relative importance. For the transparent index the web tier may normalize weights to sum to 1 (100%) as an alignment device.
       */
      weight: number;
      /**
       * Optional target gain for a desired-gains index (alternative elicitation to economic weights). The index-screen default — desired-gains vs economic weights — is an OPEN product detail (ADR-0006).
       */
      desired_gain?: number | null;
    }[];
  } | null;
  /**
   * Non-scientific execution knobs. Nothing here may change WHICH model is chosen — that is the kernel's job (ADR-0002).
   */
  options?: {
    /**
     * Whether to estimate the genetic-correlation matrix across analyzed traits (M1+).
     */
    compute_genetic_correlations?: boolean;
    /**
     * Whether to compute GxE/stability views for MET (M1+).
     */
    compute_stability?: boolean;
  };
}
