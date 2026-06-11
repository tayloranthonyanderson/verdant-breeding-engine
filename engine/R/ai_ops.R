## ai_ops.R — deterministic, tool-safe operations over an analysis bundle.
##
## These are the ONLY operations the embedded AI assistant may invoke. Each
## takes a bundle (from analyze_trial) plus simple args and returns plain data
## (lists / data.frames) that serialize to JSON. Nothing here computes new
## statistics or fabricates values — every number traces back to the engine.

#' Summarize an analysis bundle.
#' @export
op_summarize <- function(bundle) {
  n_geno <- if (!is.null(bundle$index)) nrow(bundle$index)
            else length(unique(bundle$effects[[1]]$genotype))
  list(
    n_traits     = length(bundle$traits),
    traits       = bundle$traits,
    n_genotypes  = n_geno,
    heritability = as.list(round(unlist(bundle$heritability), 3)),
    engine       = bundle$engine
  )
}

#' Top genotypes by a single trait's estimated value (BLUP/BLUE).
#' @export
op_rank_by_trait <- function(bundle, trait, n = 10) {
  if (!trait %in% names(bundle$effects))
    stop("Unknown trait '", trait, "'. Available: ", paste(bundle$traits, collapse = ", "))
  df <- bundle$effects[[trait]]
  df <- df[order(-df$value), c("genotype", "value"), drop = FALSE]
  utils::head(df, n)
}

#' Top genotypes by the overall selection index.
#' @export
op_top_selections <- function(bundle, n = 10) {
  if (is.null(bundle$index)) stop("No selection index in this analysis.")
  utils::head(bundle$index, n)
}

#' Compare specific genotypes across all traits + index.
#' @export
op_compare_genotypes <- function(bundle, genotypes) {
  if (is.null(bundle$index)) stop("No selection index available.")
  sub <- bundle$index[bundle$index$genotype %in% genotypes, , drop = FALSE]
  if (nrow(sub) == 0)
    stop("None of those genotypes were found: ", paste(genotypes, collapse = ", "))
  sub
}

#' Describe how the model and index were produced (for explanations).
#' @export
op_describe_model <- function(bundle) {
  list(
    engine       = bundle$engine,
    traits       = bundle$traits,
    heritability = as.list(round(unlist(bundle$heritability), 3)),
    note = paste("Per-genotype values are BLUPs/BLUEs from a linear mixed model;",
                 "the selection index is a weighted sum of standardized BLUPs,",
                 "signed by each trait's higher/lower-is-better direction.")
  )
}

#' The toolbox manifest the API exposes to Claude as tool definitions.
#' @export
ai_tool_manifest <- function() {
  list(
    list(name = "summarize", description = "Overview: traits, genotype count, heritabilities, engine.",
         params = list()),
    list(name = "rank_by_trait", description = "Top genotypes by one trait's BLUP/BLUE.",
         params = list(trait = "trait name", n = "how many (default 10)")),
    list(name = "top_selections", description = "Top genotypes by the overall selection index.",
         params = list(n = "how many (default 10)")),
    list(name = "compare_genotypes", description = "Compare named genotypes across all traits.",
         params = list(genotypes = "vector of genotype names")),
    list(name = "describe_model", description = "Explain how the model and index were computed.",
         params = list())
  )
}

#' Dispatch a validated tool call from the assistant to the right op.
#' @export
ai_dispatch <- function(bundle, tool, args = list()) {
  switch(tool,
    summarize         = op_summarize(bundle),
    rank_by_trait     = op_rank_by_trait(bundle, args$trait, args$n %||% 10),
    top_selections    = op_top_selections(bundle, args$n %||% 10),
    compare_genotypes = op_compare_genotypes(bundle, args$genotypes),
    describe_model    = op_describe_model(bundle),
    stop("Unknown tool '", tool, "'")
  )
}

`%||%` <- function(a, b) if (is.null(a)) b else a
