#!/usr/bin/env Rscript
## Verdant compute kernel — genomic analysis for the bundle (UI-ready).
##
## Builds G (genomic) + A (pedigree), cross-validates predictive ability (identity/A/G per trait),
## and produces everything the GUI renders: population-structure PCA, GEBVs + per-genotype
## reliability, a clustered + down-sampled covariance heatmap, and the relationship distribution.
## rrBLUP is the engine; numbers feed the relationship workspace / diagnostics / teaching panels.
##
##   Rscript services/kernel/genomic-analyze.R config.json > genomic.json
##   config = { bin, meta, pedigree:{id,sire,dam}, pheno:{names, traits:{TRAIT:[...]}},
##             folds, reps, heatmap_n }
suppressWarnings(suppressPackageStartupMessages({ library(jsonlite); library(rrBLUP) }))
readJSON <- function(p) jsonlite::fromJSON(paste(readLines(p, warn = FALSE), collapse = "\n"))

cfg <- readJSON(commandArgs(trailingOnly = TRUE)[1])
meta <- readJSON(cfg$meta)
ids <- meta$samples; n <- length(ids); m <- meta$nMarkers
K_FOLDS <- if (!is.null(cfg$folds)) cfg$folds else 5L
REPS <- if (!is.null(cfg$reps)) cfg$reps else 2L
HEAT_N <- if (!is.null(cfg$heatmap_n)) cfg$heatmap_n else 100L

## ---- G (VanRaden, mean-diag 1) ----------------------------------------------------------------
con <- file(cfg$bin, "rb"); raw <- readBin(con, "integer", n * m, size = 1, signed = FALSE); close(con)
M <- matrix(raw, n, m, byrow = TRUE); M[M == meta$missing] <- NA_real_; storage.mode(M) <- "double"
p <- colMeans(M, na.rm = TRUE) / 2
for (j in which(colSums(is.na(M)) > 0)) M[is.na(M[, j]), j] <- 2 * p[j]
Z <- sweep(M, 2, 2 * p); G <- tcrossprod(Z) / (2 * sum(p * (1 - p)))
raw_diag_mean <- mean(diag(G)); G <- G / raw_diag_mean
rownames(G) <- colnames(G) <- ids
Gr <- G + diag(1e-4, n)

## ---- A (pedigree) -----------------------------------------------------------------------------
ped <- cfg$pedigree; pid <- as.character(ped$id); np <- length(pid); ppos <- setNames(seq_len(np), pid)
sire <- ifelse(as.character(ped$sire) %in% pid, ppos[as.character(ped$sire)], 0L)
dam <- ifelse(as.character(ped$dam) %in% pid, ppos[as.character(ped$dam)], 0L)
Af <- matrix(0, np, np)
for (i in seq_len(np)) {
  si <- sire[i]; di <- dam[i]
  if (i > 1) { pr <- seq_len(i - 1)
    ai <- 0.5 * ((if (si > 0) Af[si, pr] else 0) + (if (di > 0) Af[di, pr] else 0))
    Af[i, pr] <- ai; Af[pr, i] <- ai }
  Af[i, i] <- 1 + if (si > 0 && di > 0) 0.5 * Af[si, di] else 0
}
rownames(Af) <- colnames(Af) <- pid
A <- Af[ids, ids] + diag(1e-4, n)
I <- diag(1, n); rownames(I) <- colnames(I) <- ids
models <- list(identity = I, pedigree_A = A, genomic_G = Gr)

## ---- k-fold CV: predictive ability + dispersion per trait per model ---------------------------
traits <- names(cfg$pheno$traits); phenoIdx <- match(cfg$pheno$names, ids)
set.seed(1); folds_of <- function() sample(rep_len(seq_len(K_FOLDS), n))
comparison <- list()
yByTrait <- list()
for (tr in traits) {
  y <- rep(NA_real_, n); yv <- as.numeric(cfg$pheno$traits[[tr]]); ok <- !is.na(phenoIdx)
  y[phenoIdx[ok]] <- yv[ok]; have <- which(!is.na(y)); yByTrait[[tr]] <- y
  for (mn in names(models)) {
    Kc <- models[[mn]]; preds <- obs <- rep(NA_real_, n)
    for (r in seq_len(REPS)) { fo <- folds_of()
      for (f in seq_len(K_FOLDS)) { test <- intersect(which(fo == f), have); if (length(test) < 2) next
        yt <- y; yt[test] <- NA
        fit <- tryCatch(rrBLUP::kin.blup(data.frame(id = ids, y = yt), geno = "id", pheno = "y", K = Kc), error = function(e) NULL)
        if (is.null(fit)) next
        g <- fit$g[ids]; preds[test] <- g[test]; obs[test] <- y[test] } }
    v <- which(is.finite(preds) & is.finite(obs))
    pa <- if (length(v) > 5 && sd(preds[v]) > 1e-9) cor(preds[v], obs[v]) else 0
    disp <- if (length(v) > 5 && sd(preds[v]) > 1e-9) unname(coef(lm(obs[v] ~ preds[v]))[2]) else NA_real_
    comparison[[length(comparison) + 1]] <- list(trait = tr, model = mn,
      predictive_ability = round(pa, 4), dispersion = round(disp, 4), n_test = length(v))
  }
}

## ---- GEBVs + reliability on the FULL data (genomic model) -------------------------------------
## reliability_i = 1 - PEV_i/(G_ii * Vg); PEV = diag( (Z'Z/Ve + Ginv/Vg)^-1 ), one record per genotype.
Ginv <- solve(Gr)
gebv <- list()
for (tr in traits) {
  y <- yByTrait[[tr]]; have <- !is.na(y)
  fit <- rrBLUP::kin.blup(data.frame(id = ids, y = y), geno = "id", pheno = "y", K = Gr)
  Vg <- fit$Vg; Ve <- fit$Ve
  C <- solve(diag(as.numeric(have) / Ve, n) + Ginv / Vg)
  pev <- diag(C); rel <- pmax(0, pmin(1, 1 - pev / (diag(Gr) * Vg)))
  gebv[[tr]] <- list(values = round(unname(fit$g[ids]), 5), reliability = round(rel, 4), Vg = round(Vg, 5), Ve = round(Ve, 5))
}

## ---- population-structure PCA of G ------------------------------------------------------------
e <- eigen(G, symmetric = TRUE)
ve <- e$values / sum(abs(e$values))
pcs <- e$vectors[, 1:3] %*% diag(sqrt(pmax(e$values[1:3], 0)))
## family label = the non-tester parent prefix (for coloring): use sire of each hybrid
sireName <- as.character(ped$sire)[match(ids, pid)]
pca <- list(
  var_explained = round(ve[1:6], 4),
  coords = lapply(seq_len(n), function(i) list(id = ids[i], pc1 = round(pcs[i, 1], 3), pc2 = round(pcs[i, 2], 3), pc3 = round(pcs[i, 3], 3), family = sireName[i]))
)

## ---- clustered + down-sampled covariance heatmap ---------------------------------------------
ho <- hclust(as.dist(1 - G), method = "average")$order      # cluster so family blocks line up
pick <- ho[round(seq(1, n, length.out = min(HEAT_N, n)))]    # evenly sample the clustered order
Hs <- G[pick, pick]
heatmap <- list(ids = ids[pick], values = lapply(seq_len(nrow(Hs)), function(i) round(unname(Hs[i, ]), 3)))

## ---- relationship distribution ----------------------------------------------------------------
off <- G[lower.tri(G)]; dg <- diag(G)
hist_of <- function(x, lo, hi, k = 40) { br <- seq(lo, hi, length.out = k + 1); h <- hist(pmax(lo, pmin(hi, x)), breaks = br, plot = FALSE)
  list(breaks = round(br, 3), counts = h$counts) }
distribution <- list(offdiag = hist_of(off, -0.5, 1.0), diag = hist_of(dg, 0, 2.5))

cat(jsonlite::toJSON(list(
  cohort_n = n, n_markers = m, cohort = ids,   # gebv[trait].values / .reliability align to this order
  sanity = list(raw_diag_mean = round(raw_diag_mean, 4), diag_mean = round(mean(dg), 3),
    offdiag_mean = round(mean(off), 4), offdiag_sd = round(sd(off), 4),
    min_eigenvalue = round(min(e$values), 6), is_pd = min(e$values) > -1e-6, rank = sum(e$values > 1e-8)),
  model_comparison = comparison, gebv = gebv, pca = pca, heatmap = heatmap, distribution = distribution),
  auto_unbox = TRUE, null = "null", na = "null", digits = NA))
