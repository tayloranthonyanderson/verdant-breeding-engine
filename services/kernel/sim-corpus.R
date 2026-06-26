## sim-corpus.R — synthetic maize HYBRID breeding program with known truth (extends sim.R from one MET
## to a staged, multi-year, multi-market funnel). IP-clean: fully simulated (ADR-0008). Pure base R
## + jsonlite. The corpus the product demos a *program* on, and the substrate for the data-cut model
## (docs/sim-corpus-spec.md, ADR-0023).
##
## HYBRID-ONLY (ADR-0025): maize is an F1 crop, so EVERY trial is a TESTCROSS — candidate inbreds (drawn
## from the two heterotic pools) crossed to a small set of common testers, grown as F1 hybrids with known
## parentage. There is no per-se line trial and no separate "testcross" node: GCA/SCA are estimable from
## ANY composed cut (every cut is hybrid), and the crossing module reads GCA off whatever cut the breeder
## composes. A candidate's per-se merit survives as a PARENT ATTRIBUTE (per TPE) so the per-se↔GCA
## divergence is still teachable. The sparse line×tester design leaves elite×elite product crosses UNMADE
## — those are the hybrid-prediction target.
##
## What it builds:
##   - Genetic values are MARKER-BASED (a real GRM can later glue the wide prediction cut). Per-locus
##     effects are correlated across traits, preserving the yield<->protein trade-off from sim.R.
##   - Two TPEs (Dryland = western arid; Corn-Belt = eastern high-yield) with GCA×TPE: a parent's dryland
##     and corn-belt general combining abilities are correlated < 1, so the Corn-Belt market needs its own fit.
##   - A funnel across 2 cycles (years). Surviving CANDIDATES carry forward (selected on OBSERVED testcross
##     means, so selection bias + Bulmer variance compression are real). The design ramps (locs/reps/trait
##     panel grow). Common TESTERS appear in every trial — the connectivity glue across stages and years.
##
## Output (default data/maize-sim/): per-trial long CSVs (each carrying parent1/parent2), manifest.json (the
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

TRAITS <- c("yield", "grain_protein", "test_weight", "plant_height", "maturity", "standability")
## trait means (grain-maize-ish: yield Mg/ha, protein %, test weight kg/hL, height cm, days, 1-9 score)
g_mean <- c(yield = 11, grain_protein = 9.0, test_weight = 74, plant_height = 250, maturity = 120, standability = 7.5)
g_sd   <- c(yield = 1.6, grain_protein = 0.7, test_weight = 3.0, plant_height = 14, maturity = 3.5, standability = 1.0)

## genetic correlation among traits — yield<->protein dilution trade-off (-0.45) carried from sim.R;
## test_weight and standability mildly favourable with protein; plant_height trades against protein (taller,
## more vegetative, lower grain protein).
G_corr <- matrix(c(
#        yield   prot  testwt  ht    matur  stand
         1.00, -0.45,  0.10,  0.35, -0.10,  0.05,   # yield
        -0.45,  1.00,  0.25, -0.30,  0.15,  0.20,   # grain_protein
         0.10,  0.25,  1.00, -0.05,  0.05,  0.45,   # test_weight
         0.35, -0.30, -0.05,  1.00, -0.10, -0.15,   # plant_height
        -0.10,  0.15,  0.05, -0.10,  1.00,  0.00,   # maturity
         0.05,  0.20,  0.45, -0.15,  0.00,  1.00),  # standability
  6, 6, byrow = TRUE)
dimnames(G_corr) <- list(TRAITS, TRAITS)

## cross-TPE genetic correlation (GCA×TPE): dryland vs corn-belt breeding value of the same parent.
## < 1 → a top dryland parent is not automatically a top corn-belt parent → Corn-Belt needs its OWN fit.
CROSS_TPE_R <- 0.55

N_LOCI <- 200

## ---- marker matrix + marker-based breeding values per TPE ---------------------------------------
## A genetic-architecture backbone (founders + fixed testers). The pools below are scored on the SAME
## per-locus effects so candidates land on the funnel's scale. Cycle 2 introduces fresh germplasm.
n_found_c1 <- 240
n_found_c2 <- 200
n_check    <- 6
line_ids <- c(sprintf("ZM-%04d", seq_len(n_found_c1)),
              sprintf("ZM-%04d", 1000 + seq_len(n_found_c2)),
              sprintf("CHK-%02d", seq_len(n_check)))
n_line <- length(line_ids)

## allele freqs and dosages (0/1/2)
p <- runif(N_LOCI, 0.1, 0.9)
M <- matrix(rbinom(n_line * N_LOCI, 2, rep(p, each = n_line)), nrow = n_line)
colnames(M) <- sprintf("m%03d", seq_len(N_LOCI))
rownames(M) <- line_ids
## per-locus additive effects (correlated across traits per G_corr), KEPT (not generated-and-discarded)
## so appended germplasm — the heterotic pools below — can be scored on the SAME genetic architecture.
## Two effect sets (common + TPE-specific) build correlated-but-distinct dryland/corn-belt breeding values.
center_vec <- colMeans(M)                                       # the backbone's per-locus mean dosage
draw_A <- function() .rmvn(N_LOCI, rep(0, length(TRAITS)), G_corr)   # n_loci x n_traits, cov ~ G_corr
A_set  <- list(common = draw_A(), dry = draw_A(), cb = draw_A())  # 3 draws — same RNG order as before
.colbv <- function(Msub, A) sweep(Msub, 2, center_vec, "-") %*% A
.cscl  <- lapply(A_set, function(A) g_sd / apply(.colbv(M, A), 2, sd))  # per-trait scale, from the backbone
## the three scaled effect-set BVs for any marker matrix (identical to the old locus_effects() on the backbone)
effset_bv <- function(Msub) setNames(lapply(names(A_set), function(k) sweep(.colbv(Msub, A_set[[k]]), 2, .cscl[[k]], "*")), names(A_set))
bvo <- effset_bv(M); bv_common <- bvo$common; bv_dry_sp <- bvo$dry; bv_cb_sp <- bvo$cb

## TPE breeding values: sqrt(r)*common + sqrt(1-r)*specific → cross-TPE corr ≈ CROSS_TPE_R. Scale factors
## come from the backbone lines so appended germplasm lands on the same scale.
.tcomb <- function(common, specific) sqrt(CROSS_TPE_R) * common + sqrt(1 - CROSS_TPE_R) * specific
.tscl  <- list(dryland = g_sd / apply(.tcomb(bv_common, bv_dry_sp), 2, sd),
               cornbelt = g_sd / apply(.tcomb(bv_common, bv_cb_sp), 2, sd))
tpe_bv <- function(common, specific, tpe) sweep(sweep(.tcomb(common, specific), 2, .tscl[[tpe]], "*"), 2, g_mean, "+")
BV <- list(dryland = tpe_bv(bv_common, bv_dry_sp, "dryland"),
           cornbelt = tpe_bv(bv_common, bv_cb_sp, "cornbelt"))
for (tpe in names(BV)) rownames(BV[[tpe]]) <- line_ids
## TPE BV for APPENDED germplasm (consistent scale with the backbone) — used by the pools/candidates. Both
## TPEs available, so a pool line carries a dryland AND a corn-belt breeding value (GCA×TPE applies).
bv_for <- function(Msub, tpe) { b <- effset_bv(Msub)
  spec <- if (tpe == "dryland") b$dry else b$cb
  m <- tpe_bv(b$common, spec, tpe); rownames(m) <- rownames(Msub); m }

## ---- trial noise + selection helpers ------------------------------------------------------------
## GxE / residual / block sds (yield most plastic). Trait panel measured per trial passed in `measured`.
ge_sd  <- c(yield = 1.2, grain_protein = 0.4, test_weight = 1.8, plant_height = 6, maturity = 1.5, standability = 0.5)
res_sd <- c(yield = 1.4, grain_protein = 0.55, test_weight = 2.4, plant_height = 10, maturity = 2.2, standability = 0.65)
## spatial field-trend amplitude per trait — a smooth row×col surface SpATS can recover (the reason a
## field layout exists at all). Comparable to block/residual, not dominating.
spat_sd <- c(yield = 1.0, grain_protein = 0.45, test_weight = 1.8, plant_height = 8, maturity = 2.0, standability = 0.6)

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

## selection weights (sign = direction). Dryland favours yield/protein/test-weight/earliness;
## corn-belt favours plant-height/standability/yield. maturity negative = earlier is better.
W_DRY <- c(yield = 1.0, grain_protein = 1.0, test_weight = 0.6, maturity = -0.4)
W_CB  <- c(yield = 0.8, plant_height = 1.0, standability = 0.9, maturity = -0.3)

## ===== Heterotic pools (the PARENTS) — built FIRST, since the whole funnel is their testcrosses =====
## Each pool is FOUNDED by a dozen+ inbreds and grown by within-pool crossing, so it carries real FAMILY
## STRUCTURE (full/half sibs share haplotypes). That gives the GRM genuine relatedness and makes the
## gain↔diversity tension REAL — a strong founder spawns a strong, RELATED family, so chasing gain
## concentrates kinship (exactly what optimal-contribution selection exists to manage). The two pools are
## genetically DIVERGENT (pool-specific allele freqs at a subset of loci) → distinct heterotic groups
## (think Stiff-Stalk vs Non-Stiff-Stalk): across-pool A×B is the product cross (mode 1), within-pool
## line×line is recycling (mode 2).
set.seed(910)
N_FOUND_POOL <- 16     # founder inbreds per pool (≥ a dozen)
N_LINE_POOL  <- 60     # current-generation inbred lines per pool (the full recycling roster)
N_DIVERGENT  <- 60     # loci differentiating the pools (heterotic divergence)
RES_LOCUS    <- "m007" # marker standing in for the native disease-resistance gene (NCLB / Ht1 — the gate)

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
bv_pool   <- list(dryland = bv_for(M_pool, "dryland"), cornbelt = bv_for(M_pool, "cornbelt"))
perse_idx <- function(bv, W) { z <- sapply(names(W), function(tr) { v <- bv[, tr]; (v - mean(v)) / (sd(v) + 1e-9) })
  setNames(rowSums(sweep(z, 2, W, "*")), rownames(bv)) }
perse_dry <- perse_idx(bv_pool$dryland, W_DRY)
perse_cb  <- perse_idx(bv_pool$cornbelt, W_CB)

## ===== Candidates + testers + the F1 testcross simulator =========================================
## Candidates = elite pool lines (BOTH pools) that get testcrossed through the funnel. A small common
## tester set (drawn from the backbone) appears in every trial → the connectivity glue across stages/years
## AND the line×tester structure that makes GCA identifiable from any single cut. Each candidate sits in
## only ~3 crosses (sparse), so elite×elite product hybrids stay UNMADE — the hybrid-prediction target.
n_cand   <- 24                                                  # elite candidates per pool for the 2024 funnel
n_cand25 <- 12                                                  # new candidates entering at the top in 2025
ord_A <- { m <- names(pool_of)[pool_of == "Pool A"]; m[order(-perse_dry[m])] }
ord_B <- { m <- names(pool_of)[pool_of == "Pool B"]; m[order(-perse_dry[m])] }
cand    <- c(ord_A[seq_len(n_cand)],                ord_B[seq_len(n_cand)])
cand25  <- c(ord_A[n_cand + seq_len(n_cand25)],     ord_B[n_cand + seq_len(n_cand25)])
testers <- sprintf("ZM-%04d", 1:3)                              # 3 common inbred testers (from the backbone)

## BV tables spanning every entity that can appear in a cross (testers + all pool candidates), per TPE.
BV_all <- list(dryland  = rbind(BV[["dryland"]],  bv_pool[["dryland"]]),
               cornbelt = rbind(BV[["cornbelt"]], bv_pool[["cornbelt"]]))

## STABLE per-cross SCA + F1 vigour, drawn ONCE for every candidate×tester so a cross is genetically
## consistent across stages (only env/GxE/spatial/residual change between trials). F1 = mid-parent +
## GCA + SCA + heterosis + MET noise (so the kernel recovers a high Baker's ratio + a per-se↔GCA divergence).
het    <- c(yield = 1.4, grain_protein = 0.08, test_weight = 0.3, plant_height = 10, maturity = -1, standability = 0.12)  # F1 vigour
sca_sd <- c(yield = 0.4, grain_protein = 0.18, test_weight = 0.8, plant_height = 3.6, maturity = 0.9, standability = 0.25)
all_cross <- expand.grid(line = unique(c(cand, cand25)), tester = testers, stringsAsFactors = FALSE)
SCA <- sapply(TRAITS, function(tr) stats::rnorm(nrow(all_cross), 0, sca_sd[[tr]]))   # fixed SCA per cross×trait
rownames(SCA) <- paste(all_cross$line, all_cross$tester, sep = "x")

sim_tc <- function(cand_set, tpe, year, locs, reps, measured, loc_prefix) {
  bvt <- BV_all[[tpe]]
  cr  <- expand.grid(line = cand_set, tester = testers, stringsAsFactors = FALSE)
  env_names <- sprintf("%s-%d-L%d", loc_prefix, year, seq_len(locs))
  env_eff <- .rmvn(locs, rep(0, length(TRAITS)),
                   diag((c(yield = 2.4, grain_protein = 0.9, test_weight = 3.0, plant_height = 12, maturity = 4.0, standability = 1.2))^2))
  rows <- list(); k <- 0
  for (e in seq_len(locs)) {
    ## FIELD LAYOUT: place every plot (crosses × reps) on a row×col grid, randomized, with a smooth
    ## low-frequency field surface (so spatial de-trending is meaningful).
    np <- nrow(cr) * reps; ncol <- ceiling(sqrt(np)); nrowg <- ceiling(np / ncol)
    w <- stats::rnorm(3); plot_order <- sample.int(np)
    block_shift <- lapply(seq_len(reps), function(r) stats::rnorm(length(TRAITS), 0, c(0.5, 0.18, 0.9, 3, 0.8, 0.25)))
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
## S1 Observation — every candidate testcrossed, central station (dryland-TPE proxy), single plot. Tagged ALL
## (broad: candidate for every market). Cheap trait panel only.
s1 <- sim_tc(cand, "dryland", 2024, locs = 1, reps = 1,
             measured = c("yield", "maturity", "plant_height"), loc_prefix = "CENTRAL")
add_trial("S1-2024-OBS", "S1", "Observation", 2024, "dryland", "All", 1, 1, "line×tester single-plot",
          c("yield", "maturity", "plant_height"), s1)
m1 <- cand_means(s1, c("yield", "maturity", "plant_height"))
## route candidates: top 36 by testcross merit to dryland, a (partly overlapping) top 24 by height to corn-belt
dry_s2 <- select_top_bal(m1, c(yield = 1.0, maturity = -0.4, plant_height = 0.3), 36)
cb_s2  <- select_top_bal(m1, c(plant_height = 1.0, yield = 0.6, maturity = -0.2), 24)
selection_log[["S1-2024->S2"]] <- list(dryland = dry_s2, cornbelt = cb_s2)

## S2 PYT — split by destination TPE. Dryland PYT in the west; Corn-Belt PYT in the east. Tagged at the TPE
## node. Quality traits come online. Testcrosses re-grown in the destination TPE → GCA×TPE shows up here.
s2d <- sim_tc(dry_s2, "dryland", 2024, locs = 3, reps = 2,
              measured = c("yield", "maturity", "plant_height", "grain_protein", "test_weight"), loc_prefix = "WEST")
add_trial("S2-2024-DRY", "S2", "PYT", 2024, "dryland", "Dryland", 3, 2, "line×tester RCBD",
          c("yield", "maturity", "plant_height", "grain_protein", "test_weight"), s2d)
s2c <- sim_tc(cb_s2, "cornbelt", 2024, locs = 3, reps = 2,
              measured = c("yield", "maturity", "plant_height", "standability"), loc_prefix = "EAST")
add_trial("S2-2024-CB", "S2", "PYT", 2024, "cornbelt", "Corn-Belt", 3, 2, "line×tester RCBD",
          c("yield", "maturity", "plant_height", "standability"), s2c)

m2d <- cand_means(s2d, c("yield", "grain_protein", "test_weight", "maturity"))
m2c <- cand_means(s2c, c("yield", "plant_height", "standability", "maturity"))
## PROGRESSIVE NARROWING: at S3 the dryland program clarifies into SPECIFIC market targets — a
## protein-focused (food-grade) AYT and a test-weight-focused (grain-quality) AYT, each advancing the
## candidates whose TESTCROSSES are best for that target (with natural overlap for all-rounders).
prot_s3 <- select_top_bal(m2d, c(yield = 1.0, grain_protein = 1.3, maturity = -0.4), 16)
tw_s3   <- select_top_bal(m2d, c(yield = 1.0, test_weight = 1.3, maturity = -0.4), 16)
cb_s3   <- select_top_bal(m2c, W_CB, 14)
selection_log[["S2-2024->S3"]] <- list(`Food-grade` = prot_s3, `Grain-quality` = tw_s3, Grain = cb_s3)

## S3 AYT — full panel, many locs. Dryland splits into market-specific testcross trials (tag = leaf market).
s3p <- sim_tc(prot_s3, "dryland", 2024, locs = 6, reps = 3, measured = TRAITS, loc_prefix = "WEST")
add_trial("S3-2024-FOOD", "S3", "AYT", 2024, "dryland", "Food-grade", 6, 3, "line×tester MET", TRAITS, s3p)
s3t <- sim_tc(tw_s3, "dryland", 2024, locs = 6, reps = 3, measured = TRAITS, loc_prefix = "WEST")
add_trial("S3-2024-QUAL", "S3", "AYT", 2024, "dryland", "Grain-quality", 6, 3, "line×tester MET", TRAITS, s3t)
s3c <- sim_tc(cb_s3, "cornbelt", 2024, locs = 6, reps = 3, measured = TRAITS, loc_prefix = "EAST")
add_trial("S3-2024-GRAIN", "S3", "AYT", 2024, "cornbelt", "Grain", 6, 3, "line×tester MET", TRAITS, s3c)

m3p <- cand_means(s3p, c("yield", "grain_protein", "test_weight", "maturity"))
m3t <- cand_means(s3t, c("yield", "grain_protein", "test_weight", "maturity"))
m3c <- cand_means(s3c, c("yield", "plant_height", "standability", "maturity"))
prot_s4 <- select_top_bal(m3p, c(yield = 1.0, grain_protein = 1.3, maturity = -0.4), 6)
tw_s4   <- select_top_bal(m3t, c(yield = 1.0, test_weight = 1.3, maturity = -0.4), 6)
cb_s4   <- select_top_bal(m3c, W_CB, 5)
selection_log[["S3-2024->S4"]] <- list(`Food-grade` = prot_s4, `Grain-quality` = tw_s4, Grain = cb_s4)

## ===== Cycle 2025 =====
## S4 Pre-commercial — 2024 survivors' testcrosses to wide on-farm strips (cross-YEAR connectivity via the
## common testers + surviving candidates). Still market-specific (leaf tags).
s4p <- sim_tc(prot_s4, "dryland", 2025, locs = 10, reps = 2, measured = TRAITS, loc_prefix = "WESTFARM")
add_trial("S4-2025-FOOD", "S4", "Pre-commercial", 2025, "dryland", "Food-grade", 10, 2, "line×tester on-farm strips", TRAITS, s4p)
s4t <- sim_tc(tw_s4, "dryland", 2025, locs = 10, reps = 2, measured = TRAITS, loc_prefix = "WESTFARM")
add_trial("S4-2025-QUAL", "S4", "Pre-commercial", 2025, "dryland", "Grain-quality", 10, 2, "line×tester on-farm strips", TRAITS, s4t)
s4c <- sim_tc(cb_s4, "cornbelt", 2025, locs = 8, reps = 2, measured = TRAITS, loc_prefix = "EASTFARM")
add_trial("S4-2025-GRAIN", "S4", "Pre-commercial", 2025, "cornbelt", "Grain", 8, 2, "line×tester on-farm strips", TRAITS, s4c)

## New S1 for cycle 2025 (fresh candidates enter the top of the funnel) — keeps the program "alive".
s1b <- sim_tc(cand25, "dryland", 2025, locs = 1, reps = 1,
              measured = c("yield", "maturity", "plant_height"), loc_prefix = "CENTRAL")
add_trial("S1-2025-OBS", "S1", "Observation", 2025, "dryland", "All", 1, 1, "line×tester single-plot",
          c("yield", "maturity", "plant_height"), s1b)

## ---- write outputs ------------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)
self_dir <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)])
              if (length(f)) dirname(normalizePath(f)) else "." }
outdir <- if (length(args) >= 1) args[1] else normalizePath(file.path(self_dir, "..", "..", "data", "maize-sim"), mustWork = FALSE)
dir.create(file.path(outdir, "trials"), recursive = TRUE, showWarnings = FALSE)

for (id in names(trials)) write.csv(trials[[id]], file.path(outdir, "trials", paste0(id, ".csv")), row.names = FALSE)

## markers.csv (genotype, m001..mNNN) — the PARENTS that appear in crosses: the pool inbreds + the testers.
M_all <- rbind(M[testers, , drop = FALSE], M_pool)
mk_df <- data.frame(genotype = rownames(M_all), M_all, check.names = FALSE, stringsAsFactors = FALSE)
write.csv(mk_df, file.path(outdir, "markers.csv"), row.names = FALSE)

## inbreds.csv — parent facts for the candidate pool (heterotic pool / per-se merit per TPE / native trait /
## founder parents). The full pools feed within-pool recycling; per_se is the parent's own merit (kept for
## the per-se↔GCA divergence); per_se_cb is its corn-belt-TPE merit; the native trait is carriage of the
## NCLB (Ht1) resistance allele at RES_LOCUS — the dual-source gate (ADR-0020).
inbreds <- data.frame(name = rownames(M_pool), role = "line", pool = unname(pool_of),
                      per_se = round(unname(perse_dry), 3), per_se_cb = round(unname(perse_cb), 3),
                      nclb = as.integer(M_pool[, RES_LOCUS] >= 1),
                      parents = unname(c(pA$parents, pB$parents)), stringsAsFactors = FALSE)
write.csv(inbreds, file.path(outdir, "inbreds.csv"), row.names = FALSE)

## manifest.json — the trial catalog + the MARKET-TARGET HIERARCHY (ADR-0023/0025). A single tree of nodes;
## trials are tagged to a node; the breeder composes a cut by multi-selecting any set of nodes (the cut is
## the union of trials tagged to the selected nodes). Nodes carrying `weights` are RANKABLE markets (the
## leaves); inner nodes (All, the TPEs) are grouping levels material narrows through. EVERY trial is a
## hybrid testcross, so there is no separate "hybrid" node — GCA/SCA come off whatever cut is composed.
manifest <- list(
  program = "Verdant maize (synthetic, F1 hybrid)",
  generated_by = "services/kernel/sim-corpus.R",
  traits = TRAITS,
  tpes = list(
    dryland = list(label = "Dryland (western arid)"),
    cornbelt = list(label = "Corn Belt (eastern, high-yield)")),
  hierarchy = list(
    All             = list(parent = NA,         tpe = NA,         label = "All markets (early screen)"),
    Dryland         = list(parent = "All",      tpe = "dryland",  label = "Dryland · western arid"),
    `Food-grade`    = list(parent = "Dryland",  tpe = "dryland",  label = "Dryland · food-grade",
                           weights = list(grain_protein = 0.45, yield = 0.30, test_weight = 0.15, maturity = -0.10)),
    `Grain-quality` = list(parent = "Dryland",  tpe = "dryland",  label = "Dryland · grain quality",
                           weights = list(test_weight = 0.45, yield = 0.30, grain_protein = 0.15, maturity = -0.10)),
    `Corn-Belt`     = list(parent = "All",      tpe = "cornbelt", label = "Corn Belt · eastern"),
    Grain           = list(parent = "Corn-Belt", tpe = "cornbelt", label = "Corn Belt · grain",
                           weights = list(yield = 0.40, standability = 0.30, test_weight = 0.20, maturity = -0.10))),
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

cat(sprintf("maize HYBRID corpus → %s\n  %d trials (all F1 testcross), %d pool candidates + %d common testers, %d markers\n  pools: 2 × %d lines from %d founders each\n",
            outdir, length(trials), nrow(M_pool), length(testers), N_LOCI, N_LINE_POOL, N_FOUND_POOL))
for (mt in manifest_trials)
  cat(sprintf("  %-14s %s %d %-11s tag=%-13s entries=%d loc=%d rep=%d\n",
              mt$trial_id, mt$stage, mt$year, mt$tpe, mt$market_tag, mt$n_entries, mt$n_loc, mt$n_rep))
