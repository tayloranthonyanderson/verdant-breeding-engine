# Breeding Analysis Engine — MVP slice

A small, working vertical slice of the breeding analytics product: upload a
trial, get correct mixed-model **BLUPs/BLUEs**, **heritability**, and a live
**selection-index ranking**. Built in R/Shiny so it stays legible and extensible.

See [PRODUCT.md](PRODUCT.md) for the why, [ROADMAP.md](ROADMAP.md) for what's
next, and [docs/analysis-engine-workflow.md](docs/analysis-engine-workflow.md)
for the workflow + data model this slice implements.

## Run it

```r
# from this folder
install.packages(c("lme4", "shiny", "rrBLUP"))   # once
shiny::runApp("app.R")
```

Then click **"Use synthetic tomato demo"** to load a simulated MET, pick traits,
hit **Analyze**, and play with the selection-index weight sliders.

## Layout

| File | Purpose |
|---|---|
| `app.R` | Shiny UI + glue |
| `R/engine.R` | **Pluggable engine**: one `fit_genotype_values()` contract, with `lme4` (default) and `rrBLUP` two-step backends. A BLUPF90 adapter slots in here later behind the same signature. |
| `R/selection_index.R` | Standardize → weight → rank traits into one index |
| `R/simulate.R` | IP-clean synthetic tomato MET generator (no real germplasm) |
| `data/` | Generated demo CSV |

## Engine strategy

`lme4` for fast, reliable everyday fits. `rrBLUP` two-step for the genomic path
(pass a genomic relationship matrix `K` later for true GBLUP). Heavy/at-scale
genomic jobs will route to compiled **BLUPF90** binaries behind the same
interface — verify commercial licensing before shipping. Deliberately avoiding
sommer (scale crashes), ASReml (cost/support), and INLA-as-core (memory).

## Status

Phase 0 — proof the workflow on synthetic data. Not yet: persistence, accounts,
multi-trait genetic correlations in the index, NL Q&A. Those are roadmap.
