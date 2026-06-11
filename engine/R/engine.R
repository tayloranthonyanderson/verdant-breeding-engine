## engine.R — pluggable mixed-model engine for the analysis core.
##
## ONE contract, swappable backends. Today: lme4 (default) and rrBLUP (two-step).
## Tomorrow: a BLUPF90/GCTA adapter slots in behind the same signature, no rewrite.
##
##   fit_genotype_values(data, trait, ...) -> list(
##     effects      : data.frame(genotype, value, type)   # BLUPs or BLUEs
##     varcomp      : data.frame(component, variance)
##     heritability : numeric                              # line-mean h2
##     engine       : character
##     warnings     : character vector
##   )

#' Fit per-genotype values for one trait.
#'
#' @param data data.frame in long format (one row per plot).
#' @param trait name of the trait column to analyze.
#' @param genotype,env,block column names for genotype, environment, block.
#' @param genotype_effect "random" -> BLUPs (for selection);
#'                        "fixed"  -> BLUEs (for unbiased comparison).
#' @param engine "lme4" (default) or "rrblup" (two-step).
#' @return list(effects, varcomp, heritability, engine, warnings)
#' @export
fit_genotype_values <- function(data, trait,
                                genotype = "genotype", env = "env", block = "block",
                                genotype_effect = c("random", "fixed"),
                                engine = c("lme4", "rrblup")) {
  genotype_effect <- match.arg(genotype_effect)
  engine <- match.arg(engine)

  # normalize to internal column names so formula building stays simple
  d <- data.frame(
    geno  = factor(data[[genotype]]),
    value = suppressWarnings(as.numeric(data[[trait]])),
    stringsAsFactors = FALSE
  )
  has_env   <- !is.null(env)   && env   %in% names(data) && length(unique(data[[env]]))   > 1
  has_block <- !is.null(block) && block %in% names(data) && length(unique(data[[block]])) > 1
  if (has_env)   d$env   <- factor(data[[env]])
  if (has_block) d$block <- factor(data[[block]])
  d <- d[is.finite(d$value), , drop = FALSE]
  if (nrow(d) < 3 || nlevels(d$geno) < 2)
    stop("Not enough data to fit '", trait, "' (need >=2 genotypes and >=3 obs).")

  if (engine == "rrblup")
    return(.fit_rrblup_twostep(d, trait, has_env, has_block))
  .fit_lme4(d, trait, has_env, has_block, genotype_effect)
}

# ---- lme4 backend ---------------------------------------------------------
.fit_lme4 <- function(d, trait, has_env, has_block, genotype_effect) {
  warns <- character(0)
  catchw <- function(expr) withCallingHandlers(expr,
    warning = function(w) { warns[[length(warns) + 1L]] <<- conditionMessage(w); invokeRestart("muffleWarning") })

  nGeno <- nlevels(d$geno)
  nEnv  <- if (has_env) nlevels(d$env) else 1L
  nRep  <- max(1L, round(nrow(d) / (nGeno * nEnv)))

  if (genotype_effect == "random") {
    rhs <- "1 + (1|geno)"
    if (has_env)   rhs <- paste(rhs, "+ env + (1|geno:env)")
    if (has_block) rhs <- paste(rhs, if (has_env) "+ (1|env:block)" else "+ (1|block)")
    m  <- catchw(lme4::lmer(stats::as.formula(paste("value ~", rhs)), data = d, REML = TRUE))
    vc <- as.data.frame(lme4::VarCorr(m))
    getv <- function(g) { x <- vc$vcov[vc$grp == g]; if (length(x)) x[1] else NA_real_ }
    Vg <- getv("geno"); Vge <- getv("geno:env"); Ve <- getv("Residual")
    denom <- Vg + (if (is.na(Vge)) 0 else Vge / nEnv) + Ve / (nEnv * nRep)
    h2 <- if (is.na(Vg)) NA_real_ else Vg / denom
    rf <- lme4::ranef(m)$geno
    eff <- data.frame(genotype = rownames(rf),
                      value = lme4::fixef(m)[["(Intercept)"]] + rf[, 1],
                      type = "BLUP", row.names = NULL, stringsAsFactors = FALSE)
    varcomp <- data.frame(component = vc$grp, variance = vc$vcov)
  } else {
    # BLUEs: genotype fixed via 0+geno; nuisance factors random.
    rhs <- "0 + geno"
    if (has_env)   rhs <- paste(rhs, "+ (1|env) + (1|geno:env)")
    if (has_block) rhs <- paste(rhs, if (has_env) "+ (1|env:block)" else "+ (1|block)")
    if (!has_env && !has_block) {
      m  <- catchw(stats::lm(value ~ 0 + geno, data = d))
      co <- stats::coef(m)
      varcomp <- data.frame(component = "Residual", variance = stats::sigma(m)^2)
    } else {
      m  <- catchw(lme4::lmer(stats::as.formula(paste("value ~", rhs)), data = d, REML = TRUE))
      co <- lme4::fixef(m)
      vc <- as.data.frame(lme4::VarCorr(m))
      varcomp <- data.frame(component = vc$grp, variance = vc$vcov)
    }
    eff <- data.frame(genotype = sub("^geno", "", names(co)),
                      value = as.numeric(co), type = "BLUE",
                      row.names = NULL, stringsAsFactors = FALSE)
    h2 <- NA_real_   # not defined for fixed genotype
  }

  list(effects = eff, varcomp = varcomp, heritability = h2,
       engine = "lme4", warnings = warns)
}

# ---- rrBLUP two-step backend ---------------------------------------------
# Stage 1: per-environment adjusted genotype means (BLUEs).
# Stage 2: genotype random across the stage-1 means with rrBLUP::mixed.solve.
# K defaults to identity here; pass a genomic relationship matrix later for GBLUP.
.fit_rrblup_twostep <- function(d, trait, has_env, has_block, K = NULL) {
  if (!requireNamespace("rrBLUP", quietly = TRUE))
    stop("rrBLUP not installed; use engine = 'lme4'.")

  stage1 <- if (has_env) {
    do.call(rbind, lapply(levels(d$env), function(ev) {
      sub <- d[d$env == ev, , drop = FALSE]
      if (nlevels(droplevels(sub$geno)) < 2) return(NULL)
      fit <- if (has_block && nlevels(droplevels(sub$block)) > 1)
        stats::lm(value ~ 0 + geno + block, data = sub) else stats::lm(value ~ 0 + geno, data = sub)
      co <- stats::coef(fit); co <- co[grepl("^geno", names(co))]
      data.frame(genotype = sub("^geno", "", names(co)), env = ev,
                 adj_mean = as.numeric(co), row.names = NULL)
    }))
  } else {
    fit <- if (has_block) stats::lm(value ~ 0 + geno + block, data = d) else stats::lm(value ~ 0 + geno, data = d)
    co <- stats::coef(fit); co <- co[grepl("^geno", names(co))]
    data.frame(genotype = sub("^geno", "", names(co)), env = "ENV1", adj_mean = as.numeric(co))
  }

  glev <- sort(unique(stage1$genotype))
  reps_per_geno <- nrow(stage1) / length(glev)
  if (reps_per_geno <= 1) {
    # single environment: genetic variance not identifiable -> report adj means
    eff <- data.frame(genotype = stage1$genotype, value = stage1$adj_mean,
                      type = "BLUE(stage1)", row.names = NULL, stringsAsFactors = FALSE)
    return(list(effects = eff,
                varcomp = data.frame(component = "residual", variance = stats::var(stage1$adj_mean)),
                heritability = NA_real_, engine = "rrblup (two-step)",
                warnings = "Single environment: genetic variance not identifiable; returning stage-1 means."))
  }
  Z <- stats::model.matrix(~ 0 + factor(stage1$genotype, levels = glev))
  colnames(Z) <- glev
  Kmat <- if (is.null(K)) diag(length(glev)) else K[glev, glev]
  sol  <- rrBLUP::mixed.solve(y = stage1$adj_mean, Z = Z, K = Kmat)
  u <- as.numeric(sol$u); names(u) <- glev
  eff <- data.frame(genotype = glev, value = as.numeric(sol$beta) + u,
                    type = "BLUP(2-step)", row.names = NULL, stringsAsFactors = FALSE)
  varcomp <- data.frame(component = c("genetic (Vu)", "residual (Ve)"),
                        variance = c(sol$Vu, sol$Ve))
  h2 <- sol$Vu / (sol$Vu + sol$Ve)
  list(effects = eff, varcomp = varcomp, heritability = h2,
       engine = "rrblup (two-step)", warnings = character(0))
}
