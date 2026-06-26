## request-from-sim.R — turn a simulated MET (sim.R) into a contract-valid AnalysisRequest.
##
## This is the bridge between known-truth data and the real kernel seam: the kernel only ever
## sees an AnalysisRequest (engine contract, packages/contracts/v0/analysis-request.schema.json),
## so the correctness suite must speak that shape — not the simulator's tidy data.frame. Reused
## as a fixture by the kernel tests and, later, by the groundedness evals.
suppressWarnings(suppressPackageStartupMessages(library(jsonlite)))

## traits in the sim df -> contract variable ids (stable, uppercase) + display names + units
.SIM_VARIABLES <- list(
  list(col = "yield",    variable_id = "YIELD",    name = "Yield",         unit = "t/ha"),
  list(col = "grain_protein",     variable_id = "GRAIN_PROTEIN",     name = "Grain protein",          unit = "%"),
  list(col = "plant_height", variable_id = "PLANT_HEIGHT", name = "Plant height",  unit = "cm"),
  list(col = "maturity", variable_id = "MATURITY", name = "Days to maturity", unit = "day")
)

#' Build an AnalysisRequest (as an R list) from a simulated MET data.frame.
#' @param d      a data.frame from simulate_maize_met()
#' @param traits which sim columns to include (default: all four)
#' @param intent contract intent ("selection" -> BLUPs)
#' No row/col layout is emitted, so the kernel takes the non-spatial MET path (lme4/BLUPF90),
#' which is exactly the path the genetic-recovery assertions validate.
request_from_sim <- function(d, traits = c("yield", "grain_protein", "plant_height", "maturity"),
                             intent = "selection") {
  vars <- Filter(function(v) v$col %in% traits, .SIM_VARIABLES)

  variables <- lapply(vars, function(v) list(
    variable_id = v$variable_id, name = v$name, data_type = "numeric",
    unit = v$unit, analyze = TRUE
  ))

  unit_ids <- sprintf("U%05d", seq_len(nrow(d)))
  observation_units <- lapply(seq_len(nrow(d)), function(i) list(
    observation_unit_id = unit_ids[i],
    germplasm_id        = d$genotype[i],
    environment_id      = d$env[i],
    layout              = list(rep = as.character(d$rep[i]), block = d$block[i])
  ))

  observations <- list()
  k <- 0
  for (i in seq_len(nrow(d))) {
    for (v in vars) {
      val <- d[[v$col]][i]
      if (is.na(val)) next
      k <- k + 1
      observations[[k]] <- list(
        observation_unit_id = unit_ids[i],
        variable_id         = v$variable_id,
        value               = as.numeric(val)
      )
    }
  }

  list(
    contract_version  = "v0",
    analysis_request_id = "sim-correctness",
    intent            = intent,
    variables         = variables,
    observation_units = observation_units,
    observations      = observations,
    design            = list(is_multi_environment = TRUE),
    relationship      = list(type = "identity")
  )
}

#' Write a request built from `d` to `path` as contract JSON. Returns `path`.
write_request_json <- function(d, path, ...) {
  req <- request_from_sim(d, ...)
  writeLines(toJSON(req, auto_unbox = TRUE, null = "null", digits = NA), path)
  path
}
