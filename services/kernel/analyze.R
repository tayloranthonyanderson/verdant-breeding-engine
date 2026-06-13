#!/usr/bin/env Rscript
## Verdant compute kernel — Milestone 0.
## Stateless (ADR-0001): reads an AnalysisRequest (engine contract) as JSON on stdin (or a file
## arg) and writes a ResultBundle as JSON on stdout. Owns model selection deterministically
## (ADR-0002): SpATS spatial splines when the field is a real grid, lme4 otherwise.
##
##   Rscript services/kernel/analyze.R < request.json > bundle.json
##
suppressWarnings(suppressPackageStartupMessages({
  library(jsonlite)
  library(lme4)
}))

## Shared data-readiness predicates (grid_ok / rep_ok), so the spatial gating lives in ONE place
## (ADR-0016) rather than being duplicated here and in stage1-spatial.R.
.self_dir <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)])
               if (length(f)) dirname(normalizePath(f)) else "." }
source(file.path(.self_dir, "diagnostics.R"))
## QC parity with the MET path (ADR-0021): pre-fit Data Quality + post-fit Model QC from the single-
## trial fit's OWN residuals. NO_MAIN guards keep these from running their stdin entrypoints on source.
Sys.setenv(DQ_NO_MAIN = "1", MQ_NO_MAIN = "1")
source(file.path(.self_dir, "data-quality.R"))
source(file.path(.self_dir, "model-qc.R"))

## ---- IO ---------------------------------------------------------------------------------
read_request <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  con <- if (length(args) >= 1 && file.exists(args[1])) args[1] else "stdin"
  txt <- paste(readLines(con, warn = FALSE), collapse = "\n")
  jsonlite::fromJSON(txt, simplifyVector = TRUE, simplifyDataFrame = TRUE)
}

## ---- assemble the plot-level data frame for one trait ----------------------------------
plot_frame <- function(req) {
  ou <- jsonlite::flatten(as.data.frame(req$observation_units, stringsAsFactors = FALSE))
  # normalize layout column names (flatten yields layout.row, layout.col, ...)
  ren <- c("layout.row" = "row", "layout.col" = "col",
           "layout.rep" = "rep", "layout.block" = "block")
  for (k in names(ren)) if (k %in% names(ou)) names(ou)[names(ou) == k] <- ren[[k]]
  for (c in c("row", "col", "rep", "block")) if (!c %in% names(ou)) ou[[c]] <- NA
  ou
}

trait_data <- function(req, ou, variable_id) {
  obs <- as.data.frame(req$observations, stringsAsFactors = FALSE)
  obs <- obs[obs$variable_id == variable_id, c("observation_unit_id", "value")]
  obs$value <- suppressWarnings(as.numeric(obs$value))
  d <- merge(ou, obs, by = "observation_unit_id")
  d <- d[is.finite(d$value), , drop = FALSE]
  d$germplasm <- factor(d$germplasm_id)
  d
}

## Per-plot residual frame from a fit's residuals (aligned to d) — the REAL residuals Model QC uses.
.plot_resid <- function(d, res) {
  res <- suppressWarnings(as.numeric(res))
  if (length(res) != nrow(d)) return(NULL)
  env <- if ("environment_id" %in% names(d)) as.character(d$environment_id) else rep("trial", nrow(d))
  env[is.na(env)] <- "trial"
  data.frame(plot_id = as.character(d$observation_unit_id), genotype = as.character(d$germplasm),
             environment = env, row = suppressWarnings(as.numeric(d$row)),
             col = suppressWarnings(as.numeric(d$col)), residual = res, fitted = d$value - res,
             stringsAsFactors = FALSE)
}

## ---- model selection + fit for one trait -----------------------------------------------
fit_trait <- function(d) {
  has_grid <- grid_ok(d$row, d$col, nrow(d))
  has_rep <- rep_ok(d$rep)

  if (has_grid && requireNamespace("SpATS", quietly = TRUE)) {
    out <- tryCatch(fit_spats(d, has_rep), error = function(e) NULL)
    if (!is.null(out)) return(out)
  }
  fit_lme4(d, has_rep)
}

fit_spats <- function(d, has_rep) {
  d$R <- as.numeric(d$row); d$C <- as.numeric(d$col)
  nseg <- c(min(20L, length(unique(d$C))), min(20L, length(unique(d$R))))
  fixed <- if (has_rep) stats::as.formula("~ rep") else NULL
  if (has_rep) d$rep <- factor(d$rep)
  fit <- SpATS::SpATS(
    response = "value", genotype = "germplasm", genotype.as.random = TRUE,
    spatial = ~ SpATS::PSANOVA(C, R, nseg = nseg), fixed = fixed, data = d,
    control = list(monitoring = 0, maxit = 100)
  )
  pred <- predict(fit, which = "germplasm")
  vc <- fit$var.comp
  vg <- suppressWarnings(as.numeric(vc["germplasm"]))   # genotype variance component = Vg
  .res <- tryCatch(as.numeric(stats::residuals(fit)), error = function(e) rep(NA_real_, nrow(d)))
  list(
    resid = .plot_resid(d, .res),
    effects = data.frame(
      germplasm_id = as.character(pred$germplasm),
      value = round(pred$predicted.values, 5),
      type = "BLUP",
      std_error = round(pred$standard.errors, 5),
      stringsAsFactors = FALSE
    ),
    genetic_sd = if (length(vg) && is.finite(vg) && vg > 0) sqrt(vg) else NA_real_,
    h2_method = "cullis",
    h2 = round(SpATS::getHeritability(fit), 4),
    varcomp = data.frame(component = names(vc), variance = round(as.numeric(vc), 6),
                         stringsAsFactors = FALSE),
    spatial_method = "spats",
    engine = "SpATS",
    formula = "value ~ PSANOVA(col,row) + genotype(random)" ,
    rationale = sprintf(
      "Field is a %d×%d row×col grid (≥ 5 each), so a SpATS 2D P-spline corrects spatial trend; genotype fitted random for selection (BLUPs). Cullis heritability reported.",
      length(unique(d$row)), length(unique(d$col))),
    n_obs = nrow(d), n_geno = nlevels(d$germplasm)
  )
}

fit_lme4 <- function(d, has_rep) {
  has_block <- length(unique(d$block[!is.na(d$block)])) > 1
  rhs <- "(1 | germplasm)"
  if (has_rep)   { d$rep <- factor(d$rep);     rhs <- paste(rhs, "+ (1 | rep)") }
  if (has_block) { d$block <- factor(d$block); rhs <- paste(rhs, "+ (1 | block)") }
  m <- lme4::lmer(stats::as.formula(paste("value ~", rhs)), data = d, REML = TRUE)
  vc <- as.data.frame(lme4::VarCorr(m))
  Vg <- vc$vcov[vc$grp == "germplasm"][1]
  Ve <- vc$vcov[vc$grp == "Residual"][1]
  nrep <- max(1, round(nrow(d) / nlevels(d$germplasm)))
  rf <- lme4::ranef(m)$germplasm
  list(
    resid = .plot_resid(d, as.numeric(stats::residuals(m))),
    effects = data.frame(
      germplasm_id = rownames(rf),
      value = round(lme4::fixef(m)[["(Intercept)"]] + rf[, 1], 5),
      type = "BLUP", std_error = NA_real_, stringsAsFactors = FALSE
    ),
    genetic_sd = if (is.finite(Vg) && Vg > 0) sqrt(Vg) else NA_real_,
    h2_method = "standard",
    h2 = round(Vg / (Vg + Ve / nrep), 4),
    varcomp = data.frame(component = vc$grp, variance = round(vc$vcov, 6),
                         stringsAsFactors = FALSE),
    spatial_method = "none",
    engine = "lme4",
    formula = paste("value ~", rhs),
    rationale = "Field layout is not a usable grid (or too few plots) for a spatial spline; fitted a randomized mixed model with genotype random (BLUPs).",
    n_obs = nrow(d), n_geno = nlevels(d$germplasm)
  )
}

## ---- selection index (transparent weighted, M0) ----------------------------------------
## Resolve each index-weight row to a canonical {mode, target, direction} (ADR-0006). `mode` is
## authoritative; absent mode falls back to the legacy signed `direction` (+1→max, −1→min); a
## target mode missing its `target` degrades to max so a malformed objective never aborts a run.
resolve_index_spec <- function(wdf) {
  n <- nrow(wdf)
  mode <- character(n); target <- rep(NA_real_, n); direction <- rep(1L, n)
  for (i in seq_len(n)) {
    m <- if (!is.null(wdf$mode) && !is.na(wdf$mode[i]) && nzchar(as.character(wdf$mode[i])))
      as.character(wdf$mode[i]) else NA_character_
    d <- if (!is.null(wdf$direction) && !is.na(wdf$direction[i])) as.integer(wdf$direction[i]) else NA_integer_
    t <- if (!is.null(wdf$target) && !is.na(wdf$target[i])) suppressWarnings(as.numeric(wdf$target[i])) else NA_real_
    if (is.na(m)) m <- if (!is.na(d) && d < 0) "min" else "max"
    if (m == "target" && !is.finite(t)) m <- "max"
    mode[i] <- m; target[i] <- t
    direction[i] <- if (m == "min") -1L else 1L
  }
  data.frame(variable_id = as.character(wdf$variable_id), mode = mode, target = target,
             direction = direction, weight = as.numeric(wdf$weight), stringsAsFactors = FALSE)
}

## Transparent weighted index (ADR-0006). For each trait:
##   1. standardize BLUPs to z = (value − mean)/sd  (empirical sample sd → unit variance, so the
##      weight slider stays honest: 30% weight is 30% of the influence for linear traits).
##   2. merit:  max → +z ;  min → −z ;  target → −((z − z_target)²)  (quadratic deviation penalty).
##   3. standardize each merit COLUMN to mean 0 / unit sd, so the quadratic target term lands on the
##      same footing as the linear terms (no more ±3 vs −13) and reads symmetrically around zero.
## Genetic variance (√Vg) is deliberately NOT used here — it stays honest weights, not reliability-
## tilted ones; √Vg belongs to the genetically-aware Smith–Hazel index, whose divergence from this
## one is itself the insight.
weighted_index <- function(effects_by_trait, spec, gates_by_geno) {
  genos <- sort(unique(unlist(lapply(effects_by_trait, function(e) e$germplasm_id))))
  z <- matrix(0, nrow = length(genos), ncol = nrow(spec),
              dimnames = list(genos, spec$variable_id))
  for (j in seq_len(nrow(spec))) {
    v <- spec$variable_id[j]
    e <- effects_by_trait[[v]]
    if (is.null(e)) next
    val <- e$value[match(genos, e$germplasm_id)]
    mu <- mean(val, na.rm = TRUE)
    sdv <- stats::sd(val, na.rm = TRUE)            # empirical sample sd (n-1): unit-variance z
    if (!is.finite(sdv) || sdv == 0) sdv <- 1
    zc <- (val - mu) / sdv
    merit <- switch(spec$mode[j],
      min = -zc,
      target = { zt <- (spec$target[j] - mu) / sdv; -((zc - zt)^2) },
      zc)                                          # default == "max"
    # normalize the merit column so linear and quadratic terms are comparable and weights stay honest
    mm <- mean(merit, na.rm = TRUE)
    ms <- stats::sd(merit, na.rm = TRUE)
    if (!is.finite(ms) || ms == 0) ms <- 1
    meritn <- (merit - mm) / ms
    meritn[is.na(meritn)] <- 0
    z[, j] <- meritn * spec$weight[j]
  }
  score <- rowSums(z)
  ord <- order(-score)
  ranking <- lapply(seq_along(ord), function(i) {
    g <- genos[ord[i]]
    gf <- gates_by_geno[[g]]
    list(germplasm_id = g, rank = i, score = round(unname(score[ord[i]]), 5),
         gated_out = !is.null(gf) && length(gf) > 0,
         gate_failures = if (is.null(gf)) character(0) else gf)
  })
  ranking
}

evaluate_gates <- function(effects_by_trait, gates) {
  res <- list()
  if (is.null(gates) || NROW(gates) == 0) return(res)
  gates <- as.data.frame(gates, stringsAsFactors = FALSE)
  genos <- sort(unique(unlist(lapply(effects_by_trait, function(e) e$germplasm_id))))
  for (g in genos) {
    fails <- character(0)
    for (k in seq_len(nrow(gates))) {
      v <- gates$variable_id[k]; e <- effects_by_trait[[v]]
      if (is.null(e)) next
      val <- e$value[match(g, e$germplasm_id)]
      if (is.na(val)) next
      thr <- suppressWarnings(as.numeric(gates$threshold[k]))
      op <- gates$operator[k]
      ok <- switch(op, ">=" = val >= thr, "<=" = val <= thr, ">" = val > thr,
                   "<" = val < thr, "==" = val == thr, "!=" = val != thr, TRUE)
      if (!isTRUE(ok)) fails <- c(fails, v)
    }
    if (length(fails)) res[[g]] <- fails
  }
  res
}

## ---- main -------------------------------------------------------------------------------
main <- function() {
  req <- read_request()
  ou <- plot_frame(req)
  vars <- as.data.frame(req$variables, stringsAsFactors = FALSE)
  analyze_vars <- vars$variable_id[is.na(vars$analyze) | vars$analyze]

  trait_results <- list(); effects_by_trait <- list(); warns <- list()
  spatial_used <- "none"; engine_used <- "lme4"; geno_effect <- "random"
  model_formula <- NULL
  for (v in analyze_vars) {
    d <- trait_data(req, ou, v)
    if (nrow(d) < 3 || nlevels(d$germplasm) < 2) {
      trait_results[[length(trait_results) + 1]] <- list(
        variable_id = v, status = "error", effects = list(),
        warnings = list(list(message = paste("Too few observations to fit", v), severity = "error")))
      next
    }
    f <- fit_trait(d)
    effects_by_trait[[v]] <- f$effects
    if (f$spatial_method == "spats") { spatial_used <- "spats"; engine_used <- f$engine }
    if (is.null(model_formula)) model_formula <- f$formula
    eff_list <- lapply(seq_len(nrow(f$effects)), function(i) {
      e <- f$effects[i, ]
      list(germplasm_id = e$germplasm_id, value = e$value, type = e$type,
           std_error = if (is.na(e$std_error)) NULL else e$std_error)
    })
    vc_list <- lapply(seq_len(nrow(f$varcomp)), function(i)
      list(component = f$varcomp$component[i], variance = f$varcomp$variance[i]))
    ## Model QC from the fit's OWN residuals (ADR-0021), merged into the trait diagnostics.
    diag <- list(converged = TRUE, n_obs = f$n_obs, n_genotypes = f$n_geno)
    if (!is.null(f$resid) && nrow(f$resid) >= 10) {
      rd <- f$resid
      mq <- model_qc_from_residuals(stats::setNames(list(list(
        residual = rd$residual, fitted = rd$fitted, genotype = rd$genotype,
        environment = rd$environment, row = rd$row, col = rd$col, plot_id = rd$plot_id)), v))[[v]]
      if (!is.null(mq)) diag <- utils::modifyList(diag, mq)
    }
    trait_results[[length(trait_results) + 1]] <- list(
      variable_id = v, status = "ok", effects = eff_list,
      genetic_sd = if (is.null(f$genetic_sd) || is.na(f$genetic_sd)) NULL else round(f$genetic_sd, 6),
      heritability = if (is.na(f$h2)) NULL else list(method = f$h2_method, value = f$h2),
      varcomp = vc_list,
      diagnostics = diag,
      warnings = list())
    warns[[paste0("model_", v)]] <- f$rationale
  }

  ## selection index from the objective
  indices <- list(); divergence <- NULL
  obj <- req$objective
  if (!is.null(obj) && !is.null(obj$index_weights) && NROW(obj$index_weights) > 0) {
    wdf <- as.data.frame(obj$index_weights, stringsAsFactors = FALSE)
    spec <- resolve_index_spec(wdf)
    gates_by_geno <- evaluate_gates(effects_by_trait, obj$gates)
    ranking <- weighted_index(effects_by_trait, spec, gates_by_geno)
    wused <- lapply(seq_len(nrow(spec)), function(i)
      list(variable_id = spec$variable_id[i], mode = spec$mode[i], direction = spec$direction[i],
           target = if (spec$mode[i] == "target") spec$target[i] else NULL, weight = spec$weight[i]))
    indices[[1]] <- list(kind = "weighted",
                         segment_id = if (!is.null(req$scope$segment_id)) req$scope$segment_id else NULL,
                         ranking = ranking, weights_used = wused)
  }

  run_warnings <- list()
  n_env <- length(unique(stats::na.omit(ou$environment_id)))
  if (n_env <= 1) run_warnings[[length(run_warnings) + 1]] <- list(
    code = "single_environment",
    message = "One location-season only: GxE and stability cannot be estimated.",
    severity = "info")

  ## Pre-fit Data Quality over the assembled plots (ADR-0021), QC parity with the MET path.
  data_quality <- tryCatch({
    obs_all <- as.data.frame(req$observations, stringsAsFactors = FALSE)
    ou_ids <- as.character(ou$observation_unit_id)
    vbt <- list()
    for (v in analyze_vars) {
      ov <- obs_all[obs_all$variable_id == v, c("observation_unit_id", "value")]
      vbt[[v]] <- suppressWarnings(as.numeric(ov$value))[match(ou_ids, as.character(ov$observation_unit_id))]
    }
    env_v <- if ("environment_id" %in% names(ou)) as.character(ou$environment_id) else rep("trial", length(ou_ids))
    env_v[is.na(env_v)] <- "trial"
    compute_data_quality(
      genotype = as.character(ou$germplasm_id), environment = env_v,
      row = suppressWarnings(as.numeric(ou$row)), col = suppressWarnings(as.numeric(ou$col)),
      rep = if ("rep" %in% names(ou)) as.character(ou$rep) else rep(NA_character_, length(ou_ids)),
      plot_id = ou_ids, values_by_trait = vbt)
  }, error = function(e) NULL)

  bundle <- list(
    contract_version = "v0",
    analysis_request_id = if (!is.null(req$analysis_request_id)) req$analysis_request_id else NULL,
    status = "ok",
    intent = req$intent,
    chosen_model = list(
      description = sprintf("Single-trial %s model; genotype random (BLUPs).",
                           if (spatial_used == "spats") "spatial (SpATS P-spline)" else "mixed"),
      formula = model_formula,
      genotype_effect = geno_effect,
      spatial_method = spatial_used,
      relationship = if (!is.null(req$relationship$type)) req$relationship$type else "identity",
      engine = engine_used,
      rationale = paste(unique(unlist(warns)), collapse = " ")
    ),
    traits = trait_results,
    data_quality = data_quality,
    indices = indices,
    warnings = run_warnings,
    provenance = list(
      contract_version = "v0",
      engine_versions = list(
        SpATS = as.character(tryCatch(utils::packageVersion("SpATS"), error = function(e) NA)),
        lme4 = as.character(utils::packageVersion("lme4")))
    )
  )

  cat(jsonlite::toJSON(bundle, auto_unbox = TRUE, null = "null", na = "null", digits = NA))
}

main()
