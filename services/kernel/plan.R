## Verdant compute kernel — deterministic Model Planner (ADR-0016).
##
## (readiness, intent, relationship) → a Model Plan: WHAT model to fit and WHY, every decision
## carrying a reason + the diagnostic that triggered it (ADR-0002: deterministic science, AI
## explains). The TS tier executes this plan; it makes no scientific choices.
##
## Requires diagnostics.R functions in scope (source() it first). Functions only — see met-plan.R
## for the stdin→stdout entrypoint.

## One-stage joint fits above ~this many mixed-model equations escalate to a weighted two-stage
## for scale (the recognized Smith–Cullis–Thompson fallback). Tunable; surfaced in the decision.
ONESTAGE_MAX_EQ <- 25000L

## readiness: output of compute_readiness(). Returns a list with model_class, gxe, decisions[],
## unlocks[], etc. — serialized into the bundle's chosen_model + data_readiness.
make_plan <- function(readiness, intent = "selection", relationship = "identity") {
  decisions <- list(); unlocks <- list()
  add_dec <- function(factor, choice, reason, diagnostic = NULL)
    decisions[[length(decisions) + 1]] <<- list(factor = factor, choice = choice,
                                                reason = reason, diagnostic = diagnostic)
  add_unlock <- function(capability, blocked_by, hint)
    unlocks[[length(unlocks) + 1]] <<- list(capability = capability, blocked_by = blocked_by, hint = hint)

  is_met <- isTRUE(readiness$is_met)
  conn <- readiness$connectivity
  repl <- readiness$replication
  sc <- readiness$scale

  ## --- spatial (per-env grid decides; reported as the overall method) ---
  with_grid <- sum(vapply(readiness$environments, function(x) isTRUE(x$has_grid), logical(1)))
  n_no_grid <- sc$n_env - with_grid
  spatial <- if (isTRUE(readiness$grids$any_grid)) "spats" else "none"
  add_dec("spatial", spatial,
    if (spatial == "spats")
      sprintf("%d of %d environment(s) form a row×col grid; a SpATS 2D P-spline removes within-field trend.", with_grid, sc$n_env)
    else "No usable row×col grid; no spatial correction applied.",
    list(environments_with_grid = with_grid, n_env = sc$n_env))
  if (spatial == "spats" && n_no_grid > 0)
    add_unlock("spatial correction in every environment",
      sprintf("%d environment(s) have no row/column grid recorded", n_no_grid),
      "Record plot range/pass coordinates so every trial can be spatially de-trended.")

  ## --- can GxE be estimated at all? It needs BOTH cross-environment connectivity AND within-cell
  ##     replication, and only a ONE-STAGE plot-level fit identifies it: a two-stage on one mean per
  ##     genotype×env cell confounds GxE with error (verified empirically — the components diverge).
  gxe_estimable <- is_met && isTRUE(conn$gxe_connectivity_ok) && isTRUE(repl$residual_identifiable)

  ## --- staging: one-stage is the default and the only path that yields GxE. A one-stage GxE fit
  ##     above the engine's memory budget falls back to a weighted two-stage genotype-MAIN model for
  ##     scale — which cannot separate GxE (it folds into residual). ---
  gxe_eq <- (sc$n_geno + sc$n_cells) * sc$n_traits  # genotype + genotype×env levels × traits
  onestage_feasible <- gxe_eq <= ONESTAGE_MAX_EQ
  if (!is_met) {
    model_class <- "single_stage"; weighted <- FALSE; gxe_include <- FALSE
    staging_reason <- "Single trial — one model, no staging."
  } else if (gxe_estimable && onestage_feasible) {
    model_class <- "single_stage"; weighted <- FALSE; gxe_include <- TRUE
    staging_reason <- "One-stage joint fit (gold standard): plot-level replication identifies the residual, so genotype, GxE, and error are estimated together."
  } else if (gxe_estimable && !onestage_feasible) {
    model_class <- "two_stage"; weighted <- FALSE; gxe_include <- FALSE
    staging_reason <- sprintf("GxE is supported by the data, but the one-stage fit that identifies it (~%d equations) exceeds the engine host's memory budget; falling back to a two-stage genotype-main model for scale. GxE is not separated in this fallback.", gxe_eq)
  } else {
    big <- (sc$n_cells * sc$n_traits) > ONESTAGE_MAX_EQ
    model_class <- if (big) "two_stage" else "single_stage"; weighted <- FALSE; gxe_include <- FALSE
    staging_reason <- if (big)
      "Large multi-environment problem; a two-stage removes field trend per environment in Stage 1, then fits a lighter cross-environment model."
    else "One-stage joint fit is feasible at this scale."
  }
  add_dec("staging",
    if (model_class == "two_stage") "two-stage" else "single-stage",
    staging_reason,
    list(n_obs = sc$n_obs, n_geno = sc$n_geno, n_env = sc$n_env, est_equations = gxe_eq))

  ## --- GxE decision + the actionable reason / unlock ---
  if (gxe_include) {
    gxe_reason <- sprintf("%d genotypes shared across ≥2 environments (median %.1f env/genotype) with within-environment replication; GxE is identified from plot-level replication in the one-stage fit.",
      conn$connectors, conn$median_env_per_geno)
  } else if (!is_met) {
    gxe_reason <- "Single environment — genotype×environment is not defined."
  } else if (!isTRUE(conn$gxe_connectivity_ok)) {
    gxe_reason <- sprintf("Too few genotypes connect environments (%d shared across ≥2 envs); a GxE term would be confounded with error.", conn$connectors)
    add_unlock("GxE / stability",
      sprintf("low cross-environment connectivity (%d connectors, median %.1f environments per genotype)", conn$connectors, conn$median_env_per_geno),
      "Share more genotypes across locations (overlap across environments, not extra plots within one) so the same lines can be compared environment-to-environment.")
  } else if (!isTRUE(repl$residual_identifiable)) {
    gxe_reason <- "No within-environment replication, so GxE cannot be separated from plot error; it is reported as part of the residual."
    add_unlock("GxE / stability",
      "no within-environment replication (one plot per genotype×environment)",
      "Add replicated check plots or partial replication within environments so plot error can be estimated and GxE separated.")
  } else {
    # gxe_estimable but one-stage infeasible → folded into residual in the scale-fallback two-stage
    gxe_reason <- "GxE is supported by the data but not separated in the scale-fallback two-stage model; it is folded into the residual."
    add_unlock("genotype×environment (GxE) variance",
      sprintf("the one-stage fit that identifies GxE is too large for the current engine host (~%d equations)", gxe_eq),
      "Run on a higher-memory engine host, or on a subset of environments, to estimate GxE — the data themselves support it.")
  }
  add_dec("gxe", if (gxe_include) "included" else "skipped", gxe_reason,
    list(connectors = conn$connectors, median_env_per_geno = conn$median_env_per_geno,
         residual_identifiable = repl$residual_identifiable))

  ## --- genotype effect ---
  add_dec("genotype_effect", "random", "Genotype fitted random (BLUPs) for selection.", NULL)

  ## --- engine (Phase-1 mapping; replaced by the capability registry in Phase 3) ---
  engine <- if (!is_met) "SpATS/lme4" else if (model_class == "two_stage") "SpATS + blupf90+" else "blupf90+"
  add_dec("engine", engine,
    sprintf("%s — %s.", engine,
      if (is_met) "multi-environment multi-trait AI-REML variance components" else "single-trial spatial mixed model"),
    NULL)

  ## --- genomic unlock (relationship still identity) ---
  if (identical(relationship, "identity"))
    add_unlock("genomic prediction (G/H relationship; rrBLUP / ssGBLUP)",
      "no marker or pedigree data supplied",
      "Provide markers or a pedigree to enable a genomic relationship matrix and genomic-prediction engines.")

  list(
    model_class = model_class,
    staging_weighted = weighted,
    genotype_effect = "random",
    spatial_method = spatial,
    gxe = list(include = gxe_include, reason = gxe_reason),
    engine = engine,
    relationship = relationship,
    decisions = decisions,
    unlocks = unlocks
  )
}
