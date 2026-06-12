# Roadmap

Captured so nothing is lost — but only Phase 1 is "now." Everything below it is
deliberately deferred until the slice above it is real and validated.

## Phase 0 — Plan + thin slice  *(current)*
- Product brief, this roadmap, analysis-engine workflow map.
- A minimal working R/Shiny slice: upload CSV → fit single-trial mixed model →
  show BLUPs + heritability + a basic selection-index ranking.
- Goal: something *you* would actually use on a real trial.

## Phase 1 — Analysis engine (the MVP)
- Single-trial and **multi-environment (MET)** models; genotype as random
  (BLUPs for selection) vs fixed (BLUEs for comparison).
- Heritability / repeatability, genetic correlations, GxE & stability metrics.
- Interactive **selection index** with user-set trait weights and directions.
- Data validation: balance, missingness, outliers, factor-level sanity.
- Engines: `lme4` / `SpATS` / `statgenSTA` / `statgenGxE` for trial-scale fits;
  **BLUPF90** (AIREMLF90 multi-trait REML; ssGBLUP) for multi-trait variance
  components & genomic scale. Avoid sommer (memory/scale), ASReml (cost/support),
  INLA (memory).

## Phase 2 — Natural-language Q&A
- Ask questions over the analyzed results ("which lines were most stable across
  sites?"). LLM translates to queries/operations on the result objects.
- The headline differentiator; lighter stats, leans on Phase 1 outputs.

## Phase 3 — Trial designer
- Generate sound designs (RCBD, augmented, alpha-lattice, p-rep) with a layout
  map and field/greenhouse plot plan. Upstream of analysis; closes the loop.

## Phase 4 — Persistence & multi-user
- Real database + accounts (this is when DB architecture is actually warranted).
- Projects, trials, traits, history. Migrate from file-based v1.

## Phase 5 — Mobile field data capture
- Phone/tablet data entry against a trial's plot plan; offline-capable.
- Barcode/QR plot scanning; on-the-spot validation.

## Phase 6 — Image-based phenotyping
- Extract traits from images (fruit count/size/color, disease scoring).
- Likely a Python service; start with one or two high-value traits.

## Phase 7 — Genomics & cross planning
- Genomic prediction via **rrBLUP two-step** (fast/reliable) → **BLUPF90** for
  scale; tomato variant library used for demo insights and showcase predictions.
- AI-assisted **cross/parent planner**: given data + goals, recommend crosses
  (optimize genetic gain vs. inbreeding/diversity).

## Parking lot (ideas, unsorted)
- Pedigree management & coancestry.
- Multi-trait economic selection indices with $ weights.
- Benchmarking/anonymous variety performance network effects.
