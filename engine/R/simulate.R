## simulate.R — synthetic tomato multi-environment trial (MET)
## IP-clean: fully simulated, no real germplasm. Used to build & test the engine.
## Pure base R (no MASS) so it installs nowhere new.

# small multivariate normal via Cholesky (avoids MASS dependency)
.rmvn <- function(n, mu, Sigma) {
  L <- chol(Sigma)
  Z <- matrix(stats::rnorm(n * length(mu)), nrow = n)
  sweep(Z %*% L, 2, mu, "+")
}

#' Simulate a tomato MET dataset.
#' @export
#' @param n_geno   number of genotypes (lines/hybrids)
#' @param n_env    number of environments (site-years)
#' @param n_rep    reps (blocks) per environment
#' @param seed     RNG seed for reproducibility
#' Traits: yield (t/ha), brix (deg), fruit_wt (g), maturity (days).
#' Built-in structure: a yield<->brix genetic trade-off (classic in processing
#' tomato), real GxE on yield, block effects, and trait-specific heritabilities.
simulate_tomato_met <- function(n_geno = 60, n_env = 4, n_rep = 3, seed = 42) {
  set.seed(seed)
  traits <- c("yield", "brix", "fruit_wt", "maturity")

  # genetic (genotype) means: correlated across traits.
  # negative yield-brix genetic correlation (-0.45) is the headline trade-off.
  G_corr <- matrix(c(
    1.00, -0.45,  0.30, -0.10,
   -0.45,  1.00, -0.20,  0.15,
    0.30, -0.20,  1.00, -0.05,
   -0.10,  0.15, -0.05,  1.00), 4, 4, byrow = TRUE)
  g_sd   <- c(yield = 8, brix = 0.45, fruit_wt = 7, maturity = 3.5)   # genetic SDs
  g_mean <- c(yield = 85, brix = 5.0, fruit_wt = 70, maturity = 115)  # trait means
  G_cov  <- diag(g_sd) %*% G_corr %*% diag(g_sd)
  g_eff  <- .rmvn(n_geno, g_mean, G_cov)
  colnames(g_eff) <- traits
  geno_names <- sprintf("TOM-%03d", seq_len(n_geno))

  # environment main effects (shift the whole site up/down per trait)
  env_eff <- .rmvn(n_env, rep(0, 4),
                   diag(c(yield = 12, brix = 0.6, fruit_wt = 6, maturity = 4)^2))
  colnames(env_eff) <- traits
  env_names <- sprintf("SITE-%d", seq_len(n_env))

  # GxE SDs (yield is most plastic; brix/maturity more stable)
  ge_sd  <- c(yield = 6, brix = 0.25, fruit_wt = 3, maturity = 1.5)
  # residual (plot) SDs -> drive heritability
  res_sd <- c(yield = 7, brix = 0.35, fruit_wt = 5, maturity = 2.2)

  rows <- list()
  k <- 0
  for (e in seq_len(n_env)) {
    for (r in seq_len(n_rep)) {
      block_shift <- stats::rnorm(4, 0, c(2.5, 0.12, 1.5, 0.8))  # block effect per trait
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
          brix     = round(vals[["brix"]], 2),
          fruit_wt = round(vals[["fruit_wt"]], 1),
          maturity = round(vals[["maturity"]], 1),
          stringsAsFactors = FALSE
        )
      }
    }
  }
  out <- do.call(rbind, rows)
  attr(out, "true_geno_means") <- data.frame(genotype = geno_names, g_eff)
  out
}
