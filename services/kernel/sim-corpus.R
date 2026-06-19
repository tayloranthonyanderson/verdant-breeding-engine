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
## per-locus additive effects (correlated across traits per G_corr), KEPT (not generated-and-discarded)
## so appended germplasm — the recycling pools below — can be scored on the SAME genetic architecture.
## Two effect sets (common + TPE-specific) build correlated-but-distinct processing/fresh breeding values.
center_vec <- colMeans(M)                                       # the funnel's per-locus mean dosage
draw_A <- function() .rmvn(N_LOCI, rep(0, length(TRAITS)), G_corr)   # n_loci x n_traits, cov ~ G_corr
A_set  <- list(common = draw_A(), proc = draw_A(), fresh = draw_A())  # 3 draws — same RNG order as before
.colbv <- function(Msub, A) sweep(Msub, 2, center_vec, "-") %*% A
.cscl  <- lapply(A_set, function(A) g_sd / apply(.colbv(M, A), 2, sd))  # per-trait scale, from the funnel lines
## the three scaled effect-set BVs for any marker matrix (identical to the old locus_effects() on the funnel)
effset_bv <- function(Msub) setNames(lapply(names(A_set), function(k) sweep(.colbv(Msub, A_set[[k]]), 2, .cscl[[k]], "*")), names(A_set))
bvo <- effset_bv(M); bv_common <- bvo$common; bv_proc_sp <- bvo$proc; bv_fresh_sp <- bvo$fresh

## TPE breeding values: sqrt(r)*common + sqrt(1-r)*specific → cross-TPE corr ≈ CROSS_TPE_R. Scale factors
## come from the funnel lines so appended germplasm lands on the same scale.
.tcomb <- function(common, specific) sqrt(CROSS_TPE_R) * common + sqrt(1 - CROSS_TPE_R) * specific
.tscl  <- list(processing = g_sd / apply(.tcomb(bv_common, bv_proc_sp), 2, sd),
               `fresh-east` = g_sd / apply(.tcomb(bv_common, bv_fresh_sp), 2, sd))
tpe_bv <- function(common, specific, tpe) sweep(sweep(.tcomb(common, specific), 2, .tscl[[tpe]], "*"), 2, g_mean, "+")
BV <- list(processing = tpe_bv(bv_common, bv_proc_sp, "processing"),
           `fresh-east` = tpe_bv(bv_common, bv_fresh_sp, "fresh-east"))
for (tpe in names(BV)) rownames(BV[[tpe]]) <- line_ids
## processing BV for APPENDED germplasm (consistent scale with the funnel) — used by the recycling pools.
proc_bv_for <- function(Msub) { b <- effset_bv(Msub); m <- tpe_bv(b$common, b$proc, "processing"); rownames(m) <- rownames(Msub); m }

## ---- trial simulator ----------------------------------------------------------------------------
## GxE / residual / block sds (yield most plastic). Trait panel measured per trial passed in `traits`.
ge_sd  <- c(yield = 6, brix = 0.25, firmness = 3, fruit_wt = 3, maturity = 1.5, shelf_life = 1.2)
res_sd <- c(yield = 7, brix = 0.35, firmness = 4, fruit_wt = 5, maturity = 2.2, shelf_life = 1.6)
## spatial field-trend amplitude per trait — a smooth row×col surface SpATS can recover (the reason a
## field layout exists at all). Comparable to block/residual, not dominating.
spat_sd <- c(yield = 5, brix = 0.30, firmness = 3, fruit_wt = 4, maturity = 2, shelf_life = 1.5)

sim_trial <- function(entries, tpe, year, locs, reps, measured, loc_prefix) {
  bvt <- BV[[tpe]]
  env_names <- sprintf("%s-%d-L%d", loc_prefix, year, seq_len(locs))
  ## environment main effects per trait
  env_eff <- .rmvn(locs, rep(0, length(TRAITS)),
                   diag((c(yield = 12, brix = 0.6, firmness = 5, fruit_wt = 6, maturity = 4, shelf_life = 3))^2))
  rows <- list(); k <- 0
  for (e in seq_len(locs)) {
    ## FIELD LAYOUT: place every plot in this environment (entries × reps) on a row×col grid, in random
    ## order, and add a smooth low-frequency field surface (so spatial de-trending is meaningful).
    np <- length(entries) * reps
    ncol <- ceiling(sqrt(np)); nrowg <- ceiling(np / ncol)
    w <- stats::rnorm(3)                       # this field's surface shape
    plot_order <- sample.int(np)               # randomized layout (genotypes not clustered by index)
    block_shift <- lapply(seq_len(reps), function(r) stats::rnorm(length(TRAITS), 0, c(2.5, 0.12, 1.5, 1.5, 0.8, 0.6)))
    p <- 0
    for (r in seq_len(reps)) {
      for (gi in seq_along(entries)) {
        k <- k + 1; p <- p + 1
        pos <- plot_order[p]
        rr <- ((pos - 1) %/% ncol) + 1L; cc <- ((pos - 1) %% ncol) + 1L
        surf <- sin(pi * rr / (nrowg + 1)) * w[1] + sin(pi * cc / (ncol + 1)) * w[2] +
                sin(pi * rr / (nrowg + 1)) * sin(2 * pi * cc / (ncol + 1)) * w[3]
        ge  <- stats::rnorm(length(TRAITS), 0, ge_sd)
        res <- stats::rnorm(length(TRAITS), 0, res_sd)
        vals <- bvt[entries[gi], ] + env_eff[e, ] + ge + block_shift[[r]] + surf * spat_sd + res
        names(vals) <- TRAITS
        row <- data.frame(genotype = entries[gi], env = env_names[e],
                          block = sprintf("%s-B%d", env_names[e], r), rep = r, row = rr, col = cc,
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
## PROGRESSIVE NARROWING: at S3 the processing program clarifies into SPECIFIC market targets — a
## Brix-focused AYT and a Firmness-focused AYT, each advancing the lines best for that target (with
## natural overlap for all-rounders). Late trials are tagged at the LEAF market, not the TPE.
brix_s3 <- select_top(m2p, c(yield = 1.0, brix = 1.3, maturity = -0.4), 13)
firm_s3 <- select_top(m2p, c(yield = 1.0, firmness = 1.3, maturity = -0.4), 13)
fresh_s3 <- select_top(m2f, W_FRESH, 10)
selection_log[["S2-2024->S3"]] <- list(`Proc-Brix` = brix_s3, `Proc-Firmness` = firm_s3, East = fresh_s3)

## S3 AYT — full panel, many locs. Processing splits into market-specific trials (tag = leaf market).
s3b <- sim_trial(c(brix_s3, CHECKS), "processing", 2024, locs = 6, reps = 3, measured = TRAITS, loc_prefix = "CA")
add_trial("S3-2024-BRIX", "S3", "AYT", 2024, "processing", "Proc-Brix", 6, 3, "MET", TRAITS, s3b)
s3fm <- sim_trial(c(firm_s3, CHECKS), "processing", 2024, locs = 6, reps = 3, measured = TRAITS, loc_prefix = "CA")
add_trial("S3-2024-FIRM", "S3", "AYT", 2024, "processing", "Proc-Firmness", 6, 3, "MET", TRAITS, s3fm)
s3f <- sim_trial(c(fresh_s3, CHECKS), "fresh-east", 2024, locs = 6, reps = 3, measured = TRAITS, loc_prefix = "EAST")
add_trial("S3-2024-FRESH", "S3", "AYT", 2024, "fresh-east", "East", 6, 3, "MET", TRAITS, s3f)

m3b <- geno_means(s3b[!s3b$genotype %in% CHECKS, ], c("yield", "brix", "firmness", "maturity"))
m3fm <- geno_means(s3fm[!s3fm$genotype %in% CHECKS, ], c("yield", "brix", "firmness", "maturity"))
m3f <- geno_means(s3f[!s3f$genotype %in% CHECKS, ], c("yield", "fruit_wt", "shelf_life", "maturity"))
brix_s4 <- select_top(m3b, c(yield = 1.0, brix = 1.3, maturity = -0.4), 5)
firm_s4 <- select_top(m3fm, c(yield = 1.0, firmness = 1.3, maturity = -0.4), 5)
fresh_s4 <- select_top(m3f, W_FRESH, 4)
selection_log[["S3-2024->S4"]] <- list(`Proc-Brix` = brix_s4, `Proc-Firmness` = firm_s4, East = fresh_s4)

## ===== Cycle 2025 =====
## S4 Pre-commercial — 2024 survivors to wide on-farm strips (cross-YEAR connectivity via survivors +
## checks). Still market-specific (leaf tags).
s4b <- sim_trial(c(brix_s4, CHECKS), "processing", 2025, locs = 10, reps = 2, measured = TRAITS, loc_prefix = "CAFARM")
add_trial("S4-2025-BRIX", "S4", "Pre-commercial", 2025, "processing", "Proc-Brix", 10, 2, "on-farm strips", TRAITS, s4b)
s4fm <- sim_trial(c(firm_s4, CHECKS), "processing", 2025, locs = 10, reps = 2, measured = TRAITS, loc_prefix = "CAFARM")
add_trial("S4-2025-FIRM", "S4", "Pre-commercial", 2025, "processing", "Proc-Firmness", 10, 2, "on-farm strips", TRAITS, s4fm)
s4f <- sim_trial(c(fresh_s4, CHECKS), "fresh-east", 2025, locs = 8, reps = 2, measured = TRAITS, loc_prefix = "EASTFARM")
add_trial("S4-2025-FRESH", "S4", "Pre-commercial", 2025, "fresh-east", "East", 8, 2, "on-farm strips", TRAITS, s4f)

## New S1 for cycle 2025 (fresh germplasm enters the top of the funnel) — keeps the program "alive".
found_c2 <- sprintf("TOM-%04d", 1000 + seq_len(n_found_c2))
s1b <- sim_trial(c(found_c2, CHECKS), "processing", 2025, locs = 1, reps = 1,
                 measured = c("yield", "maturity", "fruit_wt"), loc_prefix = "CENTRAL")
add_trial("S1-2025-OBS", "S1", "Observation", 2025, "processing", "All", 1, 1, "single-plot",
          c("yield", "maturity", "fruit_wt"), s1b)

## ===== Heterotic pools for WITHIN-POOL recycling (ADR-0024 mode 2) + the hybrid testcross =====
## Each pool is FOUNDED by a dozen+ inbreds and grown by within-pool crossing, so it carries real FAMILY
## STRUCTURE (full/half sibs share haplotypes). That gives the GRM genuine relatedness and makes the
## gain↔diversity tension REAL — a strong founder spawns a strong, RELATED family, so chasing gain
## concentrates kinship (exactly what optimal-contribution selection exists to manage). The two pools are
## genetically DIVERGENT (pool-specific allele freqs at a subset of loci) → distinct heterotic groups:
## across-pool A×B is the product cross (mode 1), within-pool line×line is recycling (mode 2). Drawn LAST,
## so every earlier (funnel) trial's RNG and CSV is unchanged.
set.seed(910)
N_FOUND_POOL <- 16     # founder inbreds per pool (≥ a dozen, as requested)
N_LINE_POOL  <- 60     # current-generation inbred lines per pool (much bigger than the old 12)
N_DIVERGENT  <- 60     # loci differentiating the pools (heterotic divergence)
RES_LOCUS    <- "m007" # marker standing in for the native disease-resistance gene (the native-trait gate)

div_loci  <- sample.int(N_LOCI, N_DIVERGENT)
pool_freq <- function(shift) { pp <- p; pp[div_loci] <- pmin(0.95, pmax(0.05, pp[div_loci] + shift)); pp }
descend   <- function(pa, pb) { g1 <- rbinom(N_LOCI, 1, pa / 2); g2 <- rbinom(N_LOCI, 1, pb / 2)
  2L * ifelse(runif(N_LOCI) < 0.5, g1, g2) }   # DH-like inbred: homozygous for a sampled parental gamete
build_pool <- function(tag, shift) {
  Fdr <- matrix(rbinom(N_FOUND_POOL * N_LOCI, 2, rep(pool_freq(shift), each = N_FOUND_POOL)), nrow = N_FOUND_POOL)
  ncx <- ceiling(N_LINE_POOL / 3); cr <- t(sapply(seq_len(ncx), function(.) sample.int(N_FOUND_POOL, 2)))
  rows <- list(); par <- character(0); li <- 0
  for (cx in seq_len(ncx)) for (s in seq_len(sample(2:4, 1))) {        # 2–4 full sibs per founder cross → families
    li <- li + 1; rows[[li]] <- descend(Fdr[cr[cx, 1], ], Fdr[cr[cx, 2], ])
    par[li] <- sprintf("%s-F%02d×%s-F%02d", tag, cr[cx, 1], tag, cr[cx, 2]) }
  L <- do.call(rbind, rows)[seq_len(N_LINE_POOL), , drop = FALSE]
  rownames(L) <- sprintf("%s-%03d", tag, seq_len(N_LINE_POOL)); colnames(L) <- colnames(M)
  list(M = L, parents = par[seq_len(N_LINE_POOL)])
}
pA <- build_pool("PLA", +0.28); pB <- build_pool("PLB", -0.28)
M_pool  <- rbind(pA$M, pB$M)
pool_of <- setNames(c(rep("Pool A", N_LINE_POOL), rep("Pool B", N_LINE_POOL)), rownames(M_pool))
bv_pool <- proc_bv_for(M_pool)                                   # processing BV, same architecture as the funnel
perse_z <- { z <- sapply(names(W_PROC), function(tr) { v <- bv_pool[, tr]; (v - mean(v)) / (sd(v) + 1e-9) })
            setNames(rowSums(sweep(z, 2, W_PROC, "*")), rownames(M_pool)) }   # per-se processing index per line

## inbred-line facts (heterotic pool / per-se merit / native disease trait / founder parents). The full
## pools feed within-pool recycling; per_se is the line's own processing merit; the native trait is
## carriage of the resistance allele at RES_LOCUS — the dual-source gate (ADR-0020).
inbreds <- data.frame(name = rownames(M_pool), role = "line", pool = unname(pool_of),
                      per_se = round(unname(perse_z), 3), nclb = as.integer(M_pool[, RES_LOCUS] >= 1),
                      parents = unname(c(pA$parents, pB$parents)), stringsAsFactors = FALSE)

## testcross a representative ELITE sample of each pool (top by per-se) to common testers → the GCA trial
## that feeds the across-pool PRODUCT cross. F1 = mid-parent + GCA + SCA + heterosis + MET noise (so the
## kernel recovers a high Baker's ratio + a per-se↔GCA divergence). The full pools above feed recycling.
tc_n        <- 18
elite_tc    <- unlist(lapply(c("Pool A", "Pool B"), function(pl) { m <- names(pool_of)[pool_of == pl]; m[order(-perse_z[m])][seq_len(tc_n)] }))
tester_ids  <- found_c1[1:3]                                     # 3 common inbred testers (from the funnel)
BV_proc_all <- rbind(BV[["processing"]], bv_pool)                # testcross BV table spans funnel + pools

sim_hybrid <- function(lines, testers, year, locs, reps, measured, loc_prefix, bvt) {
  het    <- c(yield = 7, brix = 0.05, firmness = 0.5, fruit_wt = 5, maturity = -1, shelf_life = 0.3)  # F1 vigour
  sca_sd <- c(yield = 2.0, brix = 0.12, firmness = 1.3, fruit_wt = 1.8, maturity = 0.9, shelf_life = 0.6)
  cr  <- expand.grid(line = lines, tester = testers, stringsAsFactors = FALSE)
  sca <- sapply(TRAITS, function(tr) stats::rnorm(nrow(cr), 0, sca_sd[[tr]]))   # fixed SCA per cross×trait
  rownames(sca) <- paste(cr$line, cr$tester, sep = "x")
  env_names <- sprintf("%s-%d-L%d", loc_prefix, year, seq_len(locs))
  env_eff <- .rmvn(locs, rep(0, length(TRAITS)),
                   diag((c(yield = 12, brix = 0.6, firmness = 5, fruit_wt = 6, maturity = 4, shelf_life = 3))^2))
  rows <- list(); k <- 0
  for (e in seq_len(locs)) {
    np <- nrow(cr) * reps; ncol <- ceiling(sqrt(np)); nrowg <- ceiling(np / ncol)
    w <- stats::rnorm(3); plot_order <- sample.int(np)
    block_shift <- lapply(seq_len(reps), function(r) stats::rnorm(length(TRAITS), 0, c(2.5, 0.12, 1.5, 1.5, 0.8, 0.6)))
    p <- 0
    for (r in seq_len(reps)) for (ci in seq_len(nrow(cr))) {
      k <- k + 1; p <- p + 1; pos <- plot_order[p]
      rr <- ((pos - 1) %/% ncol) + 1L; cc <- ((pos - 1) %% ncol) + 1L
      surf <- sin(pi * rr / (nrowg + 1)) * w[1] + sin(pi * cc / (ncol + 1)) * w[2] +
              sin(pi * rr / (nrowg + 1)) * sin(2 * pi * cc / (ncol + 1)) * w[3]
      L <- cr$line[ci]; Tt <- cr$tester[ci]
      gca <- 0.5 * (bvt[L, ] - g_mean) + 0.5 * (bvt[Tt, ] - g_mean)   # F1 inherits half of each parent
      ge  <- stats::rnorm(length(TRAITS), 0, ge_sd); res <- stats::rnorm(length(TRAITS), 0, res_sd)
      vals <- g_mean + het + gca + sca[paste(L, Tt, sep = "x"), ] + env_eff[e, ] + block_shift[[r]] + surf * spat_sd + res
      names(vals) <- TRAITS
      row <- data.frame(genotype = paste(L, Tt, sep = "x"), parent1 = L, parent2 = Tt, env = env_names[e],
                        block = sprintf("%s-B%d", env_names[e], r), rep = r, row = rr, col = cc, stringsAsFactors = FALSE)
      for (tr in TRAITS) row[[tr]] <- if (tr %in% measured) round(vals[[tr]], 2) else NA_real_
      rows[[k]] <- row
    }
  }
  do.call(rbind, rows)
}
ht <- sim_hybrid(elite_tc, tester_ids, 2024, locs = 3, reps = 2, measured = TRAITS, loc_prefix = "CAHYB", bvt = BV_proc_all)
add_trial("S3-2024-TXH", "S3", "Testcross (GCA)", 2024, "processing", "Proc-Hybrid", 3, 2, "line×tester MET", TRAITS, ht)

## ---- write outputs ------------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)
self_dir <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)])
              if (length(f)) dirname(normalizePath(f)) else "." }
outdir <- if (length(args) >= 1) args[1] else normalizePath(file.path(self_dir, "..", "..", "data", "tomato"), mustWork = FALSE)
dir.create(file.path(outdir, "trials"), recursive = TRUE, showWarnings = FALSE)

for (id in names(trials)) write.csv(trials[[id]], file.path(outdir, "trials", paste0(id, ".csv")), row.names = FALSE)

## markers.csv (genotype, m001..mNNN) — the funnel lines + the recycling-pool inbreds (founder descendants)
M_all <- rbind(M, M_pool)
mk_df <- data.frame(genotype = rownames(M_all), M_all, check.names = FALSE, stringsAsFactors = FALSE)
write.csv(mk_df, file.path(outdir, "markers.csv"), row.names = FALSE)

## inbreds.csv — combining-ability inbred facts for the testcross lines (pool / per-se / native trait).
write.csv(inbreds, file.path(outdir, "inbreds.csv"), row.names = FALSE)

## manifest.json — the trial catalog + the MARKET-TARGET HIERARCHY (ADR-0023). A single tree of nodes;
## trials are tagged to a node; the breeder composes a cut by multi-selecting any set of nodes (the cut
## is the union of trials tagged to the selected nodes). Nodes carrying `weights` are RANKABLE markets
## (the leaves); inner nodes (All, the TPEs) are grouping levels material narrows through.
manifest <- list(
  program = "Verdant tomato (synthetic)",
  generated_by = "services/kernel/sim-corpus.R",
  traits = TRAITS,
  tpes = list(
    processing = list(label = "Processing (arid CA)"),
    `fresh-east` = list(label = "Fresh-market East (humid)")),
  hierarchy = list(
    All            = list(parent = NA,           tpe = NA,           label = "All markets (early screen)"),
    Processing     = list(parent = "All",        tpe = "processing", label = "Processing · arid CA"),
    `Proc-Brix`    = list(parent = "Processing", tpe = "processing", label = "Processing · Brix",
                          weights = list(brix = 0.45, yield = 0.30, firmness = 0.15, maturity = -0.10)),
    `Proc-Firmness`= list(parent = "Processing", tpe = "processing", label = "Processing · Firmness",
                          weights = list(firmness = 0.45, yield = 0.30, brix = 0.15, maturity = -0.10)),
    `Proc-Hybrid`  = list(parent = "Processing", tpe = "processing", label = "Processing · hybrid testcross (GCA)",
                          weights = list(yield = 0.40, brix = 0.25, firmness = 0.20, maturity = -0.15)),
    `Fresh-East`   = list(parent = "All",        tpe = "fresh-east", label = "Fresh-market East · humid"),
    East           = list(parent = "Fresh-East", tpe = "fresh-east", label = "Fresh-market · East",
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

cat(sprintf("tomato corpus → %s\n  %d trials, %d funnel + %d pool genotypes, %d markers\n  pools: 2 × %d lines from %d founders each\n",
            outdir, length(trials), n_line, nrow(M_pool), N_LOCI, N_LINE_POOL, N_FOUND_POOL))
for (mt in manifest_trials)
  cat(sprintf("  %-14s %s %d %-11s tag=%-11s entries=%d loc=%d rep=%d\n",
              mt$trial_id, mt$stage, mt$year, mt$tpe, mt$market_tag, mt$n_entries, mt$n_loc, mt$n_rep))
