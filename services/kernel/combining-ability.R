#!/usr/bin/env Rscript
## Verdant compute kernel — Combining ability (GCA / SCA). ADR-0019 (modelling) + ADR-0020 (selection).
##
## Decomposes a hybrid trial into PARENT contributions: GCA (parent main effects, random → BLUP, the
## selection target) and SCA (specific-cross deviation, random, where the data support it). One unified
## random-effects mixed model; the GCA parameterization is SELECTED from the measured cross-graph
## topology (diallel / line×tester / sparse factorial), never a fixed-effects Griffing method. The few,
## chosen testers of a line×tester are fitted FIXED (too few levels for a variance, a chosen set not a
## sample); the many lines are random. SCA is gated on cross-replication. Ranking is WITHIN POOL.
##
## stdin/cfg-file JSON in → ResultBundle.combining_ability JSON out. Requires lme4.
##
##   Rscript combining-ability.R <cfg.json>      (payload is large → cfg-file transport)
suppressWarnings(suppressPackageStartupMessages({ library(jsonlite); library(lme4) }))

## ---- IO ---------------------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)
con <- if (length(args) >= 1 && file.exists(args[1])) args[1] else "stdin"
req <- jsonlite::fromJSON(paste(readLines(con, warn = FALSE), collapse = "\n"), simplifyVector = TRUE)

traits  <- as.character(req$traits)
TESTER_FIXED_MAX <- if (!is.null(req$tester_fixed_max)) as.integer(req$tester_fixed_max) else 8L

## plot table (parallel arrays from the TS driver)
P <- req$plot
d0 <- data.frame(
  genotype    = if (!is.null(P$genotype)) as.character(P$genotype) else paste(P$parent1, P$parent2, sep = "/"),
  line        = as.character(P$parent1),
  tester      = as.character(P$parent2),
  environment = as.character(P$environment),
  row         = suppressWarnings(as.numeric(P$row)),
  col         = suppressWarnings(as.numeric(P$col)),
  stringsAsFactors = FALSE
)
for (tr in traits) d0[[tr]] <- suppressWarnings(as.numeric(P$values[[tr]]))
d0 <- d0[!is.na(d0$line) & !is.na(d0$tester) & nzchar(d0$line) & nzchar(d0$tester), , drop = FALSE]

## inbred-level facts (pool / per-se / native trait), keyed by line name
IB <- req$inbred
ib_pool <- setNames(as.character(IB$pool), as.character(IB$name))
ib_perse <- setNames(suppressWarnings(as.numeric(IB$per_se)), as.character(IB$name))
ib_nclb <- setNames(suppressWarnings(as.numeric(IB$nclb)), as.character(IB$name))
pool_of <- function(l) { p <- ib_pool[l]; ifelse(is.na(p), "Unassigned", p) }

## ---- cross-graph diagnostics (ADR-0019 cross-connectivity + cross-replication) ----------------
lines   <- sort(unique(d0$line))
testers <- sort(unique(d0$tester))
crosses <- unique(d0[, c("line", "tester")])
deg <- as.integer(table(factor(crosses$line, levels = lines)))            # distinct testers per line
names(deg) <- lines
plots_per_line <- as.integer(table(factor(d0$line, levels = lines))); names(plots_per_line) <- lines
## cross-replication: how many distinct crosses are observed in >1 plot (SCA separability signal)
cross_key <- paste(d0$line, d0$tester, sep = "")
reps_per_cross <- table(cross_key)
n_replicated_crosses <- sum(reps_per_cross > 1)

## connected components of the bipartite line–tester graph (are GCAs on one common scale?)
comp_id <- setNames(rep(NA_integer_, length(lines)), lines)
tester_comp <- setNames(rep(NA_integer_, length(testers)), testers)
nextc <- 0L
adj_lt <- split(crosses$tester, crosses$line)
adj_tl <- split(crosses$line, crosses$tester)
for (start in lines) {
  if (!is.na(comp_id[start])) next
  nextc <- nextc + 1L; stack <- start
  while (length(stack)) {
    nd <- stack[[1]]; stack <- stack[-1]
    if (is.na(comp_id[nd])) {
      comp_id[nd] <- nextc
      for (tt in adj_lt[[nd]]) if (is.na(tester_comp[tt])) { tester_comp[tt] <- nextc; stack <- c(stack, adj_tl[[tt]]) }
    }
  }
}
n_components <- nextc
degree_dist <- as.list(table(deg))   # {"1": n, "2": n, ...}

## ---- topology selection (ADR-0019) ------------------------------------------------------------
## The fixed-vs-random tester call follows the EFFECTIVE number of testers (inverse-Simpson on plot
## frequencies), not the raw count: a panel with 2 dominant testers + a long rare tail behaves like a
## 2-tester line×tester, and a variance from ~2 effective levels is unestimable + they're a chosen set.
overlap <- length(intersect(lines, testers))
disjoint <- overlap / max(1, length(lines)) < 0.1
tester_plot_freq <- as.numeric(table(d0$tester)) / nrow(d0)
eff_testers <- 1 / sum(tester_plot_freq^2)
testers_few <- eff_testers <= TESTER_FIXED_MAX
if (!disjoint) {
  topo <- "diallel"
} else if (testers_few) {
  topo <- "line_tester"
} else {
  topo <- "sparse_factorial"
}
tester_effect <- if (testers_few) "fixed" else "random"
sca_estimable <- n_replicated_crosses >= 10 || mean(deg) >= 1.5

decisions <- list()
add_dec <- function(factor, choice, reason, diagnostic = NULL)
  decisions[[length(decisions) + 1]] <<- list(factor = factor, choice = choice, reason = reason,
                                              diagnostic = diagnostic, source = "recommended")
add_dec("genotype_structure", "gca_sca",
  sprintf("Germplasm are crosses (%d lines × %d testers, %d distinct crosses); the genotype effect is decomposed into parental GCA + SCA.",
          length(lines), length(testers), nrow(crosses)),
  list(n_lines = length(lines), n_testers = length(testers), n_crosses = nrow(crosses)))
add_dec("topology", topo,
  switch(topo,
    line_tester = sprintf("Parent pools are near-disjoint and the testers are few in effect (%.1f effective of %d named — 2 dominant); a line×tester parameterization: line-GCA random, tester fixed.", eff_testers, length(testers)),
    sparse_factorial = sprintf("Both parent pools are large and crosses sparse (%.1f effective testers); both pool-GCAs fitted random.", eff_testers),
    "Parent pools overlap (an inbred appears as both parents); a symmetric pooled GCA (overlay)."),
  list(n_testers = length(testers), eff_testers = round(eff_testers, 2), pool_overlap = overlap))
add_dec("tester_effect", tester_effect,
  if (tester_effect == "fixed") sprintf("Only %.1f effective testers (of %d named) — too few levels to estimate a variance, and a chosen set rather than a population sample; fitted FIXED.", eff_testers, length(testers))
  else sprintf("%.1f effective testers — enough levels to fit a tester-GCA variance; fitted random.", eff_testers),
  list(n_testers = length(testers), eff_testers = round(eff_testers, 2)))
add_dec("sca", if (sca_estimable) "include" else "skip",
  if (sca_estimable) sprintf("%d crosses are replicated (median %.0f testers/line); SCA (line:tester) is separable from residual.", n_replicated_crosses, median(deg))
  else sprintf("Too little cross-replication (%d replicated crosses, median %.0f testers/line); SCA folds into the residual.", n_replicated_crosses, median(deg)),
  list(n_replicated_crosses = n_replicated_crosses, median_degree = median(deg)))

## ---- the fit: one model per trait (lme4) ------------------------------------------------------
## value ~ environment + tester(fixed) + (1|line)[GCA] + (1|line:tester)[SCA] + (1|line:environment)[GCA×E]
d0$line <- factor(d0$line); d0$tester <- factor(d0$tester); d0$environment <- factor(d0$environment)
multi_env <- nlevels(d0$environment) > 1

fit_trait <- function(tr) {
  d <- d0[is.finite(d0[[tr]]), , drop = FALSE]
  d$y <- d[[tr]]
  rhs <- "(1|line)"
  if (length(testers) > 1) rhs <- paste(rhs, if (tester_effect == "fixed") "+ tester" else "+ (1|tester)")
  if (sca_estimable) rhs <- paste(rhs, "+ (1|line:tester)")
  if (multi_env) rhs <- paste(rhs, "+ environment + (1|line:environment)")
  form <- stats::as.formula(paste("y ~", rhs))
  m <- tryCatch(lme4::lmer(form, data = d, REML = TRUE,
                           control = lme4::lmerControl(calc.derivs = FALSE)),
                error = function(e) NULL)
  if (is.null(m)) {  # fallback: drop GCA×E
    rhs2 <- "(1|line)"
    if (length(testers) > 1 && tester_effect == "fixed") rhs2 <- paste(rhs2, "+ tester")
    if (sca_estimable) rhs2 <- paste(rhs2, "+ (1|line:tester)")
    if (multi_env) rhs2 <- paste(rhs2, "+ environment")
    m <- lme4::lmer(stats::as.formula(paste("y ~", rhs2)), data = d, REML = TRUE,
                    control = lme4::lmerControl(calc.derivs = FALSE))
  }
  vc <- as.data.frame(lme4::VarCorr(m))
  getv <- function(g) { v <- vc$vcov[vc$grp == g]; if (length(v)) v[1] else 0 }
  v_gca <- getv("line"); v_sca <- getv("line:tester"); v_gxe <- getv("line:environment"); v_res <- getv("Residual")
  re <- lme4::ranef(m)
  gca <- re$line[, 1]; names(gca) <- rownames(re$line)
  ## SCA per OBSERVED cross (the meaningful cells), keyed linetester
  sca <- NULL
  if (!is.null(re[["line:tester"]])) {
    s <- re[["line:tester"]][, 1]; names(s) <- rownames(re[["line:tester"]])
    sca <- s
  }
  baker <- if ((2 * v_gca + v_sca) > 0) (2 * v_gca) / (2 * v_gca + v_sca) else NA_real_
  list(gca = gca, sca = sca,
       varcomp = list(gca = v_gca, sca = v_sca, gca_env = v_gxe, residual = v_res),
       baker = baker, mu = mean(d$y, na.rm = TRUE))
}

fits <- setNames(lapply(traits, fit_trait), traits)

## ---- assemble per-line GCA table --------------------------------------------------------------
gca_mat <- sapply(traits, function(tr) fits[[tr]]$gca[lines])   # lines × traits (NA where line absent)
rownames(gca_mat) <- lines
gca_list <- lapply(seq_along(lines), function(i) {
  l <- lines[i]
  vals <- as.list(round(gca_mat[i, ], 5)); names(vals) <- traits
  list(line = l, pool = pool_of(l),
       cross_degree = list(n_testers = unname(deg[l]), n_plots = unname(plots_per_line[l])),
       per_se = if (is.na(ib_perse[l])) NULL else unname(round(ib_perse[l], 4)),
       nclb_resistant = if (is.na(ib_nclb[l])) NULL else unname(as.integer(ib_nclb[l])),
       values = vals)
})
names(gca_list) <- lines

## ---- within-pool transparent GCA index + gates (ADR-0020) -------------------------------------
obj <- req$objective
iw <- obj$index_weights
spec <- data.frame(variable_id = as.character(iw$variable_id),
                   mode = if (!is.null(iw$mode)) as.character(iw$mode) else "max",
                   weight = as.numeric(iw$weight), stringsAsFactors = FALSE)
gates <- obj$gates
gate_df <- if (is.null(gates) || NROW(gates) == 0) NULL else
  data.frame(variable_id = as.character(gates$variable_id), operator = as.character(gates$operator),
             threshold = as.numeric(gates$threshold), stringsAsFactors = FALSE)

## gate value source: native-trait / per-se gates read inbred-level values; trait gates read GCA.
gate_value <- function(l, vid) {
  if (vid == "nctlb_resistant") return(unname(ib_nclb[l]))
  if (vid == "per_se") return(unname(ib_perse[l]))
  unname(gca_mat[l, vid])
}
gate_eval <- function(l) {
  if (is.null(gate_df)) return(character(0))
  fails <- character(0)
  for (k in seq_len(nrow(gate_df))) {
    v <- gate_value(l, gate_df$variable_id[k]); if (is.na(v)) next
    op <- gate_df$operator[k]; thr <- gate_df$threshold[k]
    ok <- switch(op, ">=" = v >= thr, "<=" = v <= thr, ">" = v > thr, "<" = v < thr, "==" = v == thr, "!=" = v != thr, TRUE)
    if (!isTRUE(ok)) fails <- c(fails, gate_df$variable_id[k])
  }
  fails
}

## transparent weighted index, standardized WITHIN each pool (so pools are ranked independently)
pools <- sort(unique(pool_of(lines)))
score_in_pool <- setNames(rep(NA_real_, length(lines)), lines)
for (pl in pools) {
  members <- lines[pool_of(lines) == pl]
  if (!length(members)) next
  contrib <- setNames(rep(0, length(members)), members)
  for (j in seq_len(nrow(spec))) {
    vid <- spec$variable_id[j]; val <- gca_mat[members, vid]
    mu <- mean(val, na.rm = TRUE); sdv <- stats::sd(val, na.rm = TRUE); if (!is.finite(sdv) || sdv == 0) sdv <- 1
    z <- (val - mu) / sdv; merit <- if (spec$mode[j] == "min") -z else z
    mm <- mean(merit, na.rm = TRUE); ms <- stats::sd(merit, na.rm = TRUE); if (!is.finite(ms) || ms == 0) ms <- 1
    mn <- (merit - mm) / ms; mn[is.na(mn)] <- 0
    contrib <- contrib + mn * spec$weight[j]
  }
  score_in_pool[members] <- contrib
}

## rank within pool, gated entries pushed below survivors
rank_rows <- lapply(lines, function(l) {
  fails <- gate_eval(l)
  list(line = l, pool = pool_of(l), score = round(unname(score_in_pool[l]), 5),
       gated_out = length(fails) > 0, gate_failures = if (length(fails)) fails else character(0))
})
names(rank_rows) <- lines
pool_rankings <- lapply(pools, function(pl) {
  members <- Filter(function(r) r$pool == pl, rank_rows)
  ord <- order(sapply(members, function(r) r$gated_out), -sapply(members, function(r) r$score))
  ranked <- lapply(seq_along(ord), function(i) { r <- members[[ord[i]]]; r$rank <- i; r })
  list(pool = pl, n = length(ranked), ranking = ranked)
})

## ---- per-se ↔ GCA divergence (overall, on the index score) ------------------------------------
perse_vec <- ib_perse[lines]; gca_score <- score_in_pool[lines]
ok <- is.finite(perse_vec) & is.finite(gca_score)
rho <- if (sum(ok) > 3) suppressWarnings(cor(perse_vec[ok], gca_score[ok], method = "spearman")) else NA_real_
r_perse <- rank(-perse_vec); r_gca <- rank(-gca_score)
delta <- r_perse - r_gca                          # +ve: GCA ranks it BETTER than per-se
movers_ix <- order(-abs(ifelse(ok, delta, 0)))[seq_len(min(8, sum(ok)))]
movers <- lapply(movers_ix, function(k) list(line = lines[k], pool = pool_of(lines[k]),
                                             rank_delta = as.integer(delta[k]),
                                             per_se = unname(round(perse_vec[k], 3)),
                                             gca_score = unname(round(gca_score[k], 3))))

## ---- SCA cells for OBSERVED crosses (for the heatmap), top by |SCA| on the lead trait ----------
lead <- traits[1]
sca_cells <- list()
if (!is.null(fits[[lead]]$sca)) {
  s <- fits[[lead]]$sca
  obs_keys <- paste(crosses$line, crosses$tester, sep = ":")
  keys <- intersect(names(s), obs_keys)
  if (length(keys)) {
    sv <- s[keys]; topk <- keys[order(-abs(sv))][seq_len(min(200, length(keys)))]
    sca_cells <- lapply(topk, function(k) {
      lt <- strsplit(k, ":", fixed = TRUE)[[1]]
      list(line = lt[1], tester = lt[2], value = round(unname(s[k]), 5))
    })
  }
}

## ---- hybrid-based ranking (observed cross performance + its GCA explanation) -------------------
## The breeder also ranks HYBRIDS, not just parents. Observed per-cross mean per index trait + the
## line's GCA (how much of the hybrid's standing the line's combining ability explains). Ranked by the
## same transparent index applied to observed hybrid means.
hyb_geno <- unique(d0[, c("genotype", "line", "tester")])
obs_mean <- function(tr) tapply(d0[[tr]], d0$genotype, function(x) mean(x, na.rm = TRUE))
om <- setNames(lapply(traits, obs_mean), traits)
n_plots_hyb <- table(d0$genotype)
hyb_score <- setNames(rep(0, nrow(hyb_geno)), hyb_geno$genotype)
for (j in seq_len(nrow(spec))) {
  vid <- spec$variable_id[j]; val <- om[[vid]][hyb_geno$genotype]
  mu <- mean(val, na.rm = TRUE); sdv <- stats::sd(val, na.rm = TRUE); if (!is.finite(sdv) || sdv == 0) sdv <- 1
  z <- (val - mu) / sdv; merit <- if (spec$mode[j] == "min") -z else z
  mm <- mean(merit, na.rm = TRUE); ms <- stats::sd(merit, na.rm = TRUE); if (!is.finite(ms) || ms == 0) ms <- 1
  mn <- (merit - mm) / ms; mn[is.na(mn)] <- 0
  hyb_score[hyb_geno$genotype] <- hyb_score[hyb_geno$genotype] + mn * spec$weight[j]
}
hyb_ord <- order(-hyb_score)
hybrids_out <- lapply(seq_along(hyb_ord), function(i) {
  k <- hyb_ord[i]; gname <- hyb_geno$genotype[k]; l <- hyb_geno$line[k]
  obs <- as.list(round(sapply(traits, function(tr) unname(om[[tr]][gname])), 4)); names(obs) <- traits
  gcav <- as.list(round(gca_mat[l, ], 5)); names(gcav) <- traits
  list(hybrid = gname, line = l, tester = hyb_geno$tester[k], pool = pool_of(l),
       n_plots = unname(as.integer(n_plots_hyb[gname])),
       rank = i, score = round(unname(hyb_score[gname]), 5),
       observed = obs, line_gca = gcav)
})

## ---- trait-level varcomp + Baker's ratio + GCA genetic_sd -------------------------------------
trait_summ <- lapply(traits, function(tr) {
  f <- fits[[tr]]; vc <- f$varcomp
  list(variable_id = tr,
       varcomp = list(
         list(component = "gca",          variance = round(vc$gca, 6)),
         list(component = "sca",          variance = round(vc$sca, 6)),
         list(component = "gca_env",      variance = round(vc$gca_env, 6)),
         list(component = "residual",     variance = round(vc$residual, 6))),
       genetic_sd = if (is.finite(vc$gca) && vc$gca > 0) round(sqrt(vc$gca), 6) else NA_real_,
       baker_ratio = if (is.na(f$baker)) NULL else round(f$baker, 4))
})

## ---- GCA genetic correlation across traits (for the genetically-aware desired-gains GCA index) --
## Empirical correlation of the per-line GCA BLUPs across traits — the co-inheritance G the index needs
## (with the model-based genetic_sd above on the diagonal, mirroring the hybrid genetic_correlations).
gca_cor <- suppressWarnings(stats::cor(gca_mat, use = "pairwise.complete.obs"))
gca_cor[!is.finite(gca_cor)] <- 0
diag(gca_cor) <- 1
gca_corr_mat <- lapply(seq_len(nrow(gca_cor)), function(i) round(as.numeric(gca_cor[i, ]), 5))

## ---- emit -------------------------------------------------------------------------------------
out <- list(
  combining_ability = list(
    topology = list(
      kind = topo, n_lines = length(lines), n_testers = length(testers),
      eff_testers = round(eff_testers, 2), n_crosses = nrow(crosses),
      tester_effect = tester_effect, sca_included = sca_estimable,
      pools = lapply(pools, function(p) list(pool = p, n = sum(pool_of(lines) == p))),
      decisions = decisions),
    diagnostics = list(
      degree = list(min = min(deg), median = median(deg), max = max(deg), distribution = degree_dist),
      connectivity = list(components = n_components, connected = n_components == 1),
      replication = list(replicated_crosses = n_replicated_crosses, total_crosses = nrow(crosses))),
    traits = trait_summ,
    gca_genetic_correlations = list(variable_ids = as.list(traits), matrix = gca_corr_mat),
    index_traits = as.list(spec$variable_id),
    gca = unname(gca_list),
    pool_rankings = pool_rankings,
    hybrids = hybrids_out,
    sca = sca_cells,
    divergence = list(compared = c("per_se", "gca"),
                      rank_correlation = if (is.na(rho)) NULL else round(rho, 4),
                      notable_movers = movers)
  )
)
cat(jsonlite::toJSON(out, auto_unbox = TRUE, null = "null", na = "null", digits = NA))
