#!/usr/bin/env Rscript
## Verdant compute kernel — genomic relationship matrix (G) + rrBLUP GBLUP.
##
## Reads a cohort dosage matrix (exported by grm.ts as a Uint8 binary + JSON sidecar), builds the
## VanRaden genomic relationship matrix G, sanity-checks it, and — if phenotypes are supplied — fits
## a single-trait GBLUP via rrBLUP (the fast cross-validation engine; BLUPF90/preGSf90 does the
## multi-trait + full-scale path). Crop-agnostic: dosages + ids in, G + GEBVs out.
##
##   Rscript services/kernel/relationship.R config.json > out.json
##   config.json = { bin, meta, pheno?: {names:[], y:[]} }
suppressWarnings(suppressPackageStartupMessages({
  library(jsonlite)
  library(rrBLUP)
}))

readJSON <- function(path) jsonlite::fromJSON(paste(readLines(path, warn = FALSE), collapse = "\n"))
cfg <- readJSON(commandArgs(trailingOnly = TRUE)[1])
meta <- readJSON(cfg$meta)
n <- meta$nSamples; m <- meta$nMarkers

## dosage matrix (sample-major Uint8; 255 = missing → NA)
con <- file(cfg$bin, "rb")
raw <- readBin(con, what = "integer", n = n * m, size = 1, signed = FALSE)
close(con)
M <- matrix(raw, nrow = n, ncol = m, byrow = TRUE)
M[M == meta$missing] <- NA_integer_
storage.mode(M) <- "double"

## VanRaden G: p = allele freq; Z = centered dosages (missing → column mean); G = ZZ' / 2Σp(1-p)
p <- colMeans(M, na.rm = TRUE) / 2
for (j in which(colSums(is.na(M)) > 0)) M[is.na(M[, j]), j] <- 2 * p[j]
Z <- sweep(M, 2, 2 * p)
denom <- 2 * sum(p * (1 - p))
G <- tcrossprod(Z) / denom
## Scale to mean-diagonal 1 so the genotype variance component is interpretable as additive genetic
## variance (and so G is on A's scale for ssGBLUP). Record the raw mean diagonal — for a hybrid
## testcross panel it runs < 1 (excess heterozygosity / shared tester), a real structural signal.
raw_diag_mean <- mean(diag(G))
G <- G / raw_diag_mean
rownames(G) <- colnames(G) <- meta$samples

## sanity diagnostics
ev <- eigen(G, symmetric = TRUE, only.values = TRUE)$values
offdiag <- G[lower.tri(G)]
diag_g <- diag(G)
sanity <- list(
  n = n, n_markers = m,
  raw_diag_mean = round(raw_diag_mean, 4),               # pre-scaling self-relationship (hybrid signal)
  diag_mean = round(mean(diag_g), 4), diag_min = round(min(diag_g), 4), diag_max = round(max(diag_g), 4),
  offdiag_mean = round(mean(offdiag), 4), offdiag_sd = round(sd(offdiag), 4),
  min_eigenvalue = round(min(ev), 6),                    # PD check (≥ 0 up to numeric noise)
  is_pd = min(ev) > -1e-6,
  condition_number = round(max(ev) / max(min(ev[ev > 1e-10]), 1e-10), 1),
  rank = sum(ev > 1e-8)
)

out <- list(samples = meta$samples, sanity = sanity)

## rrBLUP GBLUP if phenotypes supplied (NA-tolerant: predicts unphenotyped genotypes from G)
if (!is.null(cfg$pheno)) {
  y <- rep(NA_real_, n)
  idx <- match(cfg$pheno$names, meta$samples)
  ok <- !is.na(idx)
  y[idx[ok]] <- as.numeric(cfg$pheno$y)[ok]
  df <- data.frame(id = meta$samples, y = y, stringsAsFactors = FALSE)
  fit <- rrBLUP::kin.blup(data = df, geno = "id", pheno = "y", K = G)
  Vg <- fit$Vg; Ve <- fit$Ve
  out$gblup <- list(
    engine = "rrBLUP::kin.blup", n_trained = sum(!is.na(y)),
    Vg = round(Vg, 5), Ve = round(Ve, 5),
    h2_genomic = round(Vg / (Vg + Ve), 4),
    gebv = lapply(meta$samples, function(s) list(id = s, gebv = round(unname(fit$g[s]), 5)))
  )
}

cat(jsonlite::toJSON(out, auto_unbox = TRUE, null = "null", na = "null", digits = NA))
