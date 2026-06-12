#!/usr/bin/env Rscript
## Verdant compute kernel — MET planning entrypoint (ADR-0016).
##
## Reads dataset STRUCTURE (no trait values needed — planning is about structure) as JSON on stdin,
## computes data readiness, and emits the deterministic Model Plan. The TS MET orchestrator calls
## this BEFORE fitting, then executes whatever the plan names.
##
##   Rscript services/kernel/met-plan.R < plan-input.json > plan-output.json
##
## Input  (JSON, parallel vectors): { variableIds:[K], environment:[N], genotype:[N], row:[N],
##           col:[N], rep:[N], intent?, relationship? }
## Output (JSON): { readiness: {...}, plan: {...} }   # plan = make_plan() output
suppressWarnings(suppressPackageStartupMessages(library(jsonlite)))

self_dir <- {
  a <- commandArgs(FALSE)
  f <- sub("^--file=", "", a[grep("^--file=", a)])
  if (length(f)) dirname(normalizePath(f)) else "."
}
source(file.path(self_dir, "diagnostics.R"))
source(file.path(self_dir, "plan.R"))

inp <- jsonlite::fromJSON(paste(readLines("stdin", warn = FALSE), collapse = "\n"), simplifyVector = TRUE)
df <- data.frame(
  environment = as.character(inp$environment),
  genotype = as.character(inp$genotype),
  row = suppressWarnings(as.numeric(inp$row)),
  col = suppressWarnings(as.numeric(inp$col)),
  rep = if (!is.null(inp$rep)) as.character(inp$rep) else NA_character_,
  stringsAsFactors = FALSE
)
readiness <- compute_readiness(df, as.character(inp$variableIds))
plan <- make_plan(readiness,
  intent = if (!is.null(inp$intent)) inp$intent else "selection",
  relationship = if (!is.null(inp$relationship)) inp$relationship else "identity")

cat(jsonlite::toJSON(list(readiness = readiness, plan = plan),
                     auto_unbox = TRUE, null = "null", na = "null", digits = NA))
