## plumber.R — REST API over the breeding engine + Postgres backbone.
## Thin glue: it validates input, calls the engine/db, and serializes JSON.
## All statistics live in the breedeng package; all data access in db.R.

library(breedeng)
.root <- Sys.getenv("APP_ROOT", ".")
source(file.path(.root, "api", "db.R"))
source(file.path(.root, "api", "assistant.R"))

`%||%` <- function(a, b) if (is.null(a)) b else a

.body <- function(req) {
  b <- req$postBody
  if (is.null(b) || !nzchar(b)) return(list())
  jsonlite::fromJSON(b, simplifyVector = TRUE)
}

# build a named numeric over traits, defaulting missing entries
.named_over <- function(obj, traits, default) {
  v <- stats::setNames(rep(default, length(traits)), traits)
  if (!is.null(obj)) {
    o <- unlist(obj)
    for (nm in intersect(names(o), traits)) v[[nm]] <- as.numeric(o[[nm]])
  }
  v
}

.run_analysis <- function(data, traits, genotype, env, block, effect, engine, weights, directions) {
  w <- .named_over(weights, traits, 1)
  d <- .named_over(directions, traits, 1)
  analyze_trial(data, traits = traits, genotype = genotype, env = env, block = block,
                genotype_effect = effect, engine = engine, weights = w, directions = d)
}

#* @filter cors
function(req, res) {
  res$setHeader("Access-Control-Allow-Origin", "*")
  res$setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res$setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (identical(req$REQUEST_METHOD, "OPTIONS")) { res$status <- 200; return(list()) }
  plumber::forward()
}

#* Health check
#* @get /health
function() list(status = "ok", service = "breeding-api", time = as.character(Sys.time()))

#* Synthetic demo trial (no DB)
#* @get /demo-data
function() {
  d <- simulate_tomato_met()
  attr(d, "true_geno_means") <- NULL
  list(data = d, traits = c("yield", "brix", "fruit_wt", "maturity"),
       genotype = "genotype", env = "env", block = "block")
}

#* Simulate + analyze in one shot (no DB) — powers the "Load demo" button
#* @get /demo-analyze
function() {
  d <- simulate_tomato_met()
  .run_analysis(d, c("yield", "brix", "fruit_wt", "maturity"),
                "genotype", "env", "block", "random", "lme4", NULL, NULL)
}

#* Analyze inline data (no persistence)
#* @post /analyze
function(req) {
  b <- .body(req)
  if (is.null(b$data) || is.null(b$traits)) stop("Body must include 'data' and 'traits'.")
  .run_analysis(b$data, as.character(b$traits),
                b$genotype %||% "genotype", b$env %||% "env", b$block %||% "block",
                b$genotype_effect %||% "random", b$engine %||% "lme4",
                b$weights, b$directions)
}

#* Create a trial (persists program/trial/observations)
#* @post /trials
function(req) {
  b <- .body(req)
  if (is.null(b$data) || is.null(b$traits)) stop("Body must include 'data' and 'traits'.")
  with_db(function(con) {
    pid <- ensure_program(con, b$program %||% "Demo Program")
    res <- create_trial(con, pid, b$name %||% "Untitled trial", b$crop %||% "tomato",
                        b$data, as.character(b$traits),
                        b$genotype %||% "genotype", b$env %||% "env", b$block %||% "block")
    res
  })
}

#* List trials for a program
#* @get /trials
function() {
  with_db(function(con) {
    pid <- ensure_program(con)
    list_trials(con, pid)
  })
}

#* Analyze a stored trial (persists the analysis run + result)
#* @post /trials/<id>/analyze
function(req, id) {
  b <- .body(req)
  with_db(function(con) {
    td <- get_trial_data(con, as.integer(id))
    traits <- b$traits %||% td$traits
    bundle <- .run_analysis(td$data, as.character(traits),
                            "genotype", "env", "block",
                            b$genotype_effect %||% "random", b$engine %||% "lme4",
                            b$weights, b$directions)
    run_id <- save_analysis(con, as.integer(id), bundle$engine,
                            b$genotype_effect %||% "random",
                            list(traits = traits, weights = b$weights, directions = b$directions),
                            bundle)
    list(analysis_run_id = run_id, bundle = bundle)
  })
}

#* Ask the embedded AI assistant about an analysis
#* @post /assistant
function(req) {
  b <- .body(req)
  if (is.null(b$message)) stop("Body must include 'message'.")
  bundle <- if (!is.null(b$analysis_run_id))
    with_db(function(con) get_result(con, as.integer(b$analysis_run_id)))
  else b$bundle
  if (is.null(bundle)) stop("Provide 'bundle' or 'analysis_run_id'.")
  hist <- b$history %||% list()
  assistant_reply(bundle, b$message, hist)
}
