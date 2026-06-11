# Selection index ordering + AI tool-op behavior.

make_bundle <- function() {
  d <- simulate_tomato_met(n_geno = 30, n_env = 3, n_rep = 2, seed = 5)
  analyze_trial(d, traits = c("yield", "brix", "fruit_wt", "maturity"))
}

test_that("selection index is sorted and weighting changes the ranking sensibly", {
  d <- simulate_tomato_met(n_geno = 30, n_env = 3, n_rep = 2, seed = 5)
  eff <- analyze_trial(d, traits = c("yield", "brix"))$effects

  w_yield <- build_selection_index(eff, c(yield = 5, brix = 0), c(yield = 1, brix = 1))
  # index must be in descending order
  expect_true(all(diff(w_yield$index) <= 1e-9))
  # the #1 by a yield-only index must be the top-yielding genotype
  top_geno <- w_yield$genotype[1]
  best_yield_geno <- eff$yield$genotype[which.max(eff$yield$value)]
  expect_equal(top_geno, best_yield_geno)
})

test_that("analyze_trial returns a complete bundle", {
  b <- make_bundle()
  expect_equal(length(b$traits), 4)
  expect_true(!is.null(b$index))
  expect_named(b$heritability, b$traits)
})

test_that("AI ops return grounded data and reject bad input", {
  b <- make_bundle()
  s <- op_summarize(b)
  expect_equal(s$n_traits, 4)

  top <- op_top_selections(b, n = 5)
  expect_equal(nrow(top), 5)
  expect_equal(top$rank, 1:5)

  ry <- op_rank_by_trait(b, "yield", n = 3)
  expect_equal(nrow(ry), 3)
  expect_true(ry$value[1] >= ry$value[3])

  expect_error(op_rank_by_trait(b, "not_a_trait"), "Unknown trait")

  # dispatch routes correctly and uses defaults
  d1 <- ai_dispatch(b, "summarize")
  expect_equal(d1$engine, b$engine)
  expect_error(ai_dispatch(b, "bogus_tool"), "Unknown tool")
})
