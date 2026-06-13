#!/usr/bin/env Rscript
## correctness.R — the kernel's correctness net (the moat made re-runnable).
##
## Generates known-truth MET data (sim.R), feeds it to the REAL kernel through the REAL seam
## (analyze.R reads an AnalysisRequest as JSON, writes a ResultBundle as JSON), and asserts the
## kernel recovers the truth. If a refactor breaks the science, this fails loudly.
##
## Run:  Rscript services/kernel/tests/correctness.R     (or: pnpm test:kernel)
## Exit: 0 all assertions passed; 1 any failed.
suppressWarnings(suppressPackageStartupMessages(library(jsonlite)))

.dir       <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)])
                if (length(f)) dirname(normalizePath(f)) else "services/kernel/tests" }
kernel_dir <- normalizePath(file.path(.dir, ".."))
source(file.path(kernel_dir, "sim.R"))
source(file.path(.dir, "request-from-sim.R"))

## ---- tiny assertion harness (zero deps; clear pass/fail accounting) --------------------
.pass <- 0L; .fail <- 0L
ok   <- function(cond, msg) {
  if (isTRUE(cond)) { .pass <<- .pass + 1L; cat(sprintf("  ok   %s\n", msg)) }
  else              { .fail <<- .fail + 1L; cat(sprintf("  FAIL %s\n", msg)) }
}
near <- function(a, b, tol) is.finite(a) && is.finite(b) && abs(a - b) <= tol

## ---- tunables (FOUNDER'S CALL — adjust here) ------------------------------------------
ACC_FLOOR  <- 0.85   # min cor(BLUP, true genetic value) per trait — proven floor from the old suite
H2_TOL     <- 0.10   # max |reported h2 - true entry-mean H2| per trait

## ---- run the kernel through the real seam ---------------------------------------------
cat("Verdant kernel correctness suite\n")
d <- simulate_tomato_met(n_geno = 40, n_env = 3, n_rep = 3, seed = 1)
truth   <- attr(d, "true_geno_means")
true_h2 <- attr(d, "true_entry_h2")

req_path    <- tempfile(fileext = ".json")
bundle_path <- tempfile(fileext = ".json")
invisible(write_request_json(d, req_path))

## stderr discarded: the kernel's lme4 boundary/convergence notes are expected on this design
## and are noise here; this suite reports its own pass/fail, and aborts below on a nonzero exit.
status <- system2("Rscript", c(file.path(kernel_dir, "analyze.R"), req_path),
                  stdout = bundle_path, stderr = FALSE)
ok(status == 0, sprintf("analyze.R exits 0 on a 40x3x3 simulated MET (got %d)", status))
if (status != 0) { cat("\nKernel failed to run; aborting.\n"); quit(status = 1) }

bundle <- fromJSON(paste(readLines(bundle_path, warn = FALSE), collapse = "\n"),
                   simplifyVector = FALSE)
ok(identical(bundle$status, "ok"), sprintf("bundle status == 'ok' (got '%s')", bundle$status))

## index traits by id for lookup
traits_by_id <- setNames(bundle$traits, vapply(bundle$traits, function(t) t$variable_id, ""))
trait_map <- c(YIELD = "yield", BRIX = "brix", FRUIT_WT = "fruit_wt", MATURITY = "maturity")

## ---- HARD GATE 1: BLUPs recover true genetic values -----------------------------------
cat("\n[recovery] BLUP <-> true genetic value (floor =", ACC_FLOOR, ")\n")
for (vid in names(trait_map)) {
  tr <- trait_map[[vid]]; t <- traits_by_id[[vid]]
  if (is.null(t) || !identical(t$status, "ok")) { ok(FALSE, sprintf("%s: trait fit present & ok", vid)); next }
  eff <- data.frame(
    germplasm_id = vapply(t$effects, function(e) e$germplasm_id, ""),
    value        = vapply(t$effects, function(e) if (is.null(e$value)) NA_real_ else e$value, 0.0),
    stringsAsFactors = FALSE
  )
  m <- merge(eff, truth[, c("genotype", tr)], by.x = "germplasm_id", by.y = "genotype")
  r <- suppressWarnings(stats::cor(m$value, m[[tr]]))
  ok(is.finite(r) && r > ACC_FLOOR, sprintf("%-8s cor(BLUP,truth) = %.3f > %.2f", vid, r, ACC_FLOOR))
}

## ---- HARD GATE 2: heritability is identifiable and recovers true entry-mean H2 ---------
cat("\n[recovery] reported h2 <-> true entry-mean H2 (tol =", H2_TOL, ")\n")
for (vid in names(trait_map)) {
  tr <- trait_map[[vid]]; t <- traits_by_id[[vid]]
  h <- if (!is.null(t$heritability)) t$heritability$value else NULL
  th <- true_h2[[tr]]
  if (is.null(h)) { ok(FALSE, sprintf("%s: heritability present", vid)); next }
  ok(is.finite(h) && h > 0 && h <= 1, sprintf("%-8s h2 = %.3f in (0,1]", vid, h))
  ok(near(h, th, H2_TOL), sprintf("%-8s h2 recovers true H2 %.3f (within %.2f)", vid, th, H2_TOL))
}

## ---- SOFT CHECK: genetic-correlation sign (the yield<->brix trade-off) -----------------
## Only if the kernel emitted a multi-trait genetic-correlation matrix (BLUPF90 path).
cat("\n[soft] genetic-correlation recovery (warn-only in v1)\n")
gc <- bundle$genetic_correlations
if (is.null(gc)) {
  cat("  skip genetic_correlations absent (single-trait/lme4 path; needs the BLUPF90 step)\n")
} else {
  ids <- unlist(gc$variable_ids)
  M <- matrix(unlist(gc$matrix), nrow = length(ids), byrow = TRUE, dimnames = list(ids, ids))
  if (all(c("YIELD", "BRIX") %in% ids)) {
    rg <- M["YIELD", "BRIX"]
    msg <- sprintf("yield<->brix genetic cor = %.2f is negative (true = -0.45)", rg)
    if (rg < 0) cat("  ok  ", msg, "\n") else cat("  warn", msg, "\n")
  }
}

## ---- summary --------------------------------------------------------------------------
cat(sprintf("\n%d passed, %d failed\n", .pass, .fail))
quit(status = if (.fail > 0) 1L else 0L)
