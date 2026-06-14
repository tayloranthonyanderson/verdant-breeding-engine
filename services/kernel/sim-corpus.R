## sim-corpus.R — synthetic tomato BREEDING PROGRAM with known truth (extends sim.R from one MET
## to a staged, multi-year, multi-market funnel). IP-clean: fully simulated (ADR-0008). Pure base R
## + jsonlite. The corpus the product demos a *program* on, and the substrate for the data-cut model
## (docs/sim-corpus-spec.md, ADR-0023).
##
## What it builds:
##   - Genetic values are MARKER-BASED (a real GRM can later glue the wide prediction cut). Per-locus
##     effects are correlated across traits, preserving the yield<->brix trade-off from sim.R.
##   - Two TPEs (Processing = arid CA; Fresh-East = humid East) with GCA×TPE: a line's processing and
##     fresh breeding values are correlated < 1, so the Fresh market genuinely needs its own fit.
##   - A funnel across 2 cycles (years). Survivors carry forward (selected on OBSERVED means, so
##     selection bias + Bulmer variance compression are real). The design ramps (locs/reps/trait panel
##     grow). Common CHECKS appear in every trial — the connectivity glue across stages and years.
##
## Output (default data/tomato/): per-trial long CSVs, manifest.json (the trial catalog, each trial
## tagged stage/year/tpe/market), markers.csv, truth.json.
##
##   Rscript services/kernel/sim-corpus.R [outdir]

suppressWarnings(suppressPackageStartupMessages(library(jsonlite)))

## ---- small multivariate normal via Cholesky (no MASS) -------------------------------------------
.rmvn <- function(n, mu, Sigma) {
  L <- chol(Sigma)
  Z <- matrix(stats::rnorm(n * length(mu)), nrow = n)
  sweep(Z %*% L, 2, mu, "+")
}

set.seed(73)

TRAITS <- c("yield", "brix", "firmness", "fruit_wt", "maturity", "shelf_life")
## trait means (processing-tomato-ish) and target GENETIC sds
g_mean <- c(yield = 85, brix = 5.0, firmness = 40, fruit_wt = 70, maturity = 115, shelf_life = 18)
g_sd   <- c(yield = 8,  brix = 0.45, firmness = 5, fruit_wt = 7,  maturity = 3.5, shelf_life = 2.5)

## genetic correlation among traits — yield<->brix trade-off (-0.45) carried from sim.R; firmness and
## shelf_life mildly favourable with brix; fruit_wt trades against brix (big watery fruit, lower solids).
G_corr <- matrix(c(
#        yield   brix  firm  fruit   matur  shelf
         1.00, -0.45,  0.10,  0.35, -0.10,  0.05,   # yield
        -0.45,  1.00,  0.25, -0.30,  0.15,  0.20,   # brix
         0.10,  0.25,  1.00, -0.05,  0.05,  0.45,   # firmness
         0.35, -0.30, -0.05,  1.00, -0.10, -0.15,   # fruit_wt
        -0.10,  0.15,  0.05, -0.10,  1.00,  0.00,   # maturity
         0.05,  0.20,  0.45, -0.15,  0.00,  1.00),  # shelf_life
  6, 6, byrow = TRUE)
dimnames(G_corr) <- list(TRAITS, TRAITS)

## cross-TPE genetic correlation (GCA×TPE): processing vs fresh-east breeding value of the same line.
## < 1 → a top processing line is not automatically a top fresh line → Fresh-East needs its OWN fit.
CROSS_TPE_R <- 0.55

N_LOCI <- 200

## ---- marker matrix + marker-based breeding values per TPE ---------------------------------------
## Founders across 2 cycles + fixed checks. Cycle 2 introduces fresh germplasm; checks are common.
n_found_c1 <- 240
n_found_c2 <- 200
n_check    <- 6
line_ids <- c(sprintf("TOM-%04d", seq_len(n_found_c1)),
              sprintf("TOM-%04d", 1000 + seq_len(n_found_c2)),
              sprintf("CHK-%02d", seq_len(n_check)))
n_line <- length(line_ids)

## allele freqs and dosages (0/1/2)
p <- runif(N_LOCI, 0.1, 0.9)
M <- matrix(rbinom(n_line * N_LOCI, 2, rep(p, each = n_line)), nrow = n_line)
colnames(M) <- sprintf("m%03d", seq_len(N_LOCI))
rownames(M) <- line_ids
Mc <- scale(M, center = TRUE, scale = FALSE)  # centered dosages

## per-locus additive effects, correlated across traits per G_corr. Two effect sets (common + TPE-
## specific) so we can build correlated-but-distinct processing/fresh breeding values.
locus_effects <- function() {
  A <- .rmvn(N_LOCI, rep(0, length(TRAITS)), G_corr)   # n_loci x n_traits, cov ~ G_corr
  bv <- Mc %*% A                                        # n_line x n_traits (raw scale)
  ## rescale each trait column to the target genetic sd (scaling a column preserves correlations)
  for (j in seq_along(TRAITS)) bv[, j] <- bv[, j] * (g_sd[j] / sd(bv[, j]))
  bv
}
bv_common   <- locus_effects()
bv_proc_sp  <- locus_effects()
bv_fresh_sp <- locus_effects()

## TPE breeding values: sqrt(r)*common + sqrt(1-r)*specific  → cross-TPE corr ≈ CROSS_TPE_R
mk_tpe_bv <- function(specific) {
  bv <- sqrt(CROSS_TPE_R) * bv_common + sqrt(1 - CROSS_TPE_R) * specific
  for (j in seq_along(TRAITS)) bv[, j] <- bv[, j] * (g_sd[j] / sd(bv[, j]))  # keep target sds
  sweep(bv, 2, g_mean, "+")                                                  # add trait means
}
BV <- list(processing = mk_tpe_bv(bv_proc_sp), `fresh-east` = mk_tpe_bv(bv_fresh_sp))
for (tpe in names(BV)) rownames(BV[[tpe]]) <- line_ids

## ---- trial simulator ----------------------------------------------------------------------------
## GxE / residual / block sds (yield most plastic). Trait panel measured per trial passed in `traits`.
ge_sd  <- c(yield = 6, brix = 0.25, firmness = 3, fruit_wt = 3, maturity = 1.5, shelf_life = 1.2)
res_sd <- c(yield = 7, brix = 0.35, firmness = 4, fruit_wt = 5, maturity = 2.2, shelf_life = 1.6)

sim_trial <- function(entries, tpe, year, locs, reps, measured, loc_prefix) {
  bvt <- BV[[tpe]]
  env_names <- sprintf("%s-%d-L%d", loc_prefix, year, seq_len(locs))
  ## environment main effects per trait
  env_eff <- .rmvn(locs, rep(0, length(TRAITS)),
                   diag((c(yield = 12, brix = 0.6, firmness = 5, fruit_wt = 6, maturity = 4, shelf_life = 3))^2))
  rows <- list(); k <- 0
  for (e in seq_len(locs)) {
    for (r in seq_len(reps)) {
      block_shift <- stats::rnorm(length(TRAITS), 0, c(2.5, 0.12, 1.5, 1.5, 0.8, 0.6))
      for (gi in seq_along(entries)) {
        k <- k + 1
        ge  <- stats::rnorm(length(TRAITS), 0, ge_sd)
        res <- stats::rnorm(length(TRAITS), 0, res_sd)
        vals <- bvt[entries[gi], ] + env_eff[e, ] + ge + block_shift + res
        names(vals) <- TRAITS
        row <- data.frame(genotype = entries[gi], env = env_names[e],
                          block = sprintf("%s-B%d", env_names[e], r), rep = r,
                          stringsAsFactors = FALSE)
        for (tr in TRAITS) row[[tr]] <- if (tr %in% measured) round(vals[[tr]], 2) else NA_real_
        rows[[k]] <- row
      }
    }
  }
  do.call(rbind, rows)
}

## genotype trial means on the measured traits (for selection between stages)
geno_means <- function(df, traits) {
  agg <- aggregate(df[traits], by = list(genotype = df$genotype), FUN = function(x) mean(x, na.rm = TRUE))
  rownames(agg) <- agg$genotype
  agg
}
## simple selection index (z-scored, weighted, min/max by sign) on a means table
select_top <- function(means, weights, n) {
  z <- sapply(names(weights), function(tr) {
    v <- means[[tr]]; (v - mean(v)) / (sd(v) + 1e-9)
  })
  score <- rowSums(sweep(z, 2, weights, "*"))  # signed weights → direction baked in
  ord <- order(score, decreasing = TRUE)
  means$genotype[ord][seq_len(min(n, nrow(means)))]
}

CHECKS <- sprintf("CHK-%02d", seq_len(n_check))

## selection weights (sign = direction). Processing favours yield/brix/firmness/earliness;
## fresh favours fruit_wt/shelf_life/yield. maturity negative = earlier is better.
W_PROC  <- c(yield = 1.0, brix = 1.0, firmness = 0.6, maturity = -0.4)
W_FRESH <- c(yield = 0.8, fruit_wt = 1.0, shelf_life = 0.9, maturity = -0.3)

## ---- the funnel ---------------------------------------------------------------------------------
trials <- list(); manifest_trials <- list(); selection_log <- list()
add_trial <- function(id, stage, stage_label, year, tpe, market, locs, reps, design, measured, df) {
  trials[[id]] <<- df
  manifest_trials[[length(manifest_trials) + 1]] <<- list(
    trial_id = id, stage = stage, stage_label = stage_label, year = year, tpe = tpe,
    market_tag = market, location = sub("-L1$", "", sprintf("%s-L1", id)), n_entries = length(unique(df$genotype)),
    n_loc = locs, n_rep = reps, design = design, traits_measured = measured,
    file = file.path("trials", paste0(id, ".csv")))
}

## ===== Cycle 2024 =====
found_c1 <- sprintf("TOM-%04d", seq_len(n_found_c1))

## S1 Observation — all founders, central station (proc-TPE proxy), single plot. Tagged ALL (broad:
## candidate for every market). Cheap trait panel only.
s1_entries <- c(found_c1, CHECKS)
s1 <- sim_trial(s1_entries, "processing", 2024, locs = 1, reps = 1,
                measured = c("yield", "maturity", "fruit_wt"), loc_prefix = "CENTRAL")
add_trial("S1-2024-OBS", "S1", "Observation", 2024, "processing", "All", 1, 1, "single-plot",
          c("yield", "maturity", "fruit_wt"), s1)
m1 <- geno_means(s1[!s1$genotype %in% CHECKS, ], c("yield", "maturity", "fruit_wt"))
## route survivors: top 60 to processing, a (partly overlapping) top 30 by fruit type to fresh
proc_s2 <- select_top(m1, c(yield = 1.0, maturity = -0.4, fruit_wt = 0.3), 60)
fresh_s2 <- select_top(m1, c(fruit_wt = 1.0, yield = 0.6, maturity = -0.2), 30)
selection_log[["S1-2024->S2"]] <- list(processing = proc_s2, `fresh-east` = fresh_s2)

## S2 PYT — split by destination TPE. Processing PYT in CA arid; Fresh PYT in East. Tagged at the
## TPE node (Processing / Fresh-East). Quality traits come online.
s2p <- sim_trial(c(proc_s2, CHECKS), "processing", 2024, locs = 3, reps = 2,
                 measured = c("yield", "maturity", "fruit_wt", "brix", "firmness"), loc_prefix = "CA")
add_trial("S2-2024-PROC", "S2", "PYT", 2024, "processing", "Processing", 3, 2, "RCBD",
          c("yield", "maturity", "fruit_wt", "brix", "firmness"), s2p)
s2f <- sim_trial(c(fresh_s2, CHECKS), "fresh-east", 2024, locs = 3, reps = 2,
                 measured = c("yield", "maturity", "fruit_wt", "shelf_life"), loc_prefix = "EAST")
add_trial("S2-2024-FRESH", "S2", "PYT", 2024, "fresh-east", "Fresh-East", 3, 2, "RCBD",
          c("yield", "maturity", "fruit_wt", "shelf_life"), s2f)

m2p <- geno_means(s2p[!s2p$genotype %in% CHECKS, ], c("yield", "brix", "firmness", "maturity"))
m2f <- geno_means(s2f[!s2f$genotype %in% CHECKS, ], c("yield", "fruit_wt", "shelf_life", "maturity"))
proc_s3 <- select_top(m2p, W_PROC, 16)
fresh_s3 <- select_top(m2f, W_FRESH, 10)
selection_log[["S2-2024->S3"]] <- list(processing = proc_s3, `fresh-east` = fresh_s3)

## S3 AYT — full panel, many locs, more reps. Tagged at TPE node. (Brix vs Firmness are INDEX lenses
## over the SAME processing trials — one fit, two markets — so no separate Brix/Firmness trials.)
s3p <- sim_trial(c(proc_s3, CHECKS), "processing", 2024, locs = 6, reps = 3,
                 measured = TRAITS, loc_prefix = "CA")
add_trial("S3-2024-PROC", "S3", "AYT", 2024, "processing", "Processing", 6, 3, "MET",
          TRAITS, s3p)
s3f <- sim_trial(c(fresh_s3, CHECKS), "fresh-east", 2024, locs = 6, reps = 3,
                 measured = TRAITS, loc_prefix = "EAST")
add_trial("S3-2024-FRESH", "S3", "AYT", 2024, "fresh-east", "Fresh-East", 6, 3, "MET",
          TRAITS, s3f)

m3p <- geno_means(s3p[!s3p$genotype %in% CHECKS, ], c("yield", "brix", "firmness", "maturity"))
m3f <- geno_means(s3f[!s3f$genotype %in% CHECKS, ], c("yield", "fruit_wt", "shelf_life", "maturity"))
proc_s4 <- select_top(m3p, W_PROC, 5)
fresh_s4 <- select_top(m3f, W_FRESH, 4)
selection_log[["S3-2024->S4"]] <- list(processing = proc_s4, `fresh-east` = fresh_s4)

## ===== Cycle 2025 =====
## S4 Pre-commercial — 2024 survivors carried to wide on-farm strips (connectivity across YEARS via
## survivors + checks). + processing/shelf traits emphasised.
s4p <- sim_trial(c(proc_s4, CHECKS), "processing", 2025, locs = 10, reps = 2,
                 measured = TRAITS, loc_prefix = "CAFARM")
add_trial("S4-2025-PROC", "S4", "Pre-commercial", 2025, "processing", "Processing", 10, 2, "on-farm strips",
          TRAITS, s4p)
s4f <- sim_trial(c(fresh_s4, CHECKS), "fresh-east", 2025, locs = 8, reps = 2,
                 measured = TRAITS, loc_prefix = "EASTFARM")
add_trial("S4-2025-FRESH", "S4", "Pre-commercial", 2025, "fresh-east", "Fresh-East", 8, 2, "on-farm strips",
          TRAITS, s4f)

## New S1 for cycle 2025 (fresh germplasm enters the top of the funnel) — keeps the program "alive".
found_c2 <- sprintf("TOM-%04d", 1000 + seq_len(n_found_c2))
s1b <- sim_trial(c(found_c2, CHECKS), "processing", 2025, locs = 1, reps = 1,
                 measured = c("yield", "maturity", "fruit_wt"), loc_prefix = "CENTRAL")
add_trial("S1-2025-OBS", "S1", "Observation", 2025, "processing", "All", 1, 1, "single-plot",
          c("yield", "maturity", "fruit_wt"), s1b)

## ---- write outputs ------------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)
self_dir <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)])
              if (length(f)) dirname(normalizePath(f)) else "." }
outdir <- if (length(args) >= 1) args[1] else normalizePath(file.path(self_dir, "..", "..", "data", "tomato"), mustWork = FALSE)
dir.create(file.path(outdir, "trials"), recursive = TRUE, showWarnings = FALSE)

for (id in names(trials)) write.csv(trials[[id]], file.path(outdir, "trials", paste0(id, ".csv")), row.names = FALSE)

## markers.csv (genotype, m001..mNNN)
mk_df <- data.frame(genotype = rownames(M), M, check.names = FALSE, stringsAsFactors = FALSE)
write.csv(mk_df, file.path(outdir, "markers.csv"), row.names = FALSE)

## manifest.json — the trial catalog + the market hierarchy the cut model reads.
manifest <- list(
  program = "Verdant tomato (synthetic)",
  generated_by = "services/kernel/sim-corpus.R",
  traits = TRAITS,
  tpes = list(
    processing = list(label = "Processing (arid CA)", description = "Arid California processing environments."),
    `fresh-east` = list(label = "Fresh-market East (humid)", description = "Humid eastern fresh-market environments; own fit (GCA×E).")),
  ## market hierarchy: trials are tagged at a NODE; a market cut = trials tagged with it or an ancestor.
  ## Leaf processing markets (Brix/Firmness) are INDEX lenses over the shared Processing fit.
  market_hierarchy = list(
    All = list(parent = NA, tpe = NA, label = "All markets (early screen)"),
    Processing = list(parent = "All", tpe = "processing", label = "Processing program"),
    `Fresh-East` = list(parent = "All", tpe = "fresh-east", label = "Fresh-market East")),
  markets = list(
    `Proc-Brix`  = list(tag = "Processing", tpe = "processing", label = "Processing · Brix",
                        weights = list(brix = 0.45, yield = 0.30, firmness = 0.15, maturity = -0.10)),
    `Proc-Firmness` = list(tag = "Processing", tpe = "processing", label = "Processing · Firmness",
                        weights = list(firmness = 0.45, yield = 0.30, brix = 0.15, maturity = -0.10)),
    `Fresh-East` = list(tag = "Fresh-East", tpe = "fresh-east", label = "Fresh-market · East",
                        weights = list(fruit_wt = 0.35, shelf_life = 0.30, yield = 0.25, maturity = -0.10))),
  trials = unname(manifest_trials))
write_json(manifest, file.path(outdir, "manifest.json"), auto_unbox = TRUE, pretty = TRUE, na = "null")

## truth.json — known truth for validation/teaching.
truth <- list(
  traits = TRAITS, g_mean = as.list(g_mean), g_sd = as.list(g_sd),
  G_corr = G_corr, cross_tpe_r = CROSS_TPE_R, n_loci = N_LOCI,
  true_bv = lapply(BV, function(b) {
    d <- as.data.frame(b); d$genotype <- rownames(b); d[, c("genotype", TRAITS)] }),
  selection_log = selection_log,
  checks = CHECKS)
write_json(truth, file.path(outdir, "truth.json"), auto_unbox = TRUE, pretty = TRUE, digits = 5, na = "null")

cat(sprintf("tomato corpus → %s\n  %d trials, %d genotypes, %d markers\n",
            outdir, length(trials), n_line, N_LOCI))
for (mt in manifest_trials)
  cat(sprintf("  %-14s %s %d %-11s tag=%-11s entries=%d loc=%d rep=%d\n",
              mt$trial_id, mt$stage, mt$year, mt$tpe, mt$market_tag, mt$n_entries, mt$n_loc, mt$n_rep))
