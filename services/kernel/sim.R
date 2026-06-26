## sim.R — synthetic maize multi-environment trial (MET) with KNOWN TRUTH.
## IP-clean: fully simulated, no real germplasm (ADR-0008). Pure base R (no MASS).
##
## This is the anchor of the kernel correctness suite: it generates data whose true genetic
## values, true entry-mean heritabilities, and true genetic-correlation matrix are KNOWN, so
## tests can assert the kernel recovers them. Ported from the disposable engine/ spike and
## extended to expose the truth the new multi-trait kernel must recover.

## small multivariate normal via Cholesky (avoids a MASS dependency)
.rmvn <- function(n, mu, Sigma) {
  L <- chol(Sigma)
  Z <- matrix(stats::rnorm(n * length(mu)), nrow = n)
  sweep(Z %*% L, 2, mu, "+")
}

#' Simulate a maize MET dataset with known truth.
#' @param n_geno number of genotypes (lines/hybrids)
#' @param n_env  number of environments (site-years)
#' @param n_rep  reps (blocks) per environment
#' @param seed   RNG seed for reproducibility
#'
#' Traits: yield (t/ha), grain protein (%), plant_height (g), maturity (days).
#' Built-in structure: a yield<->grain_protein genetic trade-off (classic in processing maize,
#' genetic correlation -0.45), real GxE on yield, block effects, trait-specific heritabilities.
#'
#' Returns a long data.frame (one row per plot) carrying three truth attributes:
#'   - "true_geno_means": data.frame(genotype, yield, grain_protein, plant_height, maturity) — the true g effects
#'   - "true_g_corr":     the 4x4 genetic correlation matrix the genotype means were drawn from
#'   - "true_entry_h2":   named numeric — true ENTRY-MEAN heritability per trait at this design
#'                        (H2 = s2_g / (s2_g + s2_ge/n_env + s2_res/(n_env*n_rep))); this is the
#'                        quantity a Cullis/line-mean h2 estimates, NOT the plot-level h2.
simulate_maize_met <- function(n_geno = 60, n_env = 4, n_rep = 3, seed = 42) {
  set.seed(seed)
  traits <- c("yield", "grain_protein", "plant_height", "maturity")

  ## genetic (genotype) means: correlated across traits.
  ## the negative yield-grain_protein genetic correlation (-0.45) is the headline trade-off.
  G_corr <- matrix(c(
    1.00, -0.45,  0.30, -0.10,
   -0.45,  1.00, -0.20,  0.15,
    0.30, -0.20,  1.00, -0.05,
   -0.10,  0.15, -0.05,  1.00), 4, 4, byrow = TRUE)
  dimnames(G_corr) <- list(traits, traits)
  g_sd   <- c(yield = 8, grain_protein = 0.45, plant_height = 7, maturity = 3.5)    # genetic SDs
  g_mean <- c(yield = 85, grain_protein = 5.0, plant_height = 70, maturity = 115)   # trait means
  G_cov  <- diag(g_sd) %*% G_corr %*% diag(g_sd)
  g_eff  <- .rmvn(n_geno, g_mean, G_cov)
  colnames(g_eff) <- traits
  geno_names <- sprintf("TOM-%03d", seq_len(n_geno))

  ## environment main effects (shift the whole site up/down per trait)
  env_eff <- .rmvn(n_env, rep(0, 4),
                   diag(c(yield = 12, grain_protein = 0.6, plant_height = 6, maturity = 4)^2))
  colnames(env_eff) <- traits
  env_names <- sprintf("SITE-%d", seq_len(n_env))

  ge_sd  <- c(yield = 6, grain_protein = 0.25, plant_height = 3, maturity = 1.5)    # GxE SDs (yield most plastic)
  res_sd <- c(yield = 7, grain_protein = 0.35, plant_height = 5, maturity = 2.2)    # residual (plot) SDs

  rows <- list()
  k <- 0
  for (e in seq_len(n_env)) {
    for (r in seq_len(n_rep)) {
      block_shift <- stats::rnorm(4, 0, c(2.5, 0.12, 1.5, 0.8))        # block effect per trait
      for (g in seq_len(n_geno)) {
        k <- k + 1
        ge  <- stats::rnorm(4, 0, ge_sd)
        res <- stats::rnorm(4, 0, res_sd)
        vals <- g_eff[g, ] + env_eff[e, ] + ge + block_shift + res
        rows[[k]] <- data.frame(
          genotype = geno_names[g],
          env      = env_names[e],
          block    = sprintf("%s-B%d", env_names[e], r),
          rep      = r,
          yield    = round(vals[["yield"]], 2),
          grain_protein     = round(vals[["grain_protein"]], 2),
          plant_height = round(vals[["plant_height"]], 1),
          maturity = round(vals[["maturity"]], 1),
          stringsAsFactors = FALSE
        )
      }
    }
  }
  out <- do.call(rbind, rows)

  ## --- truth the kernel must recover ---
  attr(out, "true_geno_means") <- data.frame(genotype = geno_names, g_eff,
                                             stringsAsFactors = FALSE)
  attr(out, "true_g_corr") <- G_corr
  ## entry-mean heritability at THIS design (what a Cullis/line-mean h2 estimates)
  s2_g <- g_sd^2; s2_ge <- ge_sd^2; s2_res <- res_sd^2
  attr(out, "true_entry_h2") <- s2_g / (s2_g + s2_ge / n_env + s2_res / (n_env * n_rep))
  out
}
