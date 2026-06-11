# ADR-0013 — Transparent index: standardization, selection modes, contribution normalization

**Status:** Accepted (2026-06-11)

Refines the "transparent weighted index" of [ADR-0006](0006-mvp-analysis-scope.md) with the concrete
math, after a design pass that briefly tried — and reverted — a genetic-SD variant.

## Context
The transparent weighted index is a **communication/alignment instrument**: the breeder sets each
trait's direction and weight, weights normalize to 100%, and the ranking recomputes live in the
browser. Its entire job is *transparency* — the slider must mean what it says. Two questions had to
be settled to make it honest:
1. **What scale do we standardize the BLUPs by** before weighting?
2. **How do we combine heterogeneous selection objectives** — maximize, minimize, and "hit a
   target" — when they sit on different functional scales (linear vs quadratic)?

## Decision

**Selection modes (per trait).** With `z = (BLUP − mean) / sd`:
- `max` → merit `= +z`; `min` → merit `= −z` (linear);
- `target` → merit `= −((z − z_target)²)` — a quadratic penalty so genotypes farther from the
  optimum are increasingly discounted. The target is entered in raw trait units; the UI shows it on
  the trait's BLUP distribution so the breeder places it on real data, not into a void.

**Standardize BLUPs by their empirical sample SD (unit variance), NOT by genetic √Vg.** Unit-variance
is what keeps the weight slider honest: for linear traits `var(contribution_i) = w_i²`, so a 30%
weight is genuinely 30% of the influence. Standardizing by √Vg instead makes
`var(z_i) = reliability_i`, which silently tilts the realized weights by each trait's reliability —
information the breeder can't see. Reliability-weighting is a legitimate *selection* philosophy, but
it is the opposite of *transparent*, so it does not belong in this tool.

**Normalize each trait's merit COLUMN to mean 0 / unit SD before weighting.** This is the step that
makes mixed objectives combinable: the quadratic `target` term otherwise reaches ~−13 while linear
terms sit at ~±3, so a nominally-30% target trait dominates. Column-normalization puts every trait on
one footing (honest weights hold across modes), is an **affine rescale** so the convex
"increasingly-penalized" structure is preserved in the ranking, and re-centers the target term so it
reads **symmetrically around zero** (near-target = positive, far = negative) like every other trait.
For `max`/`min` it is a no-op (±z is already mean-0/unit-variance), so the common path is unchanged.

**√Vg is computed and echoed per trait, but reserved for Smith–Hazel.** The kernel emits
`traits[].genetic_sd` (√ of the genotype variance component). The transparent index ignores it; the
genetically-aware index (ADR-0006) is where genetic variance/covariance belongs, and its **divergence**
from the transparent index is the headline insight.

**The kernel owns the computation; the client reproduces it exactly.** R standardizes, builds merit,
column-normalizes, and weights; the live client mirrors the same arithmetic (empirical sample SD,
n−1) so re-weighting in the browser is numerically identical to the engine. Verified to displayed
precision in both `max/min` and `target` modes.

## Consequences
- The transparent index stays genuinely transparent — the slider maps directly to influence.
- Target and max/min traits coexist on a comparable scale at any heritability (the fix is structural,
  not a low-h² accident).
- The stacked contribution chart reads uniformly: right of zero = better than the trial average for
  that trait's goal; left = worse.
- `genetic_sd` plumbing exists ahead of need; Smith–Hazel consumes it without a contract change.

## Alternatives rejected
- **√Vg (genetic-SD) standardization for the transparent index:** reliability-tilts the weights
  invisibly, defeating the tool's purpose. Briefly implemented, then reverted. (Kept for Smith–Hazel.)
- **Raw (un-normalized) quadratic merit:** the target penalty (~−13) swamps linear terms (~±3), so a
  30% weight behaves like ~80%. The dishonesty that motivated this ADR.
- **Linear target penalty (`−|z − z_target|`):** sits on the linear scale but loses the
  increasingly-penalized convexity the breeder asked for.
- **Bounded desirability index ([0,1], Derringer–Suich):** a viable all-positive reframing and the
  textbook tool for mixing target + max traits, but a *different index*; deferred rather than adopted
  so the transparent index stays a standardized-weight instrument.
