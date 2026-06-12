#!/usr/bin/env Rscript
## Verdant compute kernel — single-step GBLUP (ssGBLUP) demonstration.
##
## The value of single-step is predicting UN-genotyped individuals: it blends the pedigree (A) and
## genomic (G) relationships into H, so a line with no markers borrows strength from its genotyped
## relatives. We test exactly that — the MET hybrids that have a phenotype but NO genotype: under G
## they cannot be predicted at all; under H they can. Compares H vs pedigree-only (A) predictive
## ability for the un-genotyped lines (Legarra–Aguilar–Misztal H).
##
##   Rscript services/kernel/genomic-ssgblup.R config.json > out.json
##   config = { bin, meta, pedigree:{id,sire,dam}, pheno:{names, y}, genotyped:[names] }
suppressWarnings(suppressPackageStartupMessages({ library(jsonlite); library(rrBLUP) }))
readJSON <- function(p) jsonlite::fromJSON(paste(readLines(p, warn = FALSE), collapse = "\n"))
.self <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)]); if (length(f)) dirname(normalizePath(f)) else "." }
source(file.path(.self, "genomic-core.R"))   # read_dosage / build_G / build_A
cfg <- readJSON(commandArgs(trailingOnly = TRUE)[1]); meta <- readJSON(cfg$meta)

gids <- meta$samples; ng <- length(gids); m <- meta$nMarkers      # genotyped
allIds <- as.character(cfg$pheno$names)                            # all phenotyped hybrids
ungen <- setdiff(allIds, gids)

## G over genotyped + full pedigree A (shared core)
G <- build_G(read_dosage(cfg$bin, ng, m, meta$missing), gids)
Af <- build_A(cfg$pedigree$id, cfg$pedigree$sire, cfg$pedigree$dam)

ord <- c(gids, ungen)                                # genotyped block first
A <- Af[ord, ord]
g2 <- seq_along(gids); u1 <- (ng + 1):length(ord)    # index blocks
A22 <- A[g2, g2]; A22i <- solve(A22 + diag(1e-5, ng))
## H (Legarra et al.): genomic block = G; un-genotyped borrows through pedigree
H <- A
H[g2, g2] <- G
H[u1, g2] <- A[u1, g2] %*% A22i %*% G
H[g2, u1] <- t(H[u1, g2])
H[u1, u1] <- A[u1, u1] + A[u1, g2] %*% A22i %*% (G - A22) %*% A22i %*% A[g2, u1]
H <- H + diag(1e-4, nrow(H)); rownames(H) <- colnames(H) <- ord

## phenotype aligned to ord
y <- rep(NA_real_, length(ord)); yi <- match(allIds, ord); y[yi] <- as.numeric(cfg$pheno$y)

## predictive ability for the UN-genotyped lines, H vs A: mask each un-genotyped phenotype, predict
pred_un <- function(K) {
  pr <- rep(NA_real_, length(ungen))
  for (k in seq_along(ungen)) {
    yt <- y; yt[match(ungen[k], ord)] <- NA
    fit <- tryCatch(rrBLUP::kin.blup(data.frame(id = ord, y = yt), geno = "id", pheno = "y", K = K), error = function(e) NULL)
    if (!is.null(fit)) pr[k] <- fit$g[ungen[k]]
  }
  obs <- y[match(ungen, ord)]; v <- is.finite(pr) & is.finite(obs)
  list(n = sum(v), pa = if (sum(v) > 5) round(cor(pr[v], obs[v]), 4) else NA_real_)
}
hH <- pred_un(H); hA <- pred_un(A)

cat(jsonlite::toJSON(list(
  n_genotyped = ng, n_ungenotyped = length(ungen),
  ungenotyped_predictive_ability = list(single_step_H = hH$pa, pedigree_A = hA$pa, n_test = hH$n),
  note = "Predictive ability for hybrids that have NO markers; genomic-only (G) cannot predict them at all."),
  auto_unbox = TRUE, null = "null", na = "null", digits = NA))
