## sim-corpus.R — synthetic tomato HYBRID breeding program with known truth (extends sim.R from one MET
## to a staged, multi-year, multi-market funnel). IP-clean: fully simulated (ADR-0008). Pure base R
## + jsonlite. The corpus the product demos a *program* on, and the substrate for the data-cut model
## (docs/sim-corpus-spec.md, ADR-0023).
##
## HYBRID-ONLY (ADR-0025): tomato is an F1 crop, so EVERY trial is a TESTCROSS — candidate inbreds (drawn
## from the two heterotic pools) crossed to a small set of common testers, grown as F1 hybrids with known
## parentage. There is no per-se line trial and no separate "testcross" node: GCA/SCA are estimable from
## ANY composed cut (every cut is hybrid), and the crossing module reads GCA off whatever cut the breeder
## composes. A candidate's per-se merit survives as a PARENT ATTRIBUTE (per TPE) so the per-se↔GCA
## divergence is still teachable. The sparse line×tester design leaves elite×elite product crosses UNMADE
## — those are the hybrid-prediction target.
##
## What it builds:
##   - Genetic values are MARKER-BASED (a real GRM can later glue the wide prediction cut). Per-locus
##     effects are correlated across traits, preserving the yield<->brix trade-off from sim.R.
##   - Two TPEs (Processing = arid CA; Fresh-East = humid East) with GCA×TPE: a parent's processing and
##     fresh general combining abilities are correlated < 1, so the Fresh market genuinely needs its own fit.
##   - A funnel across 2 cycles (years). Surviving CANDIDATES carry forward (selected on OBSERVED testcross
##     means, so selection bias + Bulmer variance compression are real). The design ramps (locs/reps/trait
##     panel grow). Common TESTERS appear in every trial — the connectivity glue across stages and years.
##
## Output (default data/tomato/): per-trial long CSVs (each carrying parent1/parent2), manifest.json (the
## trial catalog, each trial tagged stage/year/tpe/market), markers.csv, inbreds.csv, truth.json.
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

## cross-TPE genetic correlation (GCA×TPE): processing vs fresh-east breeding value of the same parent.
## < 1 → a top processing parent is not automatically a top fresh parent → Fresh-East needs its OWN fit.
CROSS_TPE_R <- 0.55

N_LOCI <- 200

## ---- marker matrix + marker-based breeding values per TPE ---------------------------------------
## A genetic-architecture backbone (founders + fixed testers). The pools below are scored on the SAME
## per-locus effects so candidates land on the funnel's scale. Cycle 2 introduces fresh germplasm.
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
## so appended germplasm — the heterotic pools below — can be scored on the SAME genetic architecture.
## Two effect sets (common + TPE-specific) build correlated-but-distinct processing/fresh breeding values.
center_vec <- colMeans(M)                                       # the backbone's per-locus mean dosage
draw_A <- function() .rmvn(N_LOCI, rep(0, length(TRAITS)), G_corr)   # n_loci x n_traits, cov ~ G_corr
A_set  <- list(common = draw_A(), proc = draw_A(), fresh = draw_A())  # 3 draws — same RNG order as before
.colbv <- function(Msub, A) sweep(Msub, 2, center_vec, "-") %*% A
.cscl  <- lapply(A_set, function(A) g_sd / apply(.colbv(M, A), 2, sd))  # per-trait scale, from the backbone
## the three scaled effect-set BVs for any marker matrix (identical to the old locus_effects() on the backbone)
effset_bv <- function(Msub) setNames(lapply(names(A_set), function(k) sweep(.colbv(Msub, A_set[[k]]), 2, .cscl[[k]], "*")), names(A_set))
bvo <- effset_bv(M); bv_common <- bvo$common; bv_proc_sp <- bvo$proc; bv_fresh_sp <- bvo$fresh

## TPE breeding values: sqrt(r)*common + sqrt(1-r)*specific → cross-TPE corr ≈ CROSS_TPE_R. Scale factors
## come from the backbone lines so appended germplasm lands on the same scale.
.tcomb <- function(common, specific) sqrt(CROSS_TPE_R) * common + sqrt(1 - CROSS_TPE_R) * specific
.tscl  <- list(processing = g_sd / apply(.tcomb(bv_common, bv_proc_sp), 2, sd),
               `fresh-east` = g_sd / apply(.tcomb(bv_common, bv_fresh_sp), 2, sd))
tpe_bv <- function(common, specific, tpe) sweep(sweep(.tcomb(common, specific), 2, .tscl[[tpe]], "*"), 2, g_mean, "+")
BV <- list(processing = tpe_bv(bv_common, bv_proc_sp, "processing"),
           `fresh-east` = tpe_bv(bv_common, bv_fresh_sp, "fresh-east"))
for (tpe in names(BV)) rownames(BV[[tpe]]) <- line_ids
## TPE BV for APPENDED germplasm (consistent scale with the backbone) — used by the pools/candidates. Both
## TPEs available, so a pool line carries a processing AND a fresh-east breeding value (GCA×TPE applies).
bv_for <- function(Msub, tpe) { b <- effset_bv(Msub)
  spec <- if (tpe == "processing") b$proc else b$fresh
  m <- tpe_bv(b$common, spec, tpe); rownames(m) <- rownames(Msub); m }

## ---- trial noise + selection helpers ------------------------------------------------------------
## GxE / residual / block sds (yield most plastic). Trait panel measured per trial passed in `measured`.
ge_sd  <- c(yield = 6, brix = 0.25, firmness = 3, fruit_wt = 3, maturity = 1.5, shelf_life = 1.2)
res_sd <- c(yield = 7, brix = 0.35, firmness = 4, fruit_wt = 5, maturity = 2.2, shelf_life = 1.6)
## spatial field-trend amplitude per trait — a smooth row×col surface SpATS can recover (the reason a
## field layout exists at all). Comparable to block/residual, not dominating.
spat_sd <- c(yield = 5, brix = 0.30, firmness = 3, fruit_wt = 4, maturity = 2, shelf_life = 1.5)

## candidate (parent) means on the measured traits — selection between stages is on a parent's mean
## TESTCROSS performance (its GCA proxy), so survivors are chosen on combining ability, not per se.
cand_means <- function(df, traits) {
  agg <- aggregate(df[traits], by = list(genotype = df$parent1), FUN = function(x) mean(x, na.rm = TRUE))
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
## POOL-BALANCED selection — advance the best n/2 candidates from EACH heterotic pool. A hybrid program
## maintains both pools in parallel (you need both to make A×B product crosses), so every stage carries
## both pools, not just whichever pool is stronger per se. Uses the global pool_of (defined with the pools).
select_top_bal <- function(means, weights, n) {
  pls <- sort(unique(pool_of[means$genotype]))
  per <- ceiling(n / length(pls))
  picks <- unlist(lapply(pls, function(pl) {
    sub <- means[pool_of[means$genotype] == pl, , drop = FALSE]
    select_top(sub, weights, per) }))
  picks[seq_len(min(n, length(picks)))]
}

## selection weights (sign = direction). Processing favours yield/brix/firmness/earliness;
## fresh favours fruit_wt/shelf_life/yield. maturity negative = earlier is better.
W_PROC  <- c(yield = 1.0, brix = 1.0, firmness = 0.6, maturity = -0.4)
W_FRESH <- c(yield = 0.8, fruit_wt = 1.0, shelf_life = 0.9, maturity = -0.3)

## ===== Heterotic pools (the PARENTS) — built FIRST, since the whole funnel is their testcrosses =====
## Each pool is FOUNDED by a dozen+ inbreds and grown by within-pool crossing, so it carries real FAMILY
## STRUCTURE (full/half sibs share haplotypes). That gives the GRM genuine relatedness and makes the
## gain↔diversity tension REAL — a strong founder spawns a strong, RELATED family, so chasing gain
## concentrates kinship (exactly what optimal-contribution selection exists to manage). The two pools are
## genetically DIVERGENT (pool-specific allele freqs at a subset of loci) → distinct heterotic groups:
## across-pool A×B is the product cross (mode 1), within-pool line×line is recycling (mode 2).
set.seed(910)
N_FOUND_POOL <- 16     # founder inbreds per pool (≥ a dozen)
N_LINE_POOL  <- 60     # current-generation inbred lines per pool (the full recycling roster)
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

## per-se merit per TPE (a PARENT ATTRIBUTE — the per-se↔GCA divergence is now a parent fact, not a trial).
bv_pool   <- list(processing = bv_for(M_pool, "processing"), `fresh-east` = bv_for(M_pool, "fresh-east"))
perse_idx <- function(bv, W) { z <- sapply(names(W), function(tr) { v <- bv[, tr]; (v - mean(v)) / (sd(v) + 1e-9) })
  setNames(rowSums(sweep(z, 2, W, "*")), rownames(bv)) }
perse_proc  <- perse_idx(bv_pool$processing, W_PROC)
perse_fresh <- perse_idx(bv_pool$`fresh-east`, W_FRESH)

## ===== Candidates + testers + the F1 testcross simulator =========================================
## Candidates = elite pool lines (BOTH pools) that get testcrossed through the funnel. A small common
## tester set (drawn from the backbone) appears in every trial → the connectivity glue across stages/years
## AND the line×tester structure that makes GCA identifiable from any single cut. Each candidate sits in
## only ~3 crosses (sparse), so elite×elite product hybrids stay UNMADE — the hybrid-prediction target.
n_cand   <- 24                                                  # elite candidates per pool for the 2024 funnel
n_cand25 <- 12                                                  # new candidates entering at the top in 2025
ord_A <- { m <- names(pool_of)[pool_of == "Pool A"]; m[order(-perse_proc[m])] }
ord_B <- { m <- names(pool_of)[pool_of == "Pool B"]; m[order(-perse_proc[m])] }
cand    <- c(ord_A[seq_len(n_cand)],                ord_B[seq_len(n_cand)])
cand25  <- c(ord_A[n_cand + seq_len(n_cand25)],     ord_B[n_cand + seq_len(n_cand25)])
testers <- sprintf("TOM-%04d", 1:3)                             # 3 common inbred testers (from the backbone)

## BV tables spanning every entity that can appear in a cross (testers + all pool candidates), per TPE.
BV_all <- list(processing  = rbind(BV[["processing"]],  bv_pool[["processing"]]),
               `fresh-east` = rbind(BV[["fresh-east"]], bv_pool[["fresh-east"]]))

## STABLE per-cross SCA + F1 vigour, drawn ONCE for every candidate×tester so a cross is genetically
## consistent across stages (only env/GxE/spatial/residual change between trials). F1 = mid-parent +
## GCA + SCA + heterosis + MET noise (so the kernel recovers a high Baker's ratio + a per-se↔GCA divergence).
het    <- c(yield = 7, brix = 0.05, firmness = 0.5, fruit_wt = 5, maturity = -1, shelf_life = 0.3)  # F1 vigour
sca_sd <- c(yield = 2.0, brix = 0.12, firmness = 1.3, fruit_wt = 1.8, maturity = 0.9, shelf_life = 0.6)
all_cross <- expand.grid(line = unique(c(cand, cand25)), tester = testers, stringsAsFactors = FALSE)
SCA <- sapply(TRAITS, function(tr) stats::rnorm(nrow(all_cross), 0, sca_sd[[tr]]))   # fixed SCA per cross×trait
rownames(SCA) <- paste(all_cross$line, all_cross$tester, sep = "x")

sim_tc <- function(cand_set, tpe, year, locs, reps, measured, loc_prefix) {
  bvt <- BV_all[[tpe]]
  cr  <- expand.grid(line = cand_set, tester = testers, stringsAsFactors = FALSE)
  env_names <- sprintf("%s-%d-L%d", loc_prefix, year, seq_len(locs))
  env_eff <- .rmvn(locs, rep(0, length(TRAITS)),
                   diag((c(yield = 12, brix = 0.6, firmness = 5, fruit_wt = 6, maturity = 4, shelf_life = 3))^2))
  rows <- list(); k <- 0
  for (e in seq_len(locs)) {
    ## FIELD LAYOUT: place every plot (crosses × reps) on a row×col grid, randomized, with a smooth
    ## low-frequency field surface (so spatial de-trending is meaningful).
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
      vals <- g_mean + het + gca + SCA[paste(L, Tt, sep = "x"), ] + env_eff[e, ] + block_shift[[r]] + surf * spat_sd + res
      names(vals) <- TRAITS
      row <- data.frame(genotype = paste(L, Tt, sep = "x"), parent1 = L, parent2 = Tt, env = env_names[e],
                        block = sprintf("%s-B%d", env_names[e], r), rep = r, row = rr, col = cc, stringsAsFactors = FALSE)
      for (tr in TRAITS) row[[tr]] <- if (tr %in% measured) round(vals[[tr]], 2) else NA_real_
      rows[[k]] <- row
    }
  }
  do.call(rbind, rows)
}

## ---- the funnel (every trial is a testcross) ----------------------------------------------------
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
## S1 Observation — every candidate testcrossed, central station (proc-TPE proxy), single plot. Tagged ALL
## (broad: candidate for every market). Cheap trait panel only.
s1 <- sim_tc(cand, "processing", 2024, locs = 1, reps = 1,
             measured = c("yield", "maturity", "fruit_wt"), loc_prefix = "CENTRAL")
add_trial("S1-2024-OBS", "S1", "Observation", 2024, "processing", "All", 1, 1, "line×tester single-plot",
          c("yield", "maturity", "fruit_wt"), s1)
m1 <- cand_means(s1, c("yield", "maturity", "fruit_wt"))
## route candidates: top 36 by testcross merit to processing, a (partly overlapping) top 24 by fruit to fresh
proc_s2  <- select_top_bal(m1, c(yield = 1.0, maturity = -0.4, fruit_wt = 0.3), 36)
fresh_s2 <- select_top_bal(m1, c(fruit_wt = 1.0, yield = 0.6, maturity = -0.2), 24)
selection_log[["S1-2024->S2"]] <- list(processing = proc_s2, `fresh-east` = fresh_s2)

## S2 PYT — split by destination TPE. Processing PYT in CA arid; Fresh PYT in East. Tagged at the TPE node.
## Quality traits come online. Testcrosses re-grown in the destination TPE → GCA×TPE shows up here.
s2p <- sim_tc(proc_s2, "processing", 2024, locs = 3, reps = 2,
              measured = c("yield", "maturity", "fruit_wt", "brix", "firmness"), loc_prefix = "CA")
add_trial("S2-2024-PROC", "S2", "PYT", 2024, "processing", "Processing", 3, 2, "line×tester RCBD",
          c("yield", "maturity", "fruit_wt", "brix", "firmness"), s2p)
s2f <- sim_tc(fresh_s2, "fresh-east", 2024, locs = 3, reps = 2,
              measured = c("yield", "maturity", "fruit_wt", "shelf_life"), loc_prefix = "EAST")
add_trial("S2-2024-FRESH", "S2", "PYT", 2024, "fresh-east", "Fresh-East", 3, 2, "line×tester RCBD",
          c("yield", "maturity", "fruit_wt", "shelf_life"), s2f)

m2p <- cand_means(s2p, c("yield", "brix", "firmness", "maturity"))
m2f <- cand_means(s2f, c("yield", "fruit_wt", "shelf_life", "maturity"))
## PROGRESSIVE NARROWING: at S3 the processing program clarifies into SPECIFIC market targets — a
## Brix-focused AYT and a Firmness-focused AYT, each advancing the candidates whose TESTCROSSES are best
## for that target (with natural overlap for all-rounders). Late trials are tagged at the LEAF market.
brix_s3 <- select_top_bal(m2p, c(yield = 1.0, brix = 1.3, maturity = -0.4), 16)
firm_s3 <- select_top_bal(m2p, c(yield = 1.0, firmness = 1.3, maturity = -0.4), 16)
fresh_s3 <- select_top_bal(m2f, W_FRESH, 14)
selection_log[["S2-2024->S3"]] <- list(`Proc-Brix` = brix_s3, `Proc-Firmness` = firm_s3, East = fresh_s3)

## S3 AYT — full panel, many locs. Processing splits into market-specific testcross trials (tag = leaf market).
s3b <- sim_tc(brix_s3, "processing", 2024, locs = 6, reps = 3, measured = TRAITS, loc_prefix = "CA")
add_trial("S3-2024-BRIX", "S3", "AYT", 2024, "processing", "Proc-Brix", 6, 3, "line×tester MET", TRAITS, s3b)
s3fm <- sim_tc(firm_s3, "processing", 2024, locs = 6, reps = 3, measured = TRAITS, loc_prefix = "CA")
add_trial("S3-2024-FIRM", "S3", "AYT", 2024, "processing", "Proc-Firmness", 6, 3, "line×tester MET", TRAITS, s3fm)
s3f <- sim_tc(fresh_s3, "fresh-east", 2024, locs = 6, reps = 3, measured = TRAITS, loc_prefix = "EAST")
add_trial("S3-2024-FRESH", "S3", "AYT", 2024, "fresh-east", "East", 6, 3, "line×tester MET", TRAITS, s3f)

m3b <- cand_means(s3b, c("yield", "brix", "firmness", "maturity"))
m3fm <- cand_means(s3fm, c("yield", "brix", "firmness", "maturity"))
m3f <- cand_means(s3f, c("yield", "fruit_wt", "shelf_life", "maturity"))
brix_s4 <- select_top_bal(m3b, c(yield = 1.0, brix = 1.3, maturity = -0.4), 6)
firm_s4 <- select_top_bal(m3fm, c(yield = 1.0, firmness = 1.3, maturity = -0.4), 6)
fresh_s4 <- select_top_bal(m3f, W_FRESH, 5)
selection_log[["S3-2024->S4"]] <- list(`Proc-Brix` = brix_s4, `Proc-Firmness` = firm_s4, East = fresh_s4)

## ===== Cycle 2025 =====
## S4 Pre-commercial — 2024 survivors' testcrosses to wide on-farm strips (cross-YEAR connectivity via the
## common testers + surviving candidates). Still market-specific (leaf tags).
s4b <- sim_tc(brix_s4, "processing", 2025, locs = 10, reps = 2, measured = TRAITS, loc_prefix = "CAFARM")
add_trial("S4-2025-BRIX", "S4", "Pre-commercial", 2025, "processing", "Proc-Brix", 10, 2, "line×tester on-farm strips", TRAITS, s4b)
s4fm <- sim_tc(firm_s4, "processing", 2025, locs = 10, reps = 2, measured = TRAITS, loc_prefix = "CAFARM")
add_trial("S4-2025-FIRM", "S4", "Pre-commercial", 2025, "processing", "Proc-Firmness", 10, 2, "line×tester on-farm strips", TRAITS, s4fm)
s4f <- sim_tc(fresh_s4, "fresh-east", 2025, locs = 8, reps = 2, measured = TRAITS, loc_prefix = "EASTFARM")
add_trial("S4-2025-FRESH", "S4", "Pre-commercial", 2025, "fresh-east", "East", 8, 2, "line×tester on-farm strips", TRAITS, s4f)

## New S1 for cycle 2025 (fresh candidates enter the top of the funnel) — keeps the program "alive".
s1b <- sim_tc(cand25, "processing", 2025, locs = 1, reps = 1,
              measured = c("yield", "maturity", "fruit_wt"), loc_prefix = "CENTRAL")
add_trial("S1-2025-OBS", "S1", "Observation", 2025, "processing", "All", 1, 1, "line×tester single-plot",
          c("yield", "maturity", "fruit_wt"), s1b)

## ---- write outputs ------------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)
self_dir <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)])
              if (length(f)) dirname(normalizePath(f)) else "." }
outdir <- if (length(args) >= 1) args[1] else normalizePath(file.path(self_dir, "..", "..", "data", "tomato"), mustWork = FALSE)
dir.create(file.path(outdir, "trials"), recursive = TRUE, showWarnings = FALSE)

for (id in names(trials)) write.csv(trials[[id]], file.path(outdir, "trials", paste0(id, ".csv")), row.names = FALSE)

## markers.csv (genotype, m001..mNNN) — the PARENTS that appear in crosses: the pool inbreds + the testers.
M_all <- rbind(M[testers, , drop = FALSE], M_pool)
mk_df <- data.frame(genotype = rownames(M_all), M_all, check.names = FALSE, stringsAsFactors = FALSE)
write.csv(mk_df, file.path(outdir, "markers.csv"), row.names = FALSE)

## inbreds.csv — parent facts for the candidate pool (heterotic pool / per-se merit per TPE / native trait /
## founder parents). The full pools feed within-pool recycling; per_se is the parent's own merit (kept for
## the per-se↔GCA divergence); per_se_fresh is its fresh-TPE merit; the native trait is carriage of the
## resistance allele at RES_LOCUS — the dual-source gate (ADR-0020).
inbreds <- data.frame(name = rownames(M_pool), role = "line", pool = unname(pool_of),
                      per_se = round(unname(perse_proc), 3), per_se_fresh = round(unname(perse_fresh), 3),
                      nclb = as.integer(M_pool[, RES_LOCUS] >= 1),
                      parents = unname(c(pA$parents, pB$parents)), stringsAsFactors = FALSE)
write.csv(inbreds, file.path(outdir, "inbreds.csv"), row.names = FALSE)

## manifest.json — the trial catalog + the MARKET-TARGET HIERARCHY (ADR-0023/0025). A single tree of nodes;
## trials are tagged to a node; the breeder composes a cut by multi-selecting any set of nodes (the cut is
## the union of trials tagged to the selected nodes). Nodes carrying `weights` are RANKABLE markets (the
## leaves); inner nodes (All, the TPEs) are grouping levels material narrows through. EVERY trial is a
## hybrid testcross, so there is no separate "hybrid" node — GCA/SCA come off whatever cut is composed.
manifest <- list(
  program = "Verdant tomato (synthetic, F1 hybrid)",
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
    `Fresh-East`   = list(parent = "All",        tpe = "fresh-east", label = "Fresh-market East · humid"),
    East           = list(parent = "Fresh-East", tpe = "fresh-east", label = "Fresh-market · East",
                          weights = list(fruit_wt = 0.35, shelf_life = 0.30, yield = 0.25, maturity = -0.10))),
  trials = unname(manifest_trials))
write_json(manifest, file.path(outdir, "manifest.json"), auto_unbox = TRUE, pretty = TRUE, na = "null")

## truth.json — known truth for validation/teaching. true_bv spans the backbone + pools, per TPE, so a
## candidate's true GCA (its parental BV deviation) can be checked against the kernel's estimate.
truth <- list(
  traits = TRAITS, g_mean = as.list(g_mean), g_sd = as.list(g_sd),
  G_corr = G_corr, cross_tpe_r = CROSS_TPE_R, n_loci = N_LOCI,
  true_bv = lapply(BV_all, function(b) {
    d <- as.data.frame(b); d$genotype <- rownames(b); d[, c("genotype", TRAITS)] }),
  selection_log = selection_log,
  testers = testers)
write_json(truth, file.path(outdir, "truth.json"), auto_unbox = TRUE, pretty = TRUE, digits = 5, na = "null")

cat(sprintf("tomato HYBRID corpus → %s\n  %d trials (all F1 testcross), %d pool candidates + %d common testers, %d markers\n  pools: 2 × %d lines from %d founders each\n",
            outdir, length(trials), nrow(M_pool), length(testers), N_LOCI, N_LINE_POOL, N_FOUND_POOL))
for (mt in manifest_trials)
  cat(sprintf("  %-14s %s %d %-11s tag=%-13s entries=%d loc=%d rep=%d\n",
              mt$trial_id, mt$stage, mt$year, mt$tpe, mt$market_tag, mt$n_entries, mt$n_loc, mt$n_rep))
