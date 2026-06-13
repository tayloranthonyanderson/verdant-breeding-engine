#!/usr/bin/env Rscript
## model-qc-test.R — asserts the post-fit Model QC residual diagnostics fire (ADR-0021).
## Sources model-qc.R with MQ_NO_MAIN=1 and checks influential detection, spatial autocorr, normality.
## Run:  Rscript services/kernel/tests/model-qc-test.R   Exit 0 = all pass.

Sys.setenv(MQ_NO_MAIN = "1")
.dir <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)])
          if (length(f)) dirname(normalizePath(f)) else "services/kernel/tests" }
source(file.path(normalizePath(file.path(.dir, "..")), "model-qc.R"))

.pass <- 0L; .fail <- 0L
ok <- function(cond, msg) {
  if (isTRUE(cond)) { .pass <<- .pass + 1L; cat(sprintf("  ok   %s\n", msg)) }
  else              { .fail <<- .fail + 1L; cat(sprintf("  FAIL %s\n", msg)) }
}

cat("Verdant Model QC suite\n")
set.seed(7)

## A single environment, 8×8 grid, 64 plots. True model: value = env_mean + geno_effect + noise.
ng <- 16
genotype <- environment <- plot_id <- character(0)
row <- col <- value <- numeric(0)
true_geno <- rnorm(ng, 0, 2); names(true_geno) <- sprintf("LINE%02d", seq_len(ng))
k <- 0
for (rr in 1:8) for (cc in 1:8) {
  k <- k + 1
  gi <- ((k - 1) %% ng) + 1
  gn <- sprintf("LINE%02d", gi)
  genotype <- c(genotype, gn); environment <- c(environment, "E1")
  row <- c(row, rr); col <- c(col, cc); plot_id <- c(plot_id, sprintf("p%02d", k))
  value <- c(value, 50 + true_geno[gn] + rnorm(1, 0, 1))
}

## the bundle's BLUPs (use the true geno effects as a stand-in for shrunken BLUPs)
blups <- as.list(true_geno)

## --- case A: one gross residual outlier ---
vA <- value; bad <- which(plot_id == "p20"); vA[bad] <- 9999
resA <- compute_model_qc(genotype, environment, row, col, plot_id,
                         list(Yield = vA), list(Yield = blups))$Yield
ok(any(vapply(resA$influential, function(z) identical(z$observation_unit_id, "p20"), logical(1))),
   "residual outlier (p20) flagged as influential, with its plot id")
ok(is.finite(resA$residual_normality_p), "residual normality p computed")

## --- case B: strong spatial gradient in the residuals → high Moran's I ---
vB <- value + (row * 3)             # a smooth row gradient the (geno+env) model can't absorb
resB <- compute_model_qc(genotype, environment, row, col, plot_id,
                         list(Yield = vB), list(Yield = blups))$Yield
ok(is.finite(resB$spatial_residual_autocorr) && resB$spatial_residual_autocorr > 0.2,
   sprintf("spatial gradient → positive Moran's I (%s)",
           if (is.null(resB$spatial_residual_autocorr)) "NA" else format(round(resB$spatial_residual_autocorr, 3))))

## --- case C: clean data → no influential, near-zero autocorr ---
resC <- compute_model_qc(genotype, environment, row, col, plot_id,
                         list(Yield = value), list(Yield = blups))$Yield
ok(length(resC$influential) == 0, "clean fit raises no influential observations")
ok(is.null(resC$spatial_residual_autocorr) || abs(resC$spatial_residual_autocorr) < 0.2,
   "clean fit shows little residual spatial autocorrelation")

cat(sprintf("\n%d passed, %d failed\n", .pass, .fail))
if (.fail > 0) quit(status = 1)
