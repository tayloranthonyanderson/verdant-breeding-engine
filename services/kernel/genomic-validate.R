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

cfg <- readJSON(commandArgs(trailingOnly = TRUE)[1])
meta <- readJSON(cfg$meta)
ids <- meta$samples; n <- length(ids); m <- meta$nMarkers
K_FOLDS <- if (!is.null(cfg$folds)) cfg$folds else 5L
REPS <- if (!is.null(cfg$reps)) cfg$reps else 2L

## ---- G (genomic, VanRaden scaled to mean-diag 1) ----------------------------------------------
con <- file(cfg$bin, "rb"); raw <- readBin(con, "integer", n * m, size = 1, signed = FALSE); close(con)
M <- matrix(raw, n, m, byrow = TRUE); M[M == meta$missing] <- NA_real_; storage.mode(M) <- "double"
p <- colMeans(M, na.rm = TRUE) / 2
for (j in which(colSums(is.na(M)) > 0)) M[is.na(M[, j]), j] <- 2 * p[j]
Z <- sweep(M, 2, 2 * p); G <- tcrossprod(Z) / (2 * sum(p * (1 - p)))
G <- G / mean(diag(G)); rownames(G) <- colnames(G) <- ids
G <- G + diag(1e-4, n) # tiny ridge → invertible / stable kin.blup

## ---- A (pedigree numerator relationship; founders first, vectorized recursion) ----------------
ped <- cfg$pedigree
pid <- as.character(ped$id); np <- length(pid); ppos <- setNames(seq_len(np), pid)
sire <- ifelse(as.character(ped$sire) %in% pid, ppos[as.character(ped$sire)], 0L)
dam <- ifelse(as.character(ped$dam) %in% pid, ppos[as.character(ped$dam)], 0L)
Afull <- matrix(0, np, np)
for (i in seq_len(np)) {
  si <- sire[i]; di <- dam[i]
  if (i > 1) {
    prev <- seq_len(i - 1)
    ai <- 0.5 * ((if (si > 0) Afull[si, prev] else 0) + (if (di > 0) Afull[di, prev] else 0))
    Afull[i, prev] <- ai; Afull[prev, i] <- ai
  }
  Afull[i, i] <- 1 + if (si > 0 && di > 0) 0.5 * Afull[si, di] else 0
}
rownames(Afull) <- colnames(Afull) <- pid
A <- Afull[ids, ids] + diag(1e-4, n) # subset to cohort + ridge
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
