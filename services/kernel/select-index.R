#!/usr/bin/env Rscript
## Genetically-aware selection index (ADR-0006), computed in R (science layer, ADR-0002).
## Desired-gains (Pesek–Baker): given desired genetic gains d (in genetic-sd units), the index
## weights are b = G^{-1} d_raw (d_raw = d * sqrt(diag(G))), so selecting on I = b' ĝ delivers gains
## in the proportions d while accounting for how the traits co-inherit (G). Its DIVERGENCE from the
## transparent index — which ignores G — is the first-class insight.
##
##   Rscript select-index.R < input.json > output.json
suppressWarnings(suppressPackageStartupMessages(library(jsonlite)))

inp <- fromJSON(paste(readLines("stdin", warn = FALSE), collapse = "\n"), simplifyVector = TRUE)
vids <- inp$variable_ids
n <- length(vids)
# jsonlite already simplifies nested JSON arrays to matrices; only rebuild from a list/df.
asMatrix <- function(x, ncols) {
  if (is.matrix(x)) { storage.mode(x) <- "double"; return(x) }
  if (is.data.frame(x)) return(as.matrix(x))
  matrix(as.numeric(unlist(x)), ncol = ncols, byrow = TRUE)
}
G <- asMatrix(inp$genetic_covariance, n)
gid <- inp$germplasm_ids
V <- asMatrix(inp$blups, n)   # n_geno x n_trait
V[is.na(V)] <- 0

## desired gains in genetic-sd units -> raw trait units -> index weights
d_sd <- as.numeric(inp$desired_gains)
sigma <- sqrt(diag(G))
b <- solve(G, d_sd * sigma)

score <- as.numeric(V %*% b)
g_rank <- rank(-score, ties.method = "first")
ord <- order(-score)

ranking <- lapply(seq_along(ord), function(i) {
  k <- ord[i]
  list(germplasm_id = gid[k], rank = i, score = round(score[k], 5),
       gated_out = FALSE, gate_failures = character(0))
})
## weights_used carries the DESIRED GAINS d (genetic-sd units) — the slider seed. The client derives
## b = G^{-1}(d·σ) live from G (reconstructed from the bundle's correlation + genetic_sd) and
## reproduces this ranking, so the desired-gain sliders recompute client-side like the transparent ones.
weights_used <- lapply(seq_len(n), function(i)
  list(variable_id = vids[i], direction = if (d_sd[i] < 0) -1L else 1L, weight = round(d_sd[i], 6)))

## divergence vs the transparent ranking
tr <- inp$transparent_ranking          # data.frame germplasm_id, rank
t_rank <- tr$rank[match(gid, tr$germplasm_id)]
ok <- is.finite(t_rank)
rho <- suppressWarnings(cor(g_rank[ok], t_rank[ok], method = "spearman"))
delta <- t_rank - g_rank               # +ve = the genetic index ranks it BETTER than transparent
movers_ix <- order(-abs(delta))[seq_len(min(8, sum(ok)))]
movers <- lapply(movers_ix, function(k)
  list(germplasm_id = gid[k], rank_delta = as.integer(delta[k])))

out <- list(
  index = list(kind = "desired_gains", segment_id = "g2f-met-2019",
               ranking = ranking, weights_used = weights_used),
  divergence = list(compared = c("weighted", "desired_gains"),
                    rank_correlation = round(rho, 4), notable_movers = movers)
)
cat(toJSON(out, auto_unbox = TRUE, digits = NA, null = "null"))
