## analyze.R — run the full analysis for a trial and assemble a result "bundle".
## This is the main entry the API calls. The bundle is the single object the
## frontend renders and the AI assistant queries (via ai_ops.R).

#' Analyze a trial: fit each trait and build the selection index.
#'
#' @param data long-format data.frame (one row per plot).
#' @param traits character vector of trait columns to analyze.
#' @param genotype,env,block column names.
#' @param genotype_effect "random" (BLUPs) or "fixed" (BLUEs).
#' @param engine "lme4" or "rrblup".
#' @param weights,directions named numeric per trait (default 1 / +1).
#' @return a bundle list: traits, effects (named list), heritability (named
#'   numeric), varcomp, engine, warnings, index (selection ranking).
#' @export
analyze_trial <- function(data, traits,
                          genotype = "genotype", env = "env", block = "block",
                          genotype_effect = "random", engine = "lme4",
                          weights = NULL, directions = NULL) {
  stopifnot(length(traits) >= 1)
  fits <- lapply(traits, function(t)
    fit_genotype_values(data, t, genotype = genotype, env = env, block = block,
                        genotype_effect = genotype_effect, engine = engine))
  names(fits) <- traits

  effects <- lapply(fits, function(f) f$effects)
  herit <- vapply(fits, function(f) as.numeric(f$heritability)[1], numeric(1))
  names(herit) <- traits

  if (is.null(weights))    { weights    <- stats::setNames(rep(1, length(traits)), traits) }
  if (is.null(directions)) { directions <- stats::setNames(rep(1, length(traits)), traits) }

  index <- build_selection_index(effects, weights, directions)

  list(
    traits       = traits,
    effects      = effects,
    heritability = as.list(herit),   # named list -> JSON object {trait: h2}
    varcomp      = lapply(fits, function(f) f$varcomp),
    engine       = fits[[1]]$engine,
    warnings     = unlist(lapply(fits, function(f) f$warnings), use.names = FALSE),
    index        = index
  )
}
