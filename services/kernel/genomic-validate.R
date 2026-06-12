#!/usr/bin/env Rscript
## Verdant compute kernel — genomic validation: does the relationship information add value?
##
## Builds three relationship models on a COMMON cohort + COMMON folds and cross-validates predictive
## ability per trait: identity (I, no borrowing), pedigree (A), genomic (G). The fair test is
## predicting MASKED genotypes — with identity a masked line has no relatives to borrow from, so its
## CV ability is ~0; A and G borrow from relatives, so the gain over identity IS the value of the
## data, and G over A is the value of markers (Mendelian sampling within families pedigree can't see).
## Also reports the LR triad: bias (mean obs−pred) and dispersion (slope of obs on pred; ~1 = calibrated).
##
##   Rscript services/kernel/genomic-validate.R config.json > out.json
##   config = { bin, meta, pedigree:{id,sire,dam}, pheno:{names, traits:{TRAIT:[...]}}, folds, reps }
suppressWarnings(suppressPackageStartupMessages({ library(jsonlite); library(rrBLUP) }))
readJSON <- function(p) jsonlite::fromJSON(paste(readLines(p, warn = FALSE), collapse = "\n"))
.self <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)]); if (length(f)) dirname(normalizePath(f)) else "." }
source(file.path(.self, "genomic-core.R"))   # read_dosage / build_G / build_A

cfg <- readJSON(commandArgs(trailingOnly = TRUE)[1])
meta <- readJSON(cfg$meta)
ids <- meta$samples; n <- length(ids); m <- meta$nMarkers
K_FOLDS <- if (!is.null(cfg$folds)) cfg$folds else 5L
REPS <- if (!is.null(cfg$reps)) cfg$reps else 2L

## ---- relationship matrices (shared core), with a tiny ridge for stable kin.blup ---------------
G <- build_G(read_dosage(cfg$bin, n, m, meta$missing), ids) + diag(1e-4, n)
A <- build_A(cfg$pedigree$id, cfg$pedigree$sire, cfg$pedigree$dam, subset = ids) + diag(1e-4, n)
I <- diag(1, n); rownames(I) <- colnames(I) <- ids

models <- list(identity = I, pedigree_A = A, genomic_G = G)

## ---- common folds (reproducible) --------------------------------------------------------------
set.seed(1)
fold_assign <- function() sample(rep_len(seq_len(K_FOLDS), n))

## ---- k-fold CV per trait per model ------------------------------------------------------------
traits <- names(cfg$pheno$traits)
phenoIdx <- match(cfg$pheno$names, ids)
results <- list()
for (tr in traits) {
  y <- rep(NA_real_, n); yv <- as.numeric(cfg$pheno$traits[[tr]])
  ok <- !is.na(phenoIdx); y[phenoIdx[ok]] <- yv[ok]
  have <- which(!is.na(y))
  for (mn in names(models)) {
    Kc <- models[[mn]]
    preds <- rep(NA_real_, n); obs <- rep(NA_real_, n)
    for (r in seq_len(REPS)) {
      folds <- fold_assign()
      for (f in seq_len(K_FOLDS)) {
        test <- intersect(which(folds == f), have)
        if (length(test) < 2) next
        ytrain <- y; ytrain[test] <- NA
        df <- data.frame(id = ids, y = ytrain, stringsAsFactors = FALSE)
        fit <- tryCatch(rrBLUP::kin.blup(df, geno = "id", pheno = "y", K = Kc), error = function(e) NULL)
        if (is.null(fit)) next
        g <- fit$g[ids]
        preds[test] <- g[test]; obs[test] <- y[test] # last rep wins per cell (folds reshuffle)
      }
    }
    valid <- which(is.finite(preds) & is.finite(obs))
    pa <- if (length(valid) > 5 && sd(preds[valid]) > 1e-9) cor(preds[valid], obs[valid]) else 0
    bias <- if (length(valid) > 5) mean(obs[valid] - preds[valid]) else NA_real_
    disp <- if (length(valid) > 5 && sd(preds[valid]) > 1e-9) unname(coef(lm(obs[valid] ~ preds[valid]))[2]) else NA_real_
    results[[length(results) + 1]] <- list(
      trait = tr, model = mn, n_test = length(valid),
      predictive_ability = round(pa, 4), bias = round(bias, 4), dispersion = round(disp, 4))
  }
}

cat(jsonlite::toJSON(list(
  cohort_n = n, n_markers = m, folds = K_FOLDS, reps = REPS, traits = traits, results = results),
  auto_unbox = TRUE, null = "null", na = "null", digits = NA))
