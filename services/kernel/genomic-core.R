## Verdant compute kernel — shared genomic primitives (deepening, per architecture review).
##
## The VanRaden G build, pedigree-A recursion, and packed-dosage IO were copy-pasted across
## relationship.R / genomic-validate.R / genomic-analyze.R / genomic-ssgblup.R. This is the one place
## that science lives now — source() it, the same way the MET kernels source diagnostics.R/plan.R.
## Functions only.

## Read the packed Uint8 dosage matrix (sample-major; `missing` code → NA) into an n×m double matrix.
read_dosage <- function(bin, n, m, missing) {
  con <- file(bin, "rb")
  raw <- readBin(con, what = "integer", n = n * m, size = 1, signed = FALSE)
  close(con)
  M <- matrix(raw, nrow = n, ncol = m, byrow = TRUE)
  M[M == missing] <- NA_real_
  storage.mode(M) <- "double"
  M
}

## VanRaden genomic relationship matrix, scaled to mean-diagonal 1 (so the genotype variance is
## interpretable additive variance and G is on A's scale for ssGBLUP). Missing → column mean (2p).
## The pre-scaling mean diagonal is attached as attr(.,"raw_diag_mean") (the hybrid/testcross signal).
build_G <- function(M, ids) {
  p <- colMeans(M, na.rm = TRUE) / 2
  for (j in which(colSums(is.na(M)) > 0)) M[is.na(M[, j]), j] <- 2 * p[j]
  Z <- sweep(M, 2, 2 * p)
  G <- tcrossprod(Z) / (2 * sum(p * (1 - p)))
  rdm <- mean(diag(G))
  G <- G / rdm
  rownames(G) <- colnames(G) <- ids
  attr(G, "raw_diag_mean") <- rdm
  G
}

## Numerator (pedigree) relationship matrix via the vectorized recursive tabular method. `id/sire/dam`
## are parallel vectors ordered founders-before-offspring (founders have sire/dam not in id). Returns
## A over all ids, or — if `subset` is given — A restricted to those ids (in subset order).
build_A <- function(id, sire, dam, subset = NULL) {
  pid <- as.character(id); np <- length(pid); pp <- setNames(seq_len(np), pid)
  s <- ifelse(as.character(sire) %in% pid, pp[as.character(sire)], 0L)
  d <- ifelse(as.character(dam) %in% pid, pp[as.character(dam)], 0L)
  A <- matrix(0, np, np)
  for (i in seq_len(np)) {
    si <- s[i]; di <- d[i]
    if (i > 1) {
      pr <- seq_len(i - 1)
      ai <- 0.5 * ((if (si > 0) A[si, pr] else 0) + (if (di > 0) A[di, pr] else 0))
      A[i, pr] <- ai; A[pr, i] <- ai
    }
    A[i, i] <- 1 + if (si > 0 && di > 0) 0.5 * A[si, di] else 0
  }
  rownames(A) <- colnames(A) <- pid
  if (is.null(subset)) A else A[subset, subset]
}

## Locate + source this module from a sibling kernel script (call from the script's top level).
source_genomic_core <- function() invisible(NULL) # marker; scripts source this file directly
