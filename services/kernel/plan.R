## Verdant compute kernel — deterministic Model Planner (ADR-0016, ADR-0018).
##
## (readiness, intent, relationship, overrides, evidence) → a Model Plan: WHAT model to fit and WHY,
## every decision carrying a reason + the diagnostic that triggered it (ADR-0002: deterministic
## science, AI explains). The TS tier executes this plan; it makes no scientific choices.
##
## ADR-0018 — the breeder may OVERRIDE any decision. The planner recommends each, then validates the
## override against data readiness and REFUSES an infeasible one (keeping its recommendation + a
## reason). `overrides` is the parsed model_overrides object; `evidence` is the cross-validation
## predictive-ability summary (computed by the driver, passed in) that makes the relationship
## recommendation the CV winner. make_plan stays a PURE function of its inputs (determinism preserved).
##
## Requires diagnostics.R functions in scope (source() it first). Functions only — see met-plan.R
## for the stdin→stdout entrypoint.

## One-stage joint fits above ~this many mixed-model equations escalate to a weighted two-stage
## for scale (the recognized Smith–Cullis–Thompson fallback). Tunable; surfaced in the decision.
ONESTAGE_MAX_EQ <- 25000L

make_plan <- function(readiness, intent = "selection", relationship = "identity",
                      overrides = NULL, evidence = NULL) {
  decisions <- list(); unlocks <- list(); overridable <- list()
  add_dec <- function(factor, choice, reason, diagnostic = NULL, source = "recommended",
                      recommended = NULL, feasible = TRUE, refused_reason = NULL, evidence = NULL)
    decisions[[length(decisions) + 1]] <<- list(
      factor = factor, choice = choice, reason = reason, diagnostic = diagnostic,
      source = source, recommended = if (is.null(recommended)) choice else recommended,
      feasible = feasible, refused_reason = refused_reason, evidence = evidence)
  add_unlock <- function(capability, blocked_by, hint)
    unlocks[[length(unlocks) + 1]] <<- list(capability = capability, blocked_by = blocked_by, hint = hint)
  add_overridable <- function(factor, options)
    overridable[[length(overridable) + 1]] <<- list(factor = factor, options = options)
  opt <- function(value, feasible, reason = NULL) list(value = value, feasible = feasible, reason = reason)

  ## requested override for a factor (NULL when absent)
  ov <- function(name) if (!is.null(overrides) && !is.null(overrides[[name]])) overrides[[name]] else NULL

  ## recommend-then-validate-override: no override or matches → recommended; feasible override →
  ## overridden; infeasible override → keep recommendation + refused_reason. Returns the resolved value.
  resolve <- function(factor, recommended, override, override_feasible, refuse_reason,
                      rec_reason, diagnostic = NULL, evidence = NULL) {
    if (is.null(override) || identical(override, recommended)) {
      add_dec(factor, recommended, rec_reason, diagnostic, "recommended", recommended, TRUE, NULL, evidence)
      return(recommended)
    }
    if (isTRUE(override_feasible)) {
      add_dec(factor, override,
        sprintf("Breeder override: %s (planner recommended %s). %s", override, recommended, rec_reason),
        diagnostic, "overridden", recommended, TRUE, NULL, evidence)
      return(override)
    }
    add_dec(factor, recommended, rec_reason, diagnostic, "overridden", recommended, FALSE, refuse_reason, evidence)
    return(recommended)
  }

  is_met <- isTRUE(readiness$is_met)
  conn <- readiness$connectivity
  repl <- readiness$replication
  sc <- readiness$scale
  gen <- readiness$genomic                                  # markers_present / pedigree_present / n_genotyped (driver-supplied)
  markers <- isTRUE(gen$markers_present)
  pedigree <- isTRUE(gen$pedigree_present)

  ## ---- spatial -------------------------------------------------------------------------------
  with_grid <- sum(vapply(readiness$environments, function(x) isTRUE(x$has_grid), logical(1)))
  n_no_grid <- sc$n_env - with_grid
  any_grid <- isTRUE(readiness$grids$any_grid)
  rec_spatial <- if (any_grid) "spats" else "none"
  spatial_reason <- if (rec_spatial == "spats")
    sprintf("%d of %d environment(s) form a row×col grid; a SpATS 2D P-spline removes within-field trend.", with_grid, sc$n_env)
  else "No usable row×col grid; no spatial correction applied."
  ov_sp <- ov("spatial")
  sp_feasible <- is.null(ov_sp) || ov_sp == "none" || any_grid
  spatial <- resolve("spatial", rec_spatial, ov_sp, sp_feasible,
    sprintf("No environment has a usable row×col grid (need ≥%d×%d and ≥%d plots); spatial de-trending can't be fit.",
            GRID_MIN_ROWS, GRID_MIN_COLS, GRID_MIN_PLOTS),
    spatial_reason, list(environments_with_grid = with_grid, n_env = sc$n_env))
  add_overridable("spatial", list(
    opt("spats", any_grid, if (any_grid) NULL else sprintf("Needs a row×col grid (≥%d×%d, ≥%d plots) in at least one environment.", GRID_MIN_ROWS, GRID_MIN_COLS, GRID_MIN_PLOTS)),
    opt("none", TRUE)))
  if (spatial == "spats" && n_no_grid > 0)
    add_unlock("spatial correction in every environment",
      sprintf("%d environment(s) have no row/column grid recorded", n_no_grid),
      "Record plot range/pass coordinates so every trial can be spatially de-trended.")

  ## ---- recommended staging + GxE (the existing readiness logic) -------------------------------
  ## GxE separates from error ONLY in a one-stage plot-level fit with within-cell replication.
  gxe_estimable <- is_met && isTRUE(conn$gxe_connectivity_ok) && isTRUE(repl$residual_identifiable)
  gxe_eq <- (sc$n_geno + sc$n_cells) * sc$n_traits          # genotype + genotype×env levels × traits
  onestage_feasible <- gxe_eq <= ONESTAGE_MAX_EQ
  if (!is_met) {
    rec_model_class <- "single_stage"; rec_gxe_include <- FALSE
    staging_reason <- "Single trial — one model, no staging."
  } else if (gxe_estimable && onestage_feasible) {
    rec_model_class <- "single_stage"; rec_gxe_include <- TRUE
    staging_reason <- "One-stage joint fit (gold standard): plot-level replication identifies the residual, so genotype, GxE, and error are estimated together."
  } else if (gxe_estimable && !onestage_feasible) {
    rec_model_class <- "two_stage"; rec_gxe_include <- FALSE
    staging_reason <- sprintf("GxE is supported by the data, but the one-stage fit that identifies it (~%d equations) exceeds the engine host's memory budget; falling back to a two-stage genotype-main model for scale. GxE is not separated in this fallback.", gxe_eq)
  } else {
    big <- (sc$n_cells * sc$n_traits) > ONESTAGE_MAX_EQ
    rec_model_class <- if (big) "two_stage" else "single_stage"; rec_gxe_include <- FALSE
    staging_reason <- if (big)
      "Large multi-environment problem; a two-stage removes field trend per environment in Stage 1, then fits a lighter cross-environment model."
    else "One-stage joint fit is feasible at this scale."
  }

  ## ---- staging override ----------------------------------------------------------------------
  ov_st <- ov("staging")
  st_feasible <- TRUE; st_refuse <- NULL
  if (!is.null(ov_st) && ov_st != rec_model_class) {
    if (!is_met) { st_feasible <- FALSE; st_refuse <- "Single trial — there is no staging choice to make." }
    else if (ov_st == "single_stage" && !onestage_feasible) {
      st_feasible <- FALSE
      st_refuse <- sprintf("A one-stage joint fit needs ~%d mixed-model equations, above the engine host's memory budget; a two-stage is required at this scale.", gxe_eq)
    }  # forcing two_stage on a MET is always feasible (a valid, weaker model)
  }
  model_class <- resolve("staging", rec_model_class, ov_st, st_feasible, st_refuse, staging_reason,
    list(n_obs = sc$n_obs, n_geno = sc$n_geno, n_env = sc$n_env, est_equations = gxe_eq))
  add_overridable("staging", list(
    opt("single_stage", (!is_met) || onestage_feasible, if (is_met && !onestage_feasible) sprintf("One-stage needs ~%d equations, above the memory budget.", gxe_eq) else NULL),
    opt("two_stage", is_met, if (is_met) NULL else "Single trial — no staging choice.")))

  ## ---- GxE override (contextual on the resolved staging) -------------------------------------
  ## GxE is only includable in a single-stage fit; a two-stage genotype-main fit folds it into error.
  gxe_allowed <- gxe_estimable && model_class == "single_stage"
  rec_gxe <- if (rec_gxe_include && model_class == "single_stage") "include" else "skip"
  if (gxe_allowed) {
    gxe_reason <- sprintf("%d genotypes shared across ≥2 environments (median %.1f env/genotype) with within-environment replication; GxE is identified from plot-level replication in the one-stage fit.",
      conn$connectors, conn$median_env_per_geno)
  } else if (!is_met) {
    gxe_reason <- "Single environment — genotype×environment is not defined."
  } else if (model_class == "two_stage" && gxe_estimable) {
    gxe_reason <- "GxE is supported by the data but is not separable in the two-stage genotype-main fit; it folds into the residual."
    add_unlock("genotype×environment (GxE) variance",
      "the fit that identifies GxE is one-stage, but a two-stage model is in use (recommended or chosen) at this scale",
      "Use a one-stage fit (smaller cohort/subset, or a higher-memory engine host) to estimate GxE — the data themselves support it.")
  } else if (!isTRUE(conn$gxe_connectivity_ok)) {
    gxe_reason <- sprintf("Too few genotypes connect environments (%d shared across ≥2 envs); a GxE term would be confounded with error.", conn$connectors)
    add_unlock("GxE / stability",
      sprintf("low cross-environment connectivity (%d connectors, median %.1f environments per genotype)", conn$connectors, conn$median_env_per_geno),
      "Share more genotypes across locations (overlap across environments, not extra plots within one) so the same lines can be compared environment-to-environment.")
  } else {
    gxe_reason <- "No within-environment replication, so GxE cannot be separated from plot error; it is reported as part of the residual."
    add_unlock("GxE / stability",
      "no within-environment replication (one plot per genotype×environment)",
      "Add replicated check plots or partial replication within environments so plot error can be estimated and GxE separated.")
  }
  ov_gx <- ov("gxe")
  gx_feasible <- TRUE; gx_refuse <- NULL
  if (!is.null(ov_gx) && ov_gx != rec_gxe) {
    if (ov_gx == "include") {
      if (!gxe_estimable) {
        gx_feasible <- FALSE
        gx_refuse <- if (!is_met) "Single environment — genotype×environment is not defined."
          else if (!isTRUE(conn$gxe_connectivity_ok)) sprintf("Too few genotypes connect environments (%d shared); GxE would be confounded with error.", conn$connectors)
          else "No within-environment replication; GxE cannot be separated from plot error."
      } else if (model_class == "two_stage") {
        gx_feasible <- FALSE
        gx_refuse <- "GxE is not separable in a two-stage genotype-main fit; switch staging to one-stage to estimate it."
      }
    }  # skip is always feasible
  }
  resolved_gxe <- resolve("gxe", rec_gxe, ov_gx, gx_feasible, gx_refuse, gxe_reason,
    list(connectors = conn$connectors, median_env_per_geno = conn$median_env_per_geno,
         residual_identifiable = repl$residual_identifiable))
  gxe_include <- resolved_gxe == "include" && gxe_allowed
  add_overridable("gxe", list(
    opt("include", gxe_allowed, if (gxe_allowed) NULL else gxe_reason),
    opt("skip", TRUE)))

  ## ---- genotype effect -----------------------------------------------------------------------
  add_dec("genotype_effect", "random", "Genotype fitted random (BLUPs) for selection.", NULL)

  ## ---- relationship (genomic-aware; CV winner when evidence supplied) -------------------------
  feas_rel <- function(r) switch(r, identity = TRUE, A = pedigree, G = markers, H = markers && pedigree, FALSE)
  ev_map <- c(identity = "identity", pedigree_A = "A", genomic_G = "G", genomic_H = "H")
  rec_rel <- "identity"; rel_evidence <- NULL
  rel_reason <- "No marker or pedigree data supplied; genotypes treated as unrelated (identity)."
  if (!is.null(evidence) && length(evidence)) {
    ev <- evidence; vals <- suppressWarnings(as.numeric(unlist(ev))); keys <- names(ev)
    codes <- unname(ev_map[keys]); ok <- !is.na(codes) & vapply(codes, feas_rel, logical(1)) & is.finite(vals)
    if (any(ok)) {
      pref <- c(identity = 1, A = 2, G = 3, H = 4)               # tiebreak toward more information
      best <- which(ok)[order(-vals[ok], -pref[codes[ok]])][1]
      rec_rel <- codes[best]; rel_evidence <- as.list(ev)
      pa <- function(code) { i <- which(codes == code & ok); if (length(i)) round(vals[i[1]], 2) else NA }
      rel_reason <- sprintf("Cross-validation picks %s: predictive ability genomic-G %.2f vs pedigree-A %.2f vs identity %.2f — markers capture Mendelian sampling pedigree can't.",
        rec_rel, pa("G"), pa("A"), pa("identity"))
    }
  } else if (markers) {
    rec_rel <- "G"; rel_reason <- "Marker data available; a genomic relationship matrix (G) borrows strength across relatives. Run cross-validation to confirm the gain."
  } else if (pedigree) {
    rec_rel <- "A"; rel_reason <- "Pedigree available; a numerator relationship matrix (A) borrows strength across relatives."
  }
  ov_rel <- ov("relationship")
  if (is.null(ov_rel) && !identical(relationship, "identity")) ov_rel <- relationship  # legacy channel
  rel_feasible <- is.null(ov_rel) || feas_rel(ov_rel)
  rel_refuse <- if (is.null(ov_rel)) NULL else switch(ov_rel,
    A = "No pedigree (parent1/parent2) supplied for this cohort.",
    G = "No marker data supplied for this cohort.",
    H = "Single-step H needs both markers and a pedigree.", NULL)
  relationship_out <- resolve("relationship", rec_rel, ov_rel, rel_feasible, rel_refuse, rel_reason, NULL, rel_evidence)
  add_overridable("relationship", list(
    opt("identity", TRUE),
    opt("A", pedigree, if (pedigree) NULL else "Add a pedigree (parent1/parent2) to enable A."),
    opt("G", markers, if (markers) NULL else "Add marker data to enable G."),
    opt("H", markers && pedigree, if (markers && pedigree) NULL else "Needs both markers and a pedigree.")))
  if (!markers && !pedigree)
    add_unlock("genomic prediction (G/H relationship; rrBLUP / ssGBLUP)",
      "no marker or pedigree data supplied",
      "Provide markers or a pedigree to enable a genomic relationship matrix and genomic-prediction engines.")

  ## ---- engine -------------------------------------------------------------------------------
  ## Variance components always fit on this phenotypic engine; the OVERRIDABLE choice is the GENOMIC
  ## prediction engine (rrBLUP fast default vs native BLUPF90/preGSf90 GBLUP, concordance-validated).
  pheno_engine <- if (!is_met) "SpATS/lme4" else if (model_class == "two_stage") "SpATS + blupf90+" else "blupf90+"
  genomic_engine <- NULL
  if (markers) {
    ov_eng <- ov("engine")
    ## native BLUPF90 GBLUP is built for the genomic relationship (G); A/H run on rrBLUP for now.
    bl_feasible <- relationship_out == "G"
    eng_refuse <- if (!is.null(ov_eng) && ov_eng == "blupf90" && !bl_feasible)
      "Native BLUPF90 GBLUP is wired for the genomic relationship (G); pedigree-A / single-step-H run on rrBLUP." else NULL
    eng_feasible <- is.null(ov_eng) || ov_eng == "rrblup" || (ov_eng == "blupf90" && bl_feasible)
    rec_eng_reason <- sprintf("rrBLUP computes the GEBVs (fast, the default at this scale); native BLUPF90/preGSf90 GBLUP is the scale engine for large cohorts. The two are cross-engine validated to give equivalent GEBVs. Variance components fit on %s.", pheno_engine)
    genomic_engine <- resolve("engine", "rrblup", ov_eng, eng_feasible, eng_refuse, rec_eng_reason, NULL)
    add_overridable("engine", list(
      opt("rrblup", TRUE),
      opt("blupf90", bl_feasible, if (bl_feasible) NULL else "Native BLUPF90 GBLUP is wired for the genomic relationship (G); switch relationship to G to use it.")))
  } else {
    add_dec("engine", pheno_engine,
      sprintf("%s — %s.", pheno_engine,
        if (is_met) "multi-environment multi-trait AI-REML variance components" else "single-trial spatial mixed model"), NULL)
  }
  engine <- pheno_engine

  list(
    model_class = model_class,
    staging_weighted = FALSE,
    genotype_effect = "random",
    spatial_method = spatial,
    gxe = list(include = gxe_include, reason = gxe_reason),
    engine = engine,
    genomic_engine = genomic_engine,           # resolved genomic prediction engine (rrblup/blupf90) or NULL
    relationship = relationship_out,
    decisions = decisions,
    unlocks = unlocks,
    overridable = overridable
  )
}
