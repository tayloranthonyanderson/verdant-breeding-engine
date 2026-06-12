#!/usr/bin/env Rscript
## Verdant compute kernel — Stage 1 of the two-stage MET (ADR-0014, ADR-0015).
##
## Removes WITHIN-environment field trend before the cross-environment genetic analysis. For each
## environment × trait it fits a spatial model with genotype as a FIXED effect → spatially-adjusted
## entry means (BLUEs) plus their standard errors. Genotype is fixed (not random) on purpose: Stage 2
## (BLUPF90) shrinks toward the genetic covariance, so shrinking here too would double-shrink.
##
## Crop-agnostic: input is the generic plot record from ADR-0015 — {environment, genotype, row, col,
## rep, values[]} — with NO dataset column names. The ingestion adapter does the mapping.
##
##   Rscript services/kernel/stage1-spatial.R < stage1-input.json > stage1-output.json
##
## Input  (JSON, parallel vectors + an N×K values matrix):
##   { variableIds:[K], environment:[N], genotype:[N], row:[N], col:[N], rep:[N], values:[[N×K]] }
## Output (JSON):
##   { adjusted:[ {environment, genotype, values:[K], weights:[K]} ],   # NA where a trait was unfit
##     stage1:[ {environment, variable_id, method, n_obs, n_geno} ] }   # per env×trait provenance
suppressWarnings(suppressPackageStartupMessages({
  library(jsonlite)
}))

read_input <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  con <- if (length(args) >= 1 && file.exists(args[1])) args[1] else "stdin"
  jsonlite::fromJSON(paste(readLines(con, warn = FALSE), collapse = "\n"), simplifyVector = TRUE)
}

## Spatially-adjusted entry means for ONE environment × ONE trait.
## Returns data.frame(genotype, blue, se) + the method actually used.
adjust_one <- function(d) {
  d <- d[is.finite(d$value), , drop = FALSE]
  if (nrow(d) < 3 || length(unique(d$genotype)) < 2)
    return(list(est = NULL, method = "skipped"))
  d$germplasm <- factor(d$genotype)
  has_rep <- length(unique(d$rep[!is.na(d$rep)])) > 1
  n_row <- length(unique(d$row[!is.na(d$row)]))
  n_col <- length(unique(d$col[!is.na(d$col)]))
  has_grid <- !anyNA(d$row) && !anyNA(d$col) && n_row >= 5 && n_col >= 5 && nrow(d) >= 50

  if (has_grid && requireNamespace("SpATS", quietly = TRUE)) {
    est <- tryCatch(spats_blue(d, has_rep), error = function(e) NULL)
    if (!is.null(est)) return(list(est = est, method = "spats"))
  }
  list(est = means_blue(d, has_rep), method = if (has_rep) "lsmeans" else "means")
}

## SpATS 2D P-spline, genotype FIXED → BLUEs + SE (mirrors analyze.R::fit_spats conventions).
spats_blue <- function(d, has_rep) {
  d$R <- as.numeric(d$row); d$C <- as.numeric(d$col)
  nseg <- c(min(20L, length(unique(d$C))), min(20L, length(unique(d$R))))
  fixed <- NULL
  if (has_rep) { d$rep <- factor(d$rep); fixed <- stats::as.formula("~ rep") }
  fit <- SpATS::SpATS(
    response = "value", genotype = "germplasm", genotype.as.random = FALSE,
    spatial = ~ SpATS::PSANOVA(C, R, nseg = nseg), fixed = fixed, data = d,
    control = list(monitoring = 0, maxit = 100)
  )
  pred <- predict(fit, which = "germplasm")
  data.frame(genotype = as.character(pred$germplasm),
             blue = pred$predicted.values, se = pred$standard.errors,
             stringsAsFactors = FALSE)
}

## Fallback when there is no usable grid: least-squares entry means (genotype fixed, + rep block if
## replicated) via lm, else raw genotype means. SE from the fit; raw means get SE = sd/sqrt(n).
means_blue <- function(d, has_rep) {
  if (has_rep) {
    d$rep <- factor(d$rep)
    m <- tryCatch(stats::lm(value ~ 0 + germplasm + rep, data = d), error = function(e) NULL)
    if (!is.null(m)) {
      co <- summary(m)$coefficients
      gi <- grep("^germplasm", rownames(co))
      if (length(gi)) return(data.frame(
        genotype = sub("^germplasm", "", rownames(co)[gi]),
        blue = co[gi, 1], se = co[gi, 2], stringsAsFactors = FALSE))
    }
  }
  ag <- stats::aggregate(value ~ germplasm, data = d,
    FUN = function(v) c(mean = mean(v), se = if (length(v) > 1) stats::sd(v) / sqrt(length(v)) else NA_real_))
  data.frame(genotype = as.character(ag$germplasm),
             blue = ag$value[, "mean"], se = ag$value[, "se"], stringsAsFactors = FALSE)
}

main <- function() {
  inp <- read_input()
  vids <- as.character(inp$variableIds)
  K <- length(vids)
  V <- inp$values; if (is.null(dim(V))) V <- matrix(V, ncol = K)  # guard N=1
  base <- data.frame(
    environment = as.character(inp$environment),
    genotype = as.character(inp$genotype),
    row = suppressWarnings(as.numeric(inp$row)),
    col = suppressWarnings(as.numeric(inp$col)),
    rep = if (!is.null(inp$rep)) inp$rep else NA,
    stringsAsFactors = FALSE
  )
  envs <- sort(unique(base$environment))

  adjusted <- list(); prov <- list()
  for (e in envs) {
    ix <- base$environment == e
    de <- base[ix, , drop = FALSE]
    Ve <- V[ix, , drop = FALSE]
    genos <- sort(unique(de$genotype))
    valM <- matrix(NA_real_, length(genos), K, dimnames = list(genos, NULL))
    wtM  <- matrix(NA_real_, length(genos), K, dimnames = list(genos, NULL))
    for (k in seq_len(K)) {
      dk <- data.frame(genotype = de$genotype, row = de$row, col = de$col,
                       rep = de$rep, value = Ve[, k], stringsAsFactors = FALSE)
      out <- adjust_one(dk)
      prov[[length(prov) + 1]] <- list(environment = e, variable_id = vids[k],
        method = out$method, n_obs = sum(is.finite(dk$value)),
        n_geno = length(unique(dk$genotype[is.finite(dk$value)])))
      if (is.null(out$est)) next
      mi <- match(out$est$genotype, genos)
      ok <- !is.na(mi)
      valM[mi[ok], k] <- out$est$blue[ok]
      se <- out$est$se[ok]
      wtM[mi[ok], k] <- ifelse(is.finite(se) & se > 0, 1 / se^2, NA_real_)
    }
    for (gi in seq_along(genos)) {
      if (all(is.na(valM[gi, ]))) next  # genotype unfit for every trait in this env
      adjusted[[length(adjusted) + 1]] <- list(
        environment = e, genotype = genos[gi],
        values = unname(valM[gi, ]), weights = unname(wtM[gi, ]))
    }
  }

  cat(jsonlite::toJSON(list(adjusted = adjusted, stage1 = prov),
                       auto_unbox = TRUE, null = "null", na = "null", digits = NA))
}

main()
