# The stability moat: BLUPs must recover the known (simulated) genetic values.
# If a refactor breaks the science, these fail loudly.

test_that("simulate_tomato_met produces a well-formed MET with known truth", {
  d <- simulate_tomato_met(n_geno = 30, n_env = 3, n_rep = 2, seed = 7)
  expect_true(all(c("genotype", "env", "block", "yield", "brix") %in% names(d)))
  expect_equal(nrow(d), 30 * 3 * 2)
  truth <- attr(d, "true_geno_means")
  expect_equal(nrow(truth), 30)
})

# Regression floor: 0.85 cleanly separates a working engine (~0.89-0.97 across
# seeds/traits) from a broken one (~0). Yield is the most GxE-plastic trait, so
# its BLUP<->truth accuracy is the lowest and sets the floor.
ACC_FLOOR <- 0.85

test_that("lme4 BLUPs recover true genetic values for every trait", {
  d <- simulate_tomato_met(n_geno = 40, n_env = 3, n_rep = 3, seed = 1)
  truth <- attr(d, "true_geno_means")
  for (tr in c("yield", "brix", "fruit_wt", "maturity")) {
    fit <- fit_genotype_values(d, tr, engine = "lme4", genotype_effect = "random")
    m <- merge(fit$effects, truth[, c("genotype", tr)], by = "genotype")
    expect_gt(stats::cor(m$value, m[[tr]]), ACC_FLOOR)
    expect_true(fit$heritability > 0 && fit$heritability <= 1)
  }
})

test_that("rrBLUP two-step recovers genetic ranking and identifiable h2", {
  d <- simulate_tomato_met(n_geno = 40, n_env = 3, n_rep = 3, seed = 1)
  truth <- attr(d, "true_geno_means")
  fit <- fit_genotype_values(d, "yield", engine = "rrblup")
  m <- merge(fit$effects, truth[, c("genotype", "yield")], by = "genotype")
  expect_gt(stats::cor(m$value, m$yield), ACC_FLOOR)
  expect_true(fit$heritability > 0 && fit$heritability < 1)
})

test_that("fixed-effect BLUEs are returned and finite", {
  d <- simulate_tomato_met(n_geno = 20, n_env = 2, n_rep = 2, seed = 3)
  fit <- fit_genotype_values(d, "brix", genotype_effect = "fixed")
  expect_equal(unique(fit$effects$type), "BLUE")
  expect_true(all(is.finite(fit$effects$value)))
})

test_that("too-little data errors clearly", {
  d <- data.frame(genotype = "A", env = "E1", block = "B1", yield = 1)
  expect_error(fit_genotype_values(d, "yield"), "Not enough data")
})
