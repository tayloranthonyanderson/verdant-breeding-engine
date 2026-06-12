#!/usr/bin/env Rscript
## Verdant compute kernel — single-step (H) GEBVs over ALL phenotyped lines (genotyped + un-genotyped).
##
## The point of single-step: rank lines that have NO markers by borrowing through the pedigree from
## their genotyped relatives. genomic-analyze.R emits identity/A/G GEBVs over the genotyped cohort
## only; this emits H GEBVs over the UNION (genotyped first, then un-genotyped), so the selection
## index can rank un-genotyped lines too. H = Legarra–Aguilar–Misztal blend of A and G; rrBLUP fits it.
##
##   Rscript services/kernel/genomic-h.R config.json > h.json
##   config = { bin, meta, pedigree:{id,sire,dam}, pheno:{names, traits:{TRAIT:[...]}}, genotyped:[names] }
suppressWarnings(suppressPackageStartupMessages({ library(jsonlite); library(rrBLUP) }))
readJSON <- function(p) jsonlite::fromJSON(paste(readLines(p, warn = FALSE), collapse = "\n"))
.self <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)]); if (length(f)) dirname(normalizePath(f)) else "." }
source(file.path(.self, "genomic-core.R"))   # read_dosage / build_G / build_A
cfg <- readJSON(commandArgs(trailingOnly = TRUE)[1]); meta <- readJSON(cfg$meta)

gids <- as.character(meta$samples); ng <- length(gids); m <- meta$nMarkers     # genotyped
allIds <- as.character(cfg$pheno$names)                                          # all phenotyped
ungen <- setdiff(allIds, gids)
ord <- c(gids, ungen)                                                            # genotyped block first

## G over genotyped + full pedigree A (shared core)
G <- build_G(read_dosage(cfg$bin, ng, m, meta$missing), gids)
Af <- build_A(cfg$pedigree$id, cfg$pedigree$sire, cfg$pedigree$dam)
A <- Af[ord, ord]
g2 <- seq_along(gids); u1 <- if (length(ungen)) (ng + 1):length(ord) else integer(0)
A22i <- solve(A[g2, g2] + diag(1e-5, ng))
## H (Legarra et al.): genomic block = G; un-genotyped borrow through pedigree
H <- A
H[g2, g2] <- G
if (length(ungen)) {
  H[u1, g2] <- A[u1, g2] %*% A22i %*% G
  H[g2, u1] <- t(H[u1, g2])
  H[u1, u1] <- A[u1, u1] + A[u1, g2] %*% A22i %*% (G - A[g2, g2]) %*% A22i %*% A[g2, u1]
}
H <- H + diag(1e-4, nrow(H)); rownames(H) <- colnames(H) <- ord

## per-trait H GEBVs over the full ordered cohort
traits <- names(cfg$pheno$traits)
gebv <- list()
for (tr in traits) {
  y <- rep(NA_real_, length(ord)); yv <- as.numeric(cfg$pheno$traits[[tr]])
  y[match(allIds, ord)] <- yv
  fit <- tryCatch(rrBLUP::kin.blup(data.frame(id = ord, y = y), geno = "id", pheno = "y", K = H), error = function(e) NULL)
  vals <- if (is.null(fit)) rep(NA_real_, length(ord)) else round(unname(fit$g[ord]), 5)
  gebv[[tr]] <- list(values = vals, Vg = if (is.null(fit)) NA_real_ else round(fit$Vg, 5), Ve = if (is.null(fit)) NA_real_ else round(fit$Ve, 5))
}

cat(jsonlite::toJSON(list(
  cohort = ord, n_genotyped = ng, n_ungenotyped = length(ungen), gebv = gebv,
  note = "Single-step H GEBVs; un-genotyped lines ranked via the pedigree link to genotyped relatives."),
  auto_unbox = TRUE, null = "null", na = "null", digits = NA))
