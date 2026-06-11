## selection_index.R — combine per-trait genotype values into one ranked index.
##
## Standardize each trait's BLUP/BLUE across genotypes (z-score), flip by
## direction (+1 higher-better / -1 lower-better), weight, and sum. Simple,
## transparent, and the daily decision a breeder actually wants.

#' @param effects_list named list: trait -> data.frame(genotype, value, ...)
#' @param weights     named numeric: trait -> relative weight (>=0)
#' @param directions  named numeric: trait -> +1 (higher better) or -1 (lower)
#' @return data.frame ordered by index desc: genotype, index, rank, <trait values>
#' @export
build_selection_index <- function(effects_list, weights, directions) {
  traits <- names(effects_list)
  genos  <- sort(Reduce(union, lapply(effects_list, function(x) x$genotype)))

  mat <- sapply(traits, function(tr) {
    df <- effects_list[[tr]]
    df$value[match(genos, df$genotype)]
  })
  if (is.null(dim(mat))) mat <- matrix(mat, ncol = length(traits), dimnames = list(genos, traits))
  rownames(mat) <- genos

  z <- scale(mat)                       # standardize per trait
  z[is.na(z)] <- 0                      # genotypes missing a trait contribute 0
  w <- (weights[traits]) * (directions[traits])
  w[is.na(w)] <- 0
  index <- as.numeric(z %*% w)

  out <- data.frame(genotype = genos, index = round(index, 3),
                    round(as.data.frame(mat), 3), check.names = FALSE,
                    stringsAsFactors = FALSE)
  out <- out[order(-out$index), , drop = FALSE]
  out <- cbind(rank = seq_len(nrow(out)), out)
  rownames(out) <- NULL
  out
}
