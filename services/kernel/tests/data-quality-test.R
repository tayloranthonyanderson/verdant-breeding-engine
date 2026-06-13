#!/usr/bin/env Rscript
## data-quality-test.R — asserts the pre-fit Data Quality checks fire on a planted dataset (ADR-0021).
## Sources data-quality.R with DQ_NO_MAIN=1 (functions only, no entrypoint) and checks each finding type.
## Run:  Rscript services/kernel/tests/data-quality-test.R   Exit 0 = all pass, 1 = any fail.

Sys.setenv(DQ_NO_MAIN = "1")
.dir <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)])
          if (length(f)) dirname(normalizePath(f)) else "services/kernel/tests" }
source(file.path(normalizePath(file.path(.dir, "..")), "data-quality.R"))

.pass <- 0L; .fail <- 0L
ok <- function(cond, msg) {
  if (isTRUE(cond)) { .pass <<- .pass + 1L; cat(sprintf("  ok   %s\n", msg)) }
  else              { .fail <<- .fail + 1L; cat(sprintf("  FAIL %s\n", msg)) }
}
has <- function(findings, check, sev = NULL, pred = NULL) {
  any(vapply(findings, function(f)
    f$check == check && (is.null(sev) || f$severity == sev) && (is.null(pred) || isTRUE(pred(f))),
    logical(1)))
}

cat("Verdant Data Quality check suite\n")

## ---- build a clean base, then plant one of each error -----------------------------------------
set.seed(1)
n_geno <- 30; envs <- c("E1", "E2", "E3"); reps <- 1:2
g <- environment <- row <- col <- rep_ <- plot_id <- character(0)
yield <- numeric(0); height <- numeric(0)
i <- 0
for (e in envs) for (r in reps) for (gi in seq_len(n_geno)) {
  i <- i + 1
  g <- c(g, sprintf("LINE%03d", gi)); environment <- c(environment, e)
  row <- c(row, ((gi - 1) %% 6) + 1); col <- c(col, ((gi - 1) %/% 6) + 1 + (r - 1) * 5)
  rep_ <- c(rep_, as.character(r)); plot_id <- c(plot_id, sprintf("%s-r%d-g%02d", e, r, gi))
  yield <- c(yield, rnorm(1, 8, 1.5)); height <- c(height, rnorm(1, 180, 15))
}
row <- as.numeric(row); col <- as.numeric(col)

## plant: an impossible outlier (yield 9999) on a known plot in E1
out_plot <- which(environment == "E1" & plot_id == "E1-r1-g05"); yield[out_plot] <- 9999
## plant: E3 mostly-missing for yield (85% NA)
e3 <- which(environment == "E3"); yield[e3[seq_len(round(0.85 * length(e3)))]] <- NA
## plant: duplicate plot coordinate in E2 (two plots same row/col)
dup <- which(environment == "E2")[1:2]; row[dup] <- 3; col[dup] <- 3
## plant: a near-duplicate genotype name (whitespace) and a one-char typo (realistic long names)
g[which(g == "LINE007")[1]] <- "LINE007 "   # whitespace variant of LINE007
g[which(g == "LINE011")[1]] <- "LINE01l"    # 'l' for '1' typo of LINE011
## plant: a right-skewed trait (exponential) as a third trait
skewed <- rexp(length(yield), rate = 0.5)

vbt <- list(Yield = yield, Height = height, Skewed = skewed)
res <- compute_data_quality(g, environment, row, col, rep_, plot_id, vbt)
f <- res$findings

ok(has(f, "outlier", "warning", function(x) identical(x$target$id, "E1-r1-g05") && isTRUE(x$suggested_exclusion)),
   "raw outlier (yield 9999) flagged on the right plot, suggested for exclusion")
ok(has(f, "missingness", "error", function(x) identical(x$target$id, "E3") && isTRUE(x$suggested_exclusion)),
   "high-missing environment (E3 yield) flagged as error + suggested exclusion")
ok(has(f, "duplicate_coords", "warning", function(x) identical(x$target$id, "E2")),
   "duplicate plot coordinates flagged in E2")
ok(has(f, "duplicate_name", "warning", function(x) grepl("LINE007", x$detail)),
   "near-duplicate genotype name (whitespace) flagged")
ok(has(f, "duplicate_name", "info", function(x) grepl("LINE01l|LINE011", x$detail)),
   "one-char typo genotype name flagged")
ok(has(f, "distribution", "info", function(x) identical(x$target$id, "Skewed")),
   "right-skewed trait flagged with a transformation hint")
ok(res$summary$n_findings == length(f) && res$summary$by_severity$error >= 1,
   "summary rolls up findings + severities")

## a clean dataset (no planted errors) should produce no error/warning outliers
clean <- compute_data_quality(sprintf("G%02d", rep_len(1:n_geno, 60)), rep(envs, each = 20),
  as.numeric(rep_len(1:6, 60)), as.numeric(rep_len(1:10, 60)), rep("1", 60),
  sprintf("p%02d", 1:60), list(Yield = rnorm(60, 8, 1)))
ok(!has(clean$findings, "outlier", "warning"), "clean data raises no raw-outlier warning")
# regression: empty findings must still give a KEYED by_check object (an empty table() serialises as
# [] and fails the contract object|null — the bug a post-exclusion re-fit hit).
ok(length(clean$summary$by_check) == 6 && !is.null(names(clean$summary$by_check)),
   "by_check is always a keyed object even with zero findings (contract-safe)")

cat(sprintf("\n%d passed, %d failed\n", .pass, .fail))
if (.fail > 0) quit(status = 1)
