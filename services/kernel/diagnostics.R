## Verdant compute kernel — data readiness diagnostics (ADR-0016).
##
## Deterministic facts about a dataset's STRUCTURE that gate every model decision (ADR-0002: the
## science is deterministic, the AI explains it). Crop-agnostic: reads the generic plot record
## (ADR-0015) — environment, genotype, row, col, rep — never dataset column names.
##
## Two layers:
##   * low-level predicates (grid_ok / within_rep_ok) — shared by analyze.R (single-trial) and
##     stage1-spatial.R, so the grid/rep gating lives in ONE place.
##   * compute_readiness() — the full per-environment + cross-environment summary the MET planner
##     consumes (and which is surfaced to the breeder as `data_readiness`).
##
## This file defines functions only; it is source()d, it does not run anything.

## ---- gate thresholds (named so they're explainable + tunable) --------------------------------
GRID_MIN_ROWS  <- 5L     # a 2D spline needs a real grid in both directions
GRID_MIN_COLS  <- 5L
GRID_MIN_PLOTS <- 50L     # …and enough plots to fit the surface
CONNECT_MIN_GENOS <- 30L  # ≥ this many genotypes shared across ≥2 environments → GxE has signal
CONNECT_MIN_FRAC  <- 0.20 # …or this fraction of genotypes, whichever is the softer bar

## ---- low-level predicates (single environment × trait) ---------------------------------------

## A usable 2D field grid? (row/col present, dense enough). `row`,`col` numeric (NA allowed).
grid_ok <- function(row, col, n_obs) {
  n_row <- length(unique(row[!is.na(row)]))
  n_col <- length(unique(col[!is.na(col)]))
  !anyNA(row) && !anyNA(col) &&
    n_row >= GRID_MIN_ROWS && n_col >= GRID_MIN_COLS && n_obs >= GRID_MIN_PLOTS
}

## More than one replicate block present (design replication)?
rep_ok <- function(rep) length(unique(rep[!is.na(rep)])) > 1

## Entry replication WITHIN an environment — the true residual-error signal: are any genotypes
## observed on more than one plot here? (Replicated checks count.) This, not rep blocks, is what
## lets a one-stage model separate plot error from genotype×environment.
within_rep_ok <- function(genotype) {
  tt <- table(genotype[!is.na(genotype)])
  any(tt > 1)
}

## ---- per-environment readiness ---------------------------------------------------------------
env_readiness <- function(genotype, row, col, rep) {
  n_obs <- length(genotype)
  tt <- table(genotype[!is.na(genotype)])
  list(
    n_obs = n_obs,
    n_geno = length(tt),
    n_row = length(unique(row[!is.na(row)])),
    n_col = length(unique(col[!is.na(col)])),
    has_grid = grid_ok(row, col, n_obs),
    n_rep = length(unique(rep[!is.na(rep)])),
    replicated_entries = as.integer(sum(tt > 1)), # genotypes with >1 plot here
    has_within_rep = any(tt > 1)
  )
}

## ---- full readiness across a MET -------------------------------------------------------------
## df: data.frame(environment, genotype, row, col, rep). trait_cols: character vector (for n_traits).
compute_readiness <- function(df, trait_cols) {
  envs <- sort(unique(df$environment))
  per_env <- lapply(envs, function(e) {
    d <- df[df$environment == e, , drop = FALSE]
    c(list(environment = e), env_readiness(d$genotype, d$row, d$col, d$rep))
  })
  names(per_env) <- NULL

  n_geno <- length(unique(df$genotype))
  n_env <- length(envs)
  # genotype×environment cells = candidate GxE levels (drives the one-stage scale estimate)
  n_cells <- sum(vapply(per_env, function(x) x$n_geno, numeric(1)))

  # cross-environment connectivity: how many environments each genotype is observed in.
  env_per_geno <- tapply(df$environment, df$genotype, function(x) length(unique(x)))
  env_per_geno <- as.numeric(env_per_geno)
  connectors <- sum(env_per_geno >= 2)                 # genotypes that link environments
  frac_connectors <- if (n_geno > 0) connectors / n_geno else 0
  median_env_per_geno <- if (length(env_per_geno)) stats::median(env_per_geno) else 0

  # gates
  any_grid <- any(vapply(per_env, function(x) isTRUE(x$has_grid), logical(1)))
  all_grid <- length(per_env) > 0 && all(vapply(per_env, function(x) isTRUE(x$has_grid), logical(1)))
  # residual identifiable from within-env replication in (most of) the trials?
  rep_envs <- sum(vapply(per_env, function(x) isTRUE(x$has_within_rep), logical(1)))
  residual_identifiable <- n_env > 0 && rep_envs >= ceiling(n_env / 2)
  # GxE estimable: genotypes connect environments AND it's actually a MET
  gxe_connectivity_ok <- n_env >= 2 &&
    (connectors >= CONNECT_MIN_GENOS || frac_connectors >= CONNECT_MIN_FRAC)

  list(
    scale = list(
      n_obs = nrow(df), n_geno = n_geno, n_env = n_env, n_cells = n_cells,
      n_traits = length(trait_cols)
    ),
    is_met = n_env >= 2,
    environments = per_env,
    connectivity = list(
      connectors = as.integer(connectors),
      frac_connectors = round(frac_connectors, 4),
      median_env_per_geno = round(median_env_per_geno, 3),
      gxe_connectivity_ok = gxe_connectivity_ok
    ),
    replication = list(
      environments_with_within_rep = as.integer(rep_envs),
      residual_identifiable = residual_identifiable
    ),
    grids = list(any_grid = any_grid, all_grid = all_grid),
    # GxE separates from error ONLY in a one-stage plot-level fit with within-cell replication. A
    # two-stage on one mean per genotype×env cell cannot identify it — confounded with residual,
    # verified empirically (the components diverge). So the single gate is connectivity + replication.
    gxe_estimable = gxe_connectivity_ok && residual_identifiable
  )
}
