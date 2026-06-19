#!/usr/bin/env Rscript
## Verdant compute kernel — WITHIN-POOL recycling crosses (ADR-0024, mode 2). The recurrent half of the
## breeding cycle: which line × line crosses (within one heterotic pool) to recombine into the next
## generation of inbreds. Two methods, computed side by side so the breeder can COMPARE them:
##
##   1. USEFULNESS  U = midparent + i·σ  — rank each cross by the expected mean of its SELECTED progeny.
##      For inbred parents the progeny genetic variance has a closed form: σ²_ij = ¼ Σ_k a_k²(M_ik−M_jk)²
##      — the marker-EFFECT-weighted divergence between the parents (a = marker effects on the index).
##      Greedy + diversity-BLIND: it chases gain and over-uses a few elite parents.
##
##   2. OCS — optimal contribution selection (Meuwissen/Kinghorn). Maximize gain g'c subject to a cap on
##      group coancestry ½c'Gc (the rate of inbreeding), swept into a gain-vs-coancestry FRONTIER. OCS
##      spreads contributions to hold diversity, at a small gain cost.
##
## The CONTRAST (the teaching payoff) is read off each plan's realized parental contributions c (a
## parent's share of the mating slots): gain = g'c, group coancestry = c'Gc, effective parents = 1/Σc².
## Usefulness lands high-gain / high-coancestry / few-parents; OCS trades a little gain for diversity.
##
## Target-agnostic: receives breeding values (caller passes market-weighted GCA) + marker dosages.
## rrBLUP for marker effects; genomic-core build_G for G.
##
##   Rscript cross-recycling.R <cfg.json>
##   cfg = { pool, members:[id], bv:[index BV], dosage:[[m...] per member],
##           n_crosses, max_per_parent?, sel_prop?, coancestry_target? }
suppressWarnings(suppressPackageStartupMessages({ library(jsonlite); library(rrBLUP) }))
.self <- { a <- commandArgs(FALSE); f <- sub("^--file=", "", a[grep("^--file=", a)]); if (length(f)) dirname(normalizePath(f)) else "." }
source(file.path(.self, "genomic-core.R"))   # build_G

cfg <- jsonlite::fromJSON(paste(readLines(commandArgs(trailingOnly = TRUE)[1], warn = FALSE), collapse = "\n"))
ids <- as.character(cfg$members); n <- length(ids)
g   <- as.numeric(cfg$bv); names(g) <- ids                       # index breeding value per member
M   <- matrix(as.numeric(unlist(cfg$dosage)), nrow = n, byrow = TRUE); rownames(M) <- ids   # member × marker
N_CROSS  <- if (!is.null(cfg$n_crosses)) as.integer(cfg$n_crosses) else 10L
MAXPP    <- if (!is.null(cfg$max_per_parent)) as.integer(cfg$max_per_parent) else N_CROSS   # usefulness is diversity-blind by default
SEL_PROP <- if (!is.null(cfg$sel_prop)) as.numeric(cfg$sel_prop) else 0.10
i_sel <- dnorm(qnorm(1 - SEL_PROP)) / SEL_PROP                   # selection intensity for the top SEL_PROP

## ---- substrate: G (coancestry) + marker effects on the index (for σ) --------------------------
G <- build_G(M, ids)
Gr <- G + diag(1e-4, n)
## marker effects for the progeny-variance term — estimated on a TRAINING set (the full pool germplasm,
## not just this one pool's lines) so the 200 effects are identifiable and σ actually bites. Falls back
## to the focal members when no training set is supplied.
train_bv  <- if (!is.null(cfg$train_bv)) as.numeric(cfg$train_bv) else g
train_dos <- if (!is.null(cfg$train_dosage)) matrix(as.numeric(unlist(cfg$train_dosage)), nrow = length(train_bv), byrow = TRUE) else M
ms <- rrBLUP::mixed.solve(y = train_bv, Z = train_dos)           # ridge marker effects on the index BV
a2 <- as.numeric(ms$u)^2                                         # per-marker squared additive effect

## ---- every within-pool cross: midparent, progeny σ, usefulness, parental coancestry ------------
pairs <- if (n >= 2) t(combn(n, 2)) else matrix(integer(0), 0, 2)
crosses <- lapply(seq_len(nrow(pairs)), function(r) {
  i <- pairs[r, 1]; j <- pairs[r, 2]; d <- M[i, ] - M[j, ]
  sigma <- 0.5 * sqrt(sum(a2 * d * d)); mid <- (g[i] + g[j]) / 2
  list(p1 = ids[i], p2 = ids[j], midparent = unname(mid), sigma = unname(sigma),
       usefulness = unname(mid + i_sel * sigma), coancestry = unname(G[i, j]))
})
U <- sapply(crosses, `[[`, "usefulness")

## ---- realized parental contributions of a discrete plan → its place on the frontier -----------
plan_metrics <- function(pick) {
  cc <- setNames(numeric(n), ids)
  for (r in pick) { cc[crosses[[r]]$p1] <- cc[crosses[[r]]$p1] + 1; cc[crosses[[r]]$p2] <- cc[crosses[[r]]$p2] + 1 }
  if (sum(cc) > 0) cc <- cc / sum(cc)
  list(contrib = cc, gain = sum(g * cc), coancestry = as.numeric(t(cc) %*% G %*% cc),
       eff_parents = if (sum(cc^2) > 0) 1 / sum(cc^2) else 0)
}

## ---- method 1: USEFULNESS — greedy top-U (diversity-blind; the benchmark OCS improves on) -------
greedy_plan <- function(score, cap) {
  ord <- order(-score); use <- setNames(integer(n), ids); picked <- integer(0)
  for (r in ord) {
    if (length(picked) >= N_CROSS) break
    p1 <- crosses[[r]]$p1; p2 <- crosses[[r]]$p2
    if (use[p1] >= cap || use[p2] >= cap) next
    picked <- c(picked, r); use[p1] <- use[p1] + 1; use[p2] <- use[p2] + 1
  }
  picked
}
useful_pick <- greedy_plan(U, MAXPP)
um <- plan_metrics(useful_pick)

## ---- OCS frontier: max g'c − λ c'Gc  s.t. 1'c = 1, c ≥ 0 ----------------------------------------
## Solved as a bounded QP by iterative active set: solve the equality-constrained optimum on the free set,
## drop any parent that went negative, re-solve, repeat. This reaches the corners (λ→0 ⇒ all weight on the
## best parent: max gain, high coancestry; λ→∞ ⇒ the minimum-coancestry portfolio), so the frontier is the
## true upper envelope and the discrete plans land on/under it.
solve_ocs <- function(lambda) {
  active <- rep(TRUE, n)
  for (it in seq_len(60)) {
    idx <- which(active)
    Gi <- solve(Gr[idx, idx, drop = FALSE])
    a <- Gi %*% g[idx]; b <- Gi %*% rep(1, length(idx))
    mu <- (2 * lambda - sum(a)) / sum(b)
    cf <- as.numeric((a + mu * b) / (2 * lambda))
    if (all(cf >= -1e-9)) { c <- numeric(n); c[idx] <- pmax(0, cf); return(c / sum(c)) }
    active[idx[cf < 0]] <- FALSE
    if (!any(active)) { c <- numeric(n); c[which.max(g)] <- 1; return(c) }
  }
  c <- numeric(n); c[which.max(g)] <- 1; c
}
lambdas <- exp(seq(log(0.004), log(80), length.out = 30))
frontier <- lapply(lambdas, function(l) { c <- solve_ocs(l)
  list(gain = sum(g * c), coancestry = as.numeric(t(c) %*% G %*% c), contributions = c) })
coan_min <- min(sapply(frontier, `[[`, "coancestry"))            # the diversity floor (min achievable coancestry)

## ---- method 2: OCS — hold group coancestry at HALF the greedy plan's excess over the floor ------
target <- if (!is.null(cfg$coancestry_target)) as.numeric(cfg$coancestry_target) else coan_min + 0.25 * (um$coancestry - coan_min)
op <- frontier[[ which.min(abs(sapply(frontier, `[[`, "coancestry") - target)) ]]
c_ocs <- op$contributions; names(c_ocs) <- ids
quota <- pmax(0, round(c_ocs * 2 * N_CROSS)); names(quota) <- ids  # mating slots per parent ∝ optimal contribution
ocs_pick <- local({
  ord <- order(-U); rem <- quota; picked <- integer(0)
  for (r in ord) { if (length(picked) >= N_CROSS) break
    p1 <- crosses[[r]]$p1; p2 <- crosses[[r]]$p2
    if (rem[p1] <= 0 || rem[p2] <= 0) next
    picked <- c(picked, r); rem[p1] <- rem[p1] - 1; rem[p2] <- rem[p2] - 1 }
  for (r in ord) { if (length(picked) >= N_CROSS) break; if (!(r %in% picked)) picked <- c(picked, r) }  # top-up if quotas too tight
  picked
})
om <- plan_metrics(ocs_pick)

## ---- emit -------------------------------------------------------------------------------------
plan_json <- function(pick) lapply(pick, function(r) { x <- crosses[[r]]
  list(p1 = x$p1, p2 = x$p2, midparent = round(x$midparent, 4), sigma = round(x$sigma, 4),
       usefulness = round(x$usefulness, 4), coancestry = round(x$coancestry, 4)) })
plan_block <- function(pick, m) list(
  crosses = plan_json(pick), n_crosses = length(pick),
  n_parents = length(unique(unlist(lapply(pick, function(r) c(crosses[[r]]$p1, crosses[[r]]$p2))))),
  gain = round(m$gain, 4), coancestry = round(m$coancestry, 4), eff_parents = round(m$eff_parents, 2))

out <- list(recycling = list(
  pool = cfg$pool, n_members = n, sel_prop = SEL_PROP, selection_intensity = round(i_sel, 3), n_crosses = N_CROSS,
  members = lapply(seq_len(n), function(k) list(id = ids[k], bv = round(unname(g[k]), 4),
                                                contribution = round(unname(c_ocs[k]), 4))),
  candidates = plan_json(order(-U)[seq_len(min(length(U), 60))]),     # the top candidate field (by usefulness)
  usefulness_plan = plan_block(useful_pick, um),
  ocs_plan = c(plan_block(ocs_pick, om), list(target_coancestry = round(target, 4))),
  frontier = lapply(frontier, function(f) list(gain = round(f$gain, 4), coancestry = round(f$coancestry, 4))),
  comparison = list(
    coancestry_floor = round(coan_min, 4),
    usefulness_point = list(gain = round(um$gain, 4), coancestry = round(um$coancestry, 4), eff_parents = round(um$eff_parents, 2)),
    ocs_point = list(gain = round(om$gain, 4), coancestry = round(om$coancestry, 4), eff_parents = round(om$eff_parents, 2)),
    shared_crosses = length(intersect(useful_pick, ocs_pick)),
    gain_cost = round(um$gain - om$gain, 4),                          # gain OCS gives up
    coancestry_saved = round(um$coancestry - om$coancestry, 4),       # inbreeding OCS avoids
    eff_parents_gained = round(om$eff_parents - um$eff_parents, 2))    # diversity OCS preserves
))
cat(jsonlite::toJSON(out, auto_unbox = TRUE, null = "null", na = "null", digits = NA))
