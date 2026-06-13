#!/usr/bin/env Rscript
## Verdant compute kernel — Data Quality (pre-fit, value-level audit). ADR-0021.
##
## The crude-robust FIRST pass a statistician runs before fitting: it reads the actual trait values
## (unlike data-readiness, which is structural and never does) and flags the gross/structural errors
## that would wreck a fit — impossible/outlying values, duplicate plot coordinates, near-duplicate
## genotype names, high missingness, distribution shape, factor sanity. The proper residual-based
## outlier pass is POST-fit (Model QC, model-qc.R) — this one protects the fit from garbage.
##
## ADVISORY ONLY (ADR-0021): every finding is reported and may carry suggested_exclusion=TRUE, but the
## kernel NEVER removes data. The web tier turns the breeder's disposition policy into `data_overrides`;
## the kernel re-runs on the filtered data. Crop-agnostic (ADR-0015): operates on the generic plot
## record, never on column names.
##
## Run:  Rscript services/kernel/data-quality.R < dq-input.json > dq-output.json
## Input  (JSON): { variable_ids:[K], genotype:[N], environment:[N], row:[N], col:[N], rep:[N],
##                  plot_id:[N], values_by_trait:{ <trait>:[N numbers|null] } }
## Output (JSON): { findings:[{check,severity,detail,target:{kind,id,id2},variable_id,value,
##                  suggested_exclusion}], summary:{n_findings,by_severity,by_check} }
##
## Sourceable for tests: set DQ_NO_MAIN=1 to load the functions without running the entrypoint.

## ---- thresholds (named so they're explainable + tunable) -------------------------------------
MAD_K          <- 5      # |x − median| / (1.4826·MAD) above this within an environment → raw outlier
MISS_WARN      <- 0.50   # per-environment×trait missing fraction → warning
MISS_ERROR     <- 0.80   # …→ error, and suggest excluding that environment for the trait
SKEW_SUGGEST   <- 1.5    # |skewness| above this → suggest a transformation (info only)
ZERO_INFLATE   <- 0.30   # fraction of exact zeros above this → flag zero-inflation (info)
NEARDUP_MAXDIST<- 1L     # Levenshtein distance ≤ this (on case/space-normalised names) → likely typo
NEARDUP_MIN_CHARS <- 4L  # …but only for names this long (short codes are legitimately 1 char apart)
NEARDUP_MAX_FINDINGS <- 30L  # cap typo-pair findings (the rest summarised) — never flood the UI
MAX_OUTLIERS_PER_TRAIT <- 20L  # cap emitted outlier findings per trait; the rest are summarised, not dropped silently

## ---- helpers ---------------------------------------------------------------------------------
.skewness <- function(x) {
  x <- x[is.finite(x)]; n <- length(x)
  if (n < 3) return(NA_real_)
  m <- mean(x); s <- stats::sd(x)
  if (!is.finite(s) || s == 0) return(0)
  (sum((x - m)^3) / n) / (s^3)
}

## one finding (a plain list; toJSON renders it). target.id/id2 may be NULL.
.finding <- function(check, severity, detail, kind, id = NULL, id2 = NULL,
                     variable_id = NULL, value = NULL, suggested_exclusion = FALSE) {
  list(check = check, severity = severity, detail = detail,
       target = list(kind = kind, id = id, id2 = id2),
       variable_id = variable_id, value = value, suggested_exclusion = suggested_exclusion)
}

## ---- the checks ------------------------------------------------------------------------------
## Each takes the assembled vectors and returns a list of findings.

## Missingness: per environment × trait NA fraction over the plots in that environment.
dq_missingness <- function(environment, values_by_trait) {
  out <- list()
  envs <- sort(unique(environment))
  for (tr in names(values_by_trait)) {
    v <- values_by_trait[[tr]]
    for (e in envs) {
      idx <- environment == e
      n <- sum(idx); if (n == 0) next
      frac <- sum(!is.finite(v[idx])) / n
      if (frac >= MISS_ERROR) {
        out[[length(out) + 1]] <- .finding("missingness", "error",
          sprintf("Environment '%s' is %.0f%% missing for %s — too sparse to contribute a credible mean; consider excluding it for this trait.", e, 100 * frac, tr),
          "environment", e, NULL, tr, round(frac, 4), TRUE)
      } else if (frac >= MISS_WARN) {
        out[[length(out) + 1]] <- .finding("missingness", "warning",
          sprintf("Environment '%s' is %.0f%% missing for %s.", e, 100 * frac, tr),
          "environment", e, NULL, tr, round(frac, 4), FALSE)
      }
    }
  }
  out
}

## Raw robust outliers: within each environment×trait, flag plots beyond MAD_K of the env median.
## Cells (genotype×env) are usually singletons in a MET, so the environment is the reference set.
dq_outliers <- function(environment, plot_id, genotype, values_by_trait) {
  out <- list()
  envs <- sort(unique(environment))
  for (tr in names(values_by_trait)) {
    v <- values_by_trait[[tr]]
    cand <- list()  # collect (plot_id, geno, env, value, score) then cap by score
    for (e in envs) {
      idx <- which(environment == e & is.finite(v))
      if (length(idx) < 5) next                     # too few to robustly estimate a spread
      x <- v[idx]; med <- stats::median(x)
      mad <- stats::median(abs(x - med)) * 1.4826
      if (!is.finite(mad) || mad == 0) next
      score <- abs(x - med) / mad
      hit <- which(score > MAD_K)
      for (h in hit) cand[[length(cand) + 1]] <- list(
        pid = plot_id[idx[h]], g = genotype[idx[h]], e = e, val = x[h], sc = score[h])
    }
    if (!length(cand)) next
    scores <- vapply(cand, function(c) c$sc, numeric(1))
    ord <- order(-scores)
    keep <- head(ord, MAX_OUTLIERS_PER_TRAIT)
    for (k in keep) {
      c <- cand[[k]]
      out[[length(out) + 1]] <- .finding("outlier", "warning",
        sprintf("Plot '%s' (%s, env '%s') reads %.3g for %s — %.1f MAD from the environment median, a likely transcription error or true outlier.",
                c$pid, c$g, c$e, c$val, tr, c$sc),
        "observation_unit", c$pid, NULL, tr, round(c$sc, 2), TRUE)
    }
    if (length(cand) > MAX_OUTLIERS_PER_TRAIT)
      out[[length(out) + 1]] <- .finding("outlier", "info",
        sprintf("%d further plots exceed %d MAD for %s beyond the %d shown — review the trait's distribution.",
                length(cand) - MAX_OUTLIERS_PER_TRAIT, MAD_K, tr, MAX_OUTLIERS_PER_TRAIT),
        "variable", tr, NULL, tr, NULL, FALSE)
  }
  out
}

## Duplicate plot coordinates: same (environment, row, col) on more than one plot.
dq_duplicate_coords <- function(environment, row, col, genotype) {
  out <- list()
  ok <- is.finite(row) & is.finite(col)
  if (!any(ok)) return(out)
  key <- paste(environment, row, col, sep = "")
  tab <- table(key[ok])
  dups <- names(tab)[tab > 1]
  for (d in dups) {
    idx <- which(ok & key == d)
    parts <- strsplit(d, "", fixed = TRUE)[[1]]
    gs <- paste(unique(genotype[idx]), collapse = ", ")
    out[[length(out) + 1]] <- .finding("duplicate_coords", "warning",
      sprintf("Environment '%s' has %d plots at the same row %s / col %s (%s) — a layout or data-entry error; spatial de-trending assumes one plot per cell.",
              parts[1], length(idx), parts[2], parts[3], gs),
      "environment", parts[1], NULL, NULL, length(idx), FALSE)
  }
  out
}

## Near-duplicate genotype names: pairs differing only by case/whitespace, or Levenshtein ≤ threshold.
dq_duplicate_names <- function(genotype) {
  out <- list()
  names_u <- sort(unique(genotype[!is.na(genotype) & nzchar(genotype)]))
  if (length(names_u) < 2) return(out)
  norm <- tolower(gsub("\\s+", "", names_u))
  ## case/whitespace-only collisions
  for (key in unique(norm[duplicated(norm)])) {
    grp <- names_u[norm == key]
    if (length(grp) > 1) out[[length(out) + 1]] <- .finding("duplicate_name", "warning",
      sprintf("Entries %s differ only by case or spacing — almost certainly the same genotype recorded inconsistently; merge before analysis or their data is split across two BLUPs.",
              paste(sprintf("'%s'", grp), collapse = " / ")),
      "germplasm", grp[1], grp[2], NULL, NULL, FALSE)
  }
  ## Levenshtein ≤ threshold among names of similar length (bounded to keep it cheap).
  ## Only on names ≥ NEARDUP_MIN_CHARS: short codes (A/B1/…) are legitimately edit-distance 1 apart.
  ## CRITICAL: skip pairs that differ only in digits (e.g. '…_0017/…' vs '…_0018/…') — those are
  ## sequential serial numbers, distinct entries by design, not typos. Without this a serial-numbered
  ## program (like G2F) floods the UI with thousands of false near-duplicates.
  stripdig <- function(s) gsub("[0-9]+", "", s)
  npair <- 0L
  if (length(names_u) <= 4000) {
    d <- utils::adist(names_u)
    for (i in seq_along(names_u)) for (j in seq_len(i - 1)) {
      if (norm[i] == norm[j]) next                  # already reported as case/space
      if (min(nchar(names_u[i]), nchar(names_u[j])) < NEARDUP_MIN_CHARS) next
      if (d[i, j] <= NEARDUP_MAXDIST && abs(nchar(names_u[i]) - nchar(names_u[j])) <= NEARDUP_MAXDIST) {
        if (stripdig(names_u[i]) == stripdig(names_u[j])) next   # differ only in numbering → distinct serials
        npair <- npair + 1L
        if (npair <= NEARDUP_MAX_FINDINGS)
          out[[length(out) + 1]] <- .finding("duplicate_name", "info",
            sprintf("Entries '%s' and '%s' differ by one character — possibly a typo of the same genotype; confirm they are distinct.",
                    names_u[j], names_u[i]),
            "germplasm", names_u[j], names_u[i], NULL, NULL, FALSE)
      }
    }
    if (npair > NEARDUP_MAX_FINDINGS)
      out[[length(out) + 1]] <- .finding("duplicate_name", "info",
        sprintf("%d further one-character name pairs beyond the %d shown — review your naming if these should be distinct.",
                npair - NEARDUP_MAX_FINDINGS, NEARDUP_MAX_FINDINGS),
        "dataset", NULL, NULL, NULL, npair, FALSE)
  }
  out
}

## Distribution shape (info only): strong skew → transformation hint; zero-inflation flag.
dq_distribution <- function(values_by_trait) {
  out <- list()
  for (tr in names(values_by_trait)) {
    v <- values_by_trait[[tr]]; x <- v[is.finite(v)]
    if (length(x) < 20) next
    sk <- .skewness(x)
    if (is.finite(sk) && abs(sk) >= SKEW_SUGGEST) {
      pos <- all(x >= 0)
      hint <- if (sk > 0 && pos && min(x) >= 0) " A log or square-root transform would symmetrise it; the model assumes roughly normal residuals." else ""
      out[[length(out) + 1]] <- .finding("distribution", "info",
        sprintf("%s is %s-skewed (skewness %.2f).%s", tr, if (sk > 0) "right" else "left", sk, hint),
        "variable", tr, NULL, tr, round(sk, 3), FALSE)
    }
    zfrac <- mean(x == 0)
    if (is.finite(zfrac) && zfrac >= ZERO_INFLATE)
      out[[length(out) + 1]] <- .finding("distribution", "info",
        sprintf("%s is %.0f%% exact zeros — zero-inflated; a mean-based model may misrepresent it.", tr, 100 * zfrac),
        "variable", tr, NULL, tr, round(zfrac, 3), FALSE)
  }
  out
}

## Factor sanity (conservative — avoid flooding a MET where most genotypes are unreplicated by design):
## a degenerate environment (one genotype) or a trait entirely absent in an environment.
dq_factor_sanity <- function(environment, genotype, values_by_trait) {
  out <- list()
  for (e in sort(unique(environment))) {
    idx <- environment == e
    ng <- length(unique(genotype[idx]))
    if (ng <= 1) out[[length(out) + 1]] <- .finding("factor_sanity", "warning",
      sprintf("Environment '%s' has only %d genotype(s) — it cannot contribute genetic contrast and may distort the across-environment fit.", e, ng),
      "environment", e, NULL, NULL, ng, TRUE)
    for (tr in names(values_by_trait)) {
      v <- values_by_trait[[tr]]
      if (sum(is.finite(v[idx])) == 0 && sum(idx) > 0)
        out[[length(out) + 1]] <- .finding("factor_sanity", "warning",
          sprintf("%s is entirely unrecorded in environment '%s'.", tr, e),
          "environment", e, NULL, tr, 0, FALSE)
    }
  }
  out
}

## ---- assemble ---------------------------------------------------------------------------------
## Raw-measurement distribution per trait × environment as box-and-whisker stats (ADR-0021): the
## "see the spread + outliers of the actual data" view, a PRE-fit data-sanity check (distinct from the
## residual Q-Q, which is post-fit model trust). Tukey boxplot: quartiles, 1.5·IQR whiskers, and the
## points beyond the whiskers as outliers (capped, farthest-from-median first).
DIST_MAX_OUTLIERS <- 12L
dq_distributions <- function(environment, values_by_trait) {
  out <- list()
  for (tr in names(values_by_trait)) {
    v <- values_by_trait[[tr]]
    per_env <- list()
    for (e in sort(unique(environment))) {
      x <- v[environment == e]; x <- x[is.finite(x)]
      if (length(x) < 5) next
      q <- stats::quantile(x, c(0.25, 0.5, 0.75), names = FALSE, type = 7)
      iqr <- q[3] - q[1]
      lo_w <- q[1] - 1.5 * iqr; hi_w <- q[3] + 1.5 * iqr
      inb <- x[x >= lo_w & x <= hi_w]
      outs <- x[x < lo_w | x > hi_w]
      shown <- if (length(outs) > DIST_MAX_OUTLIERS) outs[order(-abs(outs - q[2]))][seq_len(DIST_MAX_OUTLIERS)] else outs
      per_env[[length(per_env) + 1]] <- list(
        environment = e, n = length(x),
        min = round(min(x), 4), q1 = round(q[1], 4), median = round(q[2], 4), q3 = round(q[3], 4), max = round(max(x), 4),
        whisker_lo = round(if (length(inb)) min(inb) else q[1], 4),
        whisker_hi = round(if (length(inb)) max(inb) else q[3], 4),
        n_outliers = length(outs), outliers = if (length(shown)) round(shown, 4) else numeric(0))
    }
    if (length(per_env)) out[[tr]] <- per_env
  }
  out
}

compute_data_quality <- function(genotype, environment, row, col, rep, plot_id, values_by_trait) {
  findings <- c(
    dq_missingness(environment, values_by_trait),
    dq_outliers(environment, plot_id, genotype, values_by_trait),
    dq_duplicate_coords(environment, row, col, genotype),
    dq_duplicate_names(genotype),
    dq_distribution(values_by_trait),
    dq_factor_sanity(environment, genotype, values_by_trait)
  )
  sev <- if (length(findings)) vapply(findings, function(f) f$severity, character(1)) else character(0)
  chk <- if (length(findings)) vapply(findings, function(f) f$check, character(1)) else character(0)
  by_sev <- list(error = sum(sev == "error"), warning = sum(sev == "warning"), info = sum(sev == "info"))
  ## Fixed keys so by_check is ALWAYS a JSON object — an empty `table()` serialises as `[]` (array),
  ## which violates the contract (object|null). Initialising every check to 0 also reads better.
  CHECK_NAMES <- c("missingness", "outlier", "duplicate_coords", "duplicate_name", "distribution", "factor_sanity")
  by_chk <- as.list(setNames(integer(length(CHECK_NAMES)), CHECK_NAMES))
  for (c in chk) by_chk[[c]] <- by_chk[[c]] + 1L
  list(findings = findings,
       summary = list(n_findings = length(findings), by_severity = by_sev, by_check = by_chk),
       distributions = dq_distributions(environment, values_by_trait))
}

## ---- entrypoint -------------------------------------------------------------------------------
main <- function() {
  suppressWarnings(suppressPackageStartupMessages(library(jsonlite)))
  args <- commandArgs(trailingOnly = TRUE)
  con <- if (length(args) >= 1 && file.exists(args[1])) args[1] else "stdin"
  inp <- jsonlite::fromJSON(paste(readLines(con, warn = FALSE), collapse = "\n"), simplifyVector = TRUE)

  N <- length(inp$genotype)
  numv <- function(x) suppressWarnings(as.numeric(x))
  vbt <- inp$values_by_trait
  ## values_by_trait arrives as a named list (or data.frame) of length-N numeric vectors.
  if (is.data.frame(vbt)) vbt <- as.list(vbt)
  vbt <- lapply(vbt, numv)

  res <- compute_data_quality(
    genotype = as.character(inp$genotype),
    environment = as.character(inp$environment),
    row = numv(inp$row), col = numv(inp$col),
    rep = if (!is.null(inp$rep)) as.character(inp$rep) else rep(NA_character_, N),
    plot_id = as.character(inp$plot_id),
    values_by_trait = vbt
  )
  cat(jsonlite::toJSON(res, auto_unbox = TRUE, null = "null", na = "null", digits = NA))
}

if (!nzchar(Sys.getenv("DQ_NO_MAIN"))) main()
