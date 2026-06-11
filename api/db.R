## db.R — Postgres data access via DBI/RPostgres.
## All app data goes through here so the SQLite/Postgres backend stays swappable
## and tenant scoping (program_id) is centralized.

suppressWarnings(suppressMessages({
  library(DBI)
}))

# --- connection ------------------------------------------------------------
.parse_database_url <- function(url) {
  m <- regmatches(url, regexec(
    "^postgres(?:ql)?://(?:([^:@]+)(?::([^@]*))?@)?([^:/]+)(?::(\\d+))?/(.+)$", url))[[1]]
  if (length(m) == 0) stop("Bad DATABASE_URL")
  list(user = m[2], password = m[3], host = m[4],
       port = if (nzchar(m[5])) as.integer(m[5]) else 5432L, dbname = m[6])
}

db_connect <- function() {
  url <- Sys.getenv("DATABASE_URL", "")
  if (nzchar(url)) {
    p <- .parse_database_url(url)
    DBI::dbConnect(RPostgres::Postgres(), dbname = p$dbname, host = p$host,
                   port = p$port, user = p$user, password = p$password)
  } else {
    DBI::dbConnect(RPostgres::Postgres(),
      dbname   = Sys.getenv("PGDATABASE", "breeding"),
      host     = Sys.getenv("PGHOST", "localhost"),
      port     = as.integer(Sys.getenv("PGPORT", "5432")),
      user     = Sys.getenv("PGUSER", Sys.info()[["user"]]),
      password = Sys.getenv("PGPASSWORD", ""))
  }
}

# Run f(con) with a connection that's always closed afterward.
with_db <- function(f) {
  con <- db_connect(); on.exit(DBI::dbDisconnect(con))
  f(con)
}

# --- programs --------------------------------------------------------------
ensure_program <- function(con, name = "Demo Program") {
  hit <- DBI::dbGetQuery(con, "SELECT id FROM program WHERE name = $1", params = list(name))
  if (nrow(hit)) return(hit$id[1])
  DBI::dbGetQuery(con,
    "INSERT INTO program(name) VALUES ($1) RETURNING id", params = list(name))$id[1]
}

# --- trials ----------------------------------------------------------------
# wide_df: data.frame with genotype/env/block columns + one column per trait.
create_trial <- function(con, program_id, name, crop, wide_df, traits,
                         genotype = "genotype", env = "env", block = "block") {
  # as.numeric: BIGINT comes back as integer64, which data.frame() won't recycle
  trial_id <- as.numeric(DBI::dbGetQuery(con,
    "INSERT INTO trial(program_id, name, crop) VALUES ($1,$2,$3) RETURNING id",
    params = list(program_id, name, crop))$id[1])

  # melt wide -> long observation rows
  n <- nrow(wide_df)
  long <- do.call(rbind, lapply(traits, function(tr) {
    data.frame(
      trial_id       = trial_id,
      env_label      = if (env %in% names(wide_df)) as.character(wide_df[[env]]) else NA_character_,
      genotype_label = as.character(wide_df[[genotype]]),
      block          = if (block %in% names(wide_df)) as.character(wide_df[[block]]) else NA_character_,
      rep            = if ("rep" %in% names(wide_df)) as.integer(wide_df[["rep"]]) else NA_integer_,
      trait_name     = tr,
      value          = suppressWarnings(as.numeric(wide_df[[tr]])),
      stringsAsFactors = FALSE)
  }))
  long <- long[is.finite(long$value), , drop = FALSE]
  DBI::dbAppendTable(con, "observation", long)
  list(trial_id = trial_id, n_observations = nrow(long))
}

list_trials <- function(con, program_id) {
  DBI::dbGetQuery(con,
    "SELECT t.id, t.name, t.crop, t.created_at,
            COUNT(o.id) AS n_obs,
            COUNT(DISTINCT o.genotype_label) AS n_genotypes,
            COUNT(DISTINCT o.trait_name) AS n_traits
     FROM trial t LEFT JOIN observation o ON o.trial_id = t.id
     WHERE t.program_id = $1
     GROUP BY t.id ORDER BY t.created_at DESC",
    params = list(program_id))
}

# Reconstruct a wide data.frame (+ trait names) for the engine from long obs.
get_trial_data <- function(con, trial_id) {
  long <- DBI::dbGetQuery(con,
    "SELECT env_label, genotype_label, block, rep, trait_name, value
     FROM observation WHERE trial_id = $1", params = list(trial_id))
  if (nrow(long) == 0) stop("Trial has no observations")
  keycols <- c("genotype_label", "env_label", "block", "rep")
  long$.row <- do.call(paste, c(long[keycols], sep = "\r"))
  w <- stats::reshape(long[, c(".row", "trait_name", "value")],
                      idvar = ".row", timevar = "trait_name", direction = "wide")
  names(w) <- sub("^value\\.", "", names(w))
  traits <- setdiff(names(w), ".row")
  meta <- long[!duplicated(long$.row), c(".row", keycols)]
  wide <- merge(meta, w, by = ".row")
  wide$.row <- NULL
  names(wide)[names(wide) == "genotype_label"] <- "genotype"
  names(wide)[names(wide) == "env_label"]      <- "env"
  list(data = wide, traits = traits)
}

# --- analysis runs / results ----------------------------------------------
save_analysis <- function(con, trial_id, engine, genotype_effect, model_spec, bundle) {
  run_id <- DBI::dbGetQuery(con,
    "INSERT INTO analysis_run(trial_id, engine, genotype_effect, model_spec)
     VALUES ($1,$2,$3,$4) RETURNING id",
    params = list(trial_id, engine, genotype_effect,
                  jsonlite::toJSON(model_spec, auto_unbox = TRUE)))$id[1]
  DBI::dbExecute(con,
    "INSERT INTO result(analysis_run_id, payload) VALUES ($1,$2)",
    params = list(run_id, jsonlite::toJSON(bundle, auto_unbox = TRUE, na = "null")))
  run_id
}

get_result <- function(con, analysis_run_id) {
  r <- DBI::dbGetQuery(con,
    "SELECT payload FROM result WHERE analysis_run_id = $1",
    params = list(analysis_run_id))
  if (nrow(r) == 0) stop("No result for run ", analysis_run_id)
  jsonlite::fromJSON(r$payload[1], simplifyVector = TRUE)
}
