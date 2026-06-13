#!/usr/bin/env Rscript
## Verdant compute kernel — Model QC (post-fit residual diagnostics). ADR-0021.
##
## The statistically proper SECOND outlier/assumption pass — the one a statistician runs AFTER fitting.
## Readiness says a model is FEASIBLE; this says it actually WORKED. It validates the fit the bundle
## reports, WITHOUT a refit: it reconstructs the conditional residual e_ij = y_ij − (μ + env_e + BLUP_g)
## from the bundle's own per-genotype BLUPs (the genotype contribution is exact; the environment fixed
## effect is recovered as the within-environment mean of y − BLUP). From those residuals it computes:
##   * residual normality (Shapiro / Anderson-Darling-style) — are the model's normality assumptions ok?
##   * heteroscedasticity — does residual spread grow with the fitted value?
##   * spatial-residual autocorrelation (Moran's I, rook contiguity) — did the spatial model remove trend?
##   * influential observations — large studentized residuals; the residual-based outlier pass, each
##     carrying its plot id so it becomes a one-click suggested_exclusion (ADR-0021).
##
## This is the proper complement to data-quality.R's crude pre-fit pass (two-pass QC, ADR-0021).
##
## Run:  Rscript services/kernel/model-qc.R < mq-input.json > mq-output.json
## Input  (JSON): { variable_ids:[K], genotype:[N], environment:[N], row:[N], col:[N], plot_id:[N],
##                  values_by_trait:{ <trait>:[N] }, blups_by_trait:{ <trait>:{ <genotype>:blup } } }
## Output (JSON): { <trait>: { residual_normality_p, heteroscedasticity_p, spatial_residual_autocorr,
##                  n_resid, influential:[{observation_unit_id,germplasm_id,environment_id,value,
##                  studentized_resid}] } }
##
## Sourceable for tests: set MQ_NO_MAIN=1 to load the functions without running the entrypoint.

STUD_K          <- 3.5   # |studentized residual| above this → influential (residual-based outlier)
MAX_INFLUENTIAL <- 20L   # cap influential rows reported per trait (the rest summarised, not silently dropped)
SHAPIRO_MAX_N   <- 5000L  # shapiro.test() upper bound; sample above this
SCATTER_MAX     <- 500L   # downsample the residual-vs-fitted scatter to ≤ this (always keep influential pts)
QQ_MAX          <- 160L   # downsample the Q-Q plot to ≤ this many points (ALWAYS keep the tail/outlier pts)
SPATIAL_MAX_CELLS <- 1200L # cap the field-heatmap cells shipped (sample if the worst env is larger)

## Normal Q-Q plot data — the trustworthy normality diagnostic (replaces the bin-dependent histogram).
## Standardise residuals to z = (r − mean)/sd, sort, and pair each with its theoretical normal quantile
## qnorm((i−0.5)/n). On the plot, z (y) vs theoretical (x): points hugging the y=x line ⇒ normal; points
## peeling off at the ends ⇒ heavy tails / outliers (flagged o=1) — and the tails are exactly where a Q-Q
## plot is most readable, the opposite of a histogram. No binning, no window to fudge. Downsampled but
## every tail/outlier point kept (they're the whole point), so the extremes are never hidden.
make_qq <- function(r) {
  n <- length(r); if (n < 10) return(NULL)
  m <- mean(r); s <- stats::sd(r); if (!is.finite(s) || s == 0) s <- 1
  z <- sort((r - m) / s)
  theo <- stats::qnorm((seq_len(n) - 0.5) / n)
  o <- abs(z) > STUD_K
  idx_o <- which(o)
  rest <- setdiff(seq_len(n), idx_o)
  if (length(rest) > QQ_MAX - length(idx_o)) {
    keep <- max(0L, QQ_MAX - length(idx_o))
    rest <- if (keep > 0) rest[round(seq(1, length(rest), length.out = keep))] else integer(0)
  }
  sidx <- sort(unique(c(idx_o, rest)))
  points <- lapply(sidx, function(i) list(t = round(theo[i], 3), s = round(z[i], 3), o = if (o[i]) 1L else 0L))
  list(points = points, n = n, n_outliers = length(idx_o))  # reference line is y = x (z is standardised)
}

## The single environment whose residuals are most spatially structured (max |Moran's I|), with its
## per-plot residual cells for a field heatmap. Returns NULL when no env has a usable grid.
worst_env_spatial <- function(environment, row, col, r) {
  best <- NULL; best_abs <- 0
  for (e in unique(environment)) {
    idx <- which(environment == e & is.finite(r) & is.finite(row) & is.finite(col))
    if (length(idx) < 16) next
    rr <- row[idx]; cc <- col[idx]; z <- r[idx] - mean(r[idx]); denom <- sum(z^2)
    if (denom == 0) next
    num <- 0; W <- 0
    for (a in seq_along(idx)) for (b in seq_along(idx)) {
      if (a == b) next
      if (abs(rr[a] - rr[b]) + abs(cc[a] - cc[b]) == 1) { num <- num + z[a] * z[b]; W <- W + 1 }
    }
    if (W == 0) next
    I <- (length(idx) / W) * num / denom
    if (is.finite(I) && abs(I) > best_abs) { best_abs <- abs(I); best <- list(e = e, idx = idx, I = I) }
  }
  if (is.null(best)) return(NULL)
  idx <- best$idx
  if (length(idx) > SPATIAL_MAX_CELLS) idx <- sort(sample(idx, SPATIAL_MAX_CELLS))
  cells <- lapply(idx, function(k) list(row = row[k], col = col[k], r = round(r[k], 4)))
  list(environment = best$e, moran = round(best$I, 4), cells = cells)
}

## Conditional residuals from the bundle's BLUPs: y − (env_mean(y − BLUP) + BLUP). Genotype part exact;
## environment fixed effect recovered as the within-env mean of (y − BLUP).
conditional_residuals <- function(genotype, environment, value, blup_map) {
  blup <- unname(blup_map[genotype]); blup[is.na(blup)] <- 0
  resid <- rep(NA_real_, length(value))
  base <- value - blup
  for (e in unique(environment)) {
    idx <- environment == e & is.finite(value)
    if (!any(idx)) next
    env_eff <- mean(base[idx], na.rm = TRUE)
    resid[idx] <- value[idx] - (blup[idx] + env_eff)
  }
  resid
}

## Moran's I on residuals using rook contiguity (|Δrow|+|Δcol| == 1) within each environment, averaged
## across environments (weighted by the number of adjacency pairs). 0 ≈ no spatial structure left.
spatial_morans_i <- function(environment, row, col, resid) {
  num_tot <- 0; den_tot <- 0; w_tot <- 0; got <- FALSE
  for (e in unique(environment)) {
    idx <- which(environment == e & is.finite(resid) & is.finite(row) & is.finite(col))
    n <- length(idx); if (n < 8) next
    r <- resid[idx]; rr <- row[idx]; cc <- col[idx]
    z <- r - mean(r); denom <- sum(z^2); if (denom == 0) next
    num <- 0; W <- 0
    for (a in seq_len(n)) for (b in seq_len(n)) {
      if (a == b) next
      if (abs(rr[a] - rr[b]) + abs(cc[a] - cc[b]) == 1) { num <- num + z[a] * z[b]; W <- W + 1 }
    }
    if (W == 0) next
    got <- TRUE
    num_tot <- num_tot + (n / W) * num; den_tot <- den_tot + denom; w_tot <- w_tot + 1
  }
  if (!got || den_tot == 0) return(NA_real_)
  (num_tot / w_tot) / (den_tot / w_tot)
}

## ---- the diagnostics core ---------------------------------------------------------------------
## Computes every Model-QC diagnostic from residuals + fitted DIRECTLY. Both callers use it: the
## reconstruction path (trait_model_qc, the one-stage fallback) and the REAL-residual path (Stage-1
## SpATS, via model_qc_from_residuals) — so the genuinely spatially-adjusted residuals get the exact
## same treatment. All inputs are already finite-filtered and aligned (length n). `source` records
## whether the residuals are the model's own ("fit") or reconstructed from BLUPs ("reconstructed").
qc_core <- function(r, fitted, genotype, environment, row, col, plot_id, source = "fit") {
  n <- length(r)
  if (n < 10) return(list(n_resid = n, influential = list(), residual_source = source))
  sdr <- stats::sd(r); if (!is.finite(sdr) || sdr == 0) sdr <- 1
  stud <- r / sdr
  z <- (r - mean(r)) / sdr
  ## normality by EFFECT SIZE (skewness + excess kurtosis): a p-value rejects on any real-size trait
  ## (n in the thousands), so it cries wolf — magnitude is what tells a breeder if it actually matters.
  skew <- mean(z^3)
  kurt <- mean(z^4) - 3
  norm_p <- tryCatch({
    rs <- if (n > SHAPIRO_MAX_N) sample(r, SHAPIRO_MAX_N) else r
    stats::shapiro.test(rs)$p.value
  }, error = function(e) NA_real_)

  ## heteroscedasticity: Spearman correlation of |resid| with fitted (robust, no distributional assumption)
  het_rho <- tryCatch(suppressWarnings(stats::cor(abs(r), fitted, method = "spearman")), error = function(e) NA_real_)
  het_p <- tryCatch(suppressWarnings(stats::cor.test(abs(r), fitted, method = "spearman"))$p.value,
                    error = function(e) NA_real_)

  ## spatial residual autocorrelation
  moran <- spatial_morans_i(environment, row, col, r)

  ## influential observations (top |studentized| above the cut)
  hit <- which(abs(stud) > STUD_K)
  hit <- hit[order(-abs(stud[hit]))]
  capped <- head(hit, MAX_INFLUENTIAL)
  vi <- fitted + r
  influential <- lapply(capped, function(h) list(
    observation_unit_id = plot_id[h], germplasm_id = genotype[h], environment_id = environment[h],
    value = round(vi[h], 5), studentized_resid = round(stud[h], 2)))

  ## ---- compact viz payloads (so scientists can SEE the residuals; downsampled to stay lean) -----
  infl_set <- hit
  rest <- setdiff(seq_len(n), infl_set)
  if (length(rest) > SCATTER_MAX - length(infl_set)) {
    keep_n <- max(0, SCATTER_MAX - length(infl_set))
    rest <- if (keep_n > 0) rest[round(seq(1, length(rest), length.out = keep_n))] else integer(0)
  }
  sidx <- sort(unique(c(infl_set, rest)))
  is_infl <- sidx %in% infl_set
  scatter <- lapply(seq_along(sidx), function(i) {
    k <- sidx[i]
    list(f = round(fitted[k], 4), r = round(r[k], 4), o = if (is_infl[i]) 1L else 0L)
  })
  viz <- list(
    scatter = scatter,
    qq = make_qq(r),
    # always show the field map when there's a usable grid — clean speckle is itself reassuring, so the
    # breeder can SEE the field whether or not structure remains (the chip carries the warn/ok signal).
    spatial = worst_env_spatial(environment, row, col, r)
  )

  list(
    residual_normality_p = if (is.finite(norm_p)) round(norm_p, 5) else NULL,
    residual_skew = if (is.finite(skew)) round(skew, 3) else NULL,
    residual_kurtosis = if (is.finite(kurt)) round(kurt, 3) else NULL,
    heteroscedasticity_p = if (is.finite(het_p)) round(het_p, 5) else NULL,
    heteroscedasticity_rho = if (is.finite(het_rho)) round(het_rho, 3) else NULL,
    spatial_residual_autocorr = if (is.finite(moran)) round(moran, 4) else NULL,
    n_resid = n,
    n_influential = length(hit),
    influential = influential,
    viz = viz,
    residual_source = source
  )
}

## Reconstruction path (one-stage fallback): build conditional residuals from BLUPs, then qc_core.
trait_model_qc <- function(genotype, environment, row, col, plot_id, value, blup_map) {
  ok <- is.finite(value)
  resid <- conditional_residuals(genotype, environment, value, blup_map)
  r <- resid[ok]
  if (length(r) < 10) return(list(n_resid = length(r), influential = list(), residual_source = "reconstructed"))
  fitted <- value[ok] - r
  qc_core(r, fitted, genotype[ok], environment[ok], row[ok], col[ok], plot_id[ok], source = "reconstructed")
}

## Real-residual path: residuals_by_trait[[tr]] = list(residual, fitted, genotype, environment, row,
## col, plot_id) — the model's OWN (spatially-adjusted) residuals, e.g. from Stage-1 SpATS.
model_qc_from_residuals <- function(residuals_by_trait) {
  out <- list()
  for (tr in names(residuals_by_trait)) {
    d <- residuals_by_trait[[tr]]
    r <- suppressWarnings(as.numeric(d$residual))
    ok <- is.finite(r) & is.finite(suppressWarnings(as.numeric(d$fitted)))
    if (sum(ok) < 10) { out[[tr]] <- list(n_resid = sum(ok), influential = list(), residual_source = "fit"); next }
    out[[tr]] <- qc_core(
      r[ok], as.numeric(d$fitted)[ok], as.character(d$genotype)[ok], as.character(d$environment)[ok],
      suppressWarnings(as.numeric(d$row))[ok], suppressWarnings(as.numeric(d$col))[ok],
      as.character(d$plot_id)[ok], source = "fit")
  }
  out
}

compute_model_qc <- function(genotype, environment, row, col, plot_id, values_by_trait, blups_by_trait) {
  out <- list()
  for (tr in names(values_by_trait)) {
    bm <- blups_by_trait[[tr]]
    blup_map <- if (is.null(bm)) stats::setNames(numeric(0), character(0)) else unlist(bm)
    out[[tr]] <- trait_model_qc(genotype, environment, row, col, plot_id, values_by_trait[[tr]], blup_map)
  }
  out
}

## ---- entrypoint -------------------------------------------------------------------------------
main <- function() {
  suppressWarnings(suppressPackageStartupMessages(library(jsonlite)))
  args <- commandArgs(trailingOnly = TRUE)
  con <- if (length(args) >= 1 && file.exists(args[1])) args[1] else "stdin"
  inp <- jsonlite::fromJSON(paste(readLines(con, warn = FALSE), collapse = "\n"), simplifyVector = TRUE)
  numv <- function(x) suppressWarnings(as.numeric(x))
  vbt <- inp$values_by_trait; if (is.data.frame(vbt)) vbt <- as.list(vbt); vbt <- lapply(vbt, numv)
  bbt <- inp$blups_by_trait
  res <- compute_model_qc(
    genotype = as.character(inp$genotype), environment = as.character(inp$environment),
    row = numv(inp$row), col = numv(inp$col), plot_id = as.character(inp$plot_id),
    values_by_trait = vbt, blups_by_trait = bbt
  )
  cat(jsonlite::toJSON(res, auto_unbox = TRUE, null = "null", na = "null", digits = NA))
}

if (!nzchar(Sys.getenv("MQ_NO_MAIN"))) main()
