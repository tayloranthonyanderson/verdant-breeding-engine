# Workflow Map — Analysis Engine (Phase 1 slice)

This maps the breeder's daily loop the MVP must serve, the modeling decisions it
automates, and the *minimal* data model needed to run it. We build to this, no more.

## The breeder's loop (what actually happens)
1. Breeder runs a **trial**: many genotypes (lines/hybrids), in a **design**
   (reps/blocks), possibly across **environments** (sites × years), measured for
   **traits** (yield, brix, fruit weight, maturity, disease, etc.).
2. They have a messy table and a question: *which entries do I advance?*
3. Today they either eyeball means (wrong) or pay/beg for a statistician.

## What the engine does (input → compute → output)

### Input
A tidy long table + a small bit of metadata:
- columns: `genotype`, `environment` (optional), `rep`/`block`, optional `row`/`col`,
  and one or more trait columns.
- metadata: design type, which factors are fixed vs random, trait directions
  (higher-better / lower-better) and weights.

### Compute — the decisions we automate (this is the product's brain)
- **Single trial:** `trait ~ 1 + (1|genotype) + (1|block)` →
  genotype random ⇒ **BLUPs** (for selection). Switch genotype to fixed ⇒
  **BLUEs** (for unbiased comparison/reporting).
- **Multi-environment (MET):** add `environment`, `genotype:environment` (GxE),
  and nesting of blocks within environment. Decide fixed/random per use case.
- **Heritability / repeatability** (e.g. Cullis or standard h²), genetic
  correlations among traits, and **GxE / stability** metrics.
- **Selection index:** combine standardized trait BLUPs by user weights &
  directions into a single rank.
- **Validation first** — ✅ built (ADR-0021): pre-fit **Data Quality** (robust outliers,
  missingness, factor-level sanity, box-and-whisker distributions) surfaced in plain language
  before any model runs, plus post-fit **Model QC** (residual diagnostics, normal Q-Q, the
  raw→trend→residual field triptych). Advisory — the breeder excludes flagged data and re-runs.

### Output
- Per-genotype BLUP/BLUE table per trait.
- Heritability + reliability per trait.
- **Ranked selection list** by index; sliders to re-weight traits live.
- Diagnostics — ✅ built: residual-vs-fitted, normal Q-Q, spatial field maps, influential
  observations, convergence, and the chosen model + *why* (the Model Planner's decision log).

## Minimal v1 data model (file-based, NOT a DB server yet)
Just enough to run the slice. Persistence comes in Phase 4.

```
observations (long format, the one table the user uploads)
  genotype        : chr   # entry name
  environment     : chr   # optional; site-year label
  rep / block     : chr   # design factors
  row, col        : int   # optional spatial
  <trait columns> : dbl   # one column per measured trait

traits_config (small, set in the UI)
  trait           : chr
  direction       : +1 / -1   # higher-better / lower-better
  weight          : dbl       # for the selection index

trial_meta
  design_type     : chr   # rcbd | augmented | alpha-lattice | met
  genotype_effect : fixed | random
```

## Tech for the slice
- **R + Shiny** (you can read/extend all of it).
- Modeling: `lme4::lmer` / `SpATS` (trial-scale) or **BLUPF90/AIREMLF90** (multi-trait
  variance components & genomic scale) (+ `statgenSTA`/`statgenGxE` for METs). sommer
  avoided — memory/scale.
- Data wrangling: `tidyverse`. Tables/plots: `gt` / `ggplot2`.
- No database, no accounts, no cloud yet — a local app you run on real data.

## Definition of done for Phase 0
You load one of your own real tomato trials and the app gives you BLUPs, a
heritability, and a ranked selection index you trust — replacing a script you'd
otherwise hand-write.
