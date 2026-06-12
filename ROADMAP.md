# Roadmap

Captured so nothing is lost — but only Phase 1 is "now." Everything below it is
deliberately deferred until the slice above it is real and validated.

> **Status (2026-06-11).** The Phase-1 analysis engine is largely built and
> validated on G2F, and we have crossed early into the genomic work (Phase 7).
> **Done:** two-stage MET (SpATS spatial de-trending → multi-trait AI-REML,
> validated vs lme4 to 3 sig figs); the **deterministic Model Planner** with
> data-readiness gating and a "Model & data readiness" UI panel (ADR-0016);
> **crop-agnostic MET seams** (ADR-0015); **genotype storage + ingestion** —
> 437,214 SNPs × 4,928 hybrids packed into the BrAPI genotyping tables (ADR-0017).
> **In progress:** genomic prediction — VanRaden **G** built and validated
> (PSD, GBLUP h²≈0.20, GEBVs cluster by family), rrBLUP as the CV engine; the
> native BLUPF90 genomic path, the validation suite, pedigree **A** / single-step
> **H**, and the genomic UI are next (see Phase 7).

## Phase 0 — Plan + thin slice  *(current)*
- Product brief, this roadmap, analysis-engine workflow map.
- A minimal working R/Shiny slice: upload CSV → fit single-trial mixed model →
  show BLUPs + heritability + a basic selection-index ranking.
- Goal: something *you* would actually use on a real trial.

## Phase 1 — Analysis engine (the MVP)  *(largely built + validated)*
- ✅ Single-trial and **multi-environment (MET)** models; genotype as random
  (BLUPs for selection) vs fixed (BLUEs for comparison). Two-stage MET — SpATS
  within-environment spatial de-trending (Stage 1) → multi-trait AI-REML / BLUPF90
  (Stage 2) for the across-environment genetic covariance; validated vs lme4 to
  3 sig figs.
- ✅ Heritability / repeatability, genetic correlations; **GxE gated by data
  readiness** — fires only in a one-stage plot-level fit with connectivity +
  replication (two-stage-on-means is non-identifiable, and one-stage GxE is
  compute-bound at full G2F scale), surfaced as a readiness unlock (ADR-0016).
- ✅ Interactive **selection index** with user-set trait weights and directions,
  plus the genetically-aware desired-gains index and the live divergence view.
- Data validation: balance, missingness, outliers, factor-level sanity.
- ✅ **Deterministic Model Planner** (ADR-0016): shared data-readiness diagnostics
  (grid / replication / connectivity / scale) gate spatial / genotype-effect /
  GxE / single-vs-two-stage / engine, each decision explained, with a "Model &
  data readiness" UI panel. **Crop-agnostic seams** (ADR-0015): generic plot
  record; dataset column names confined to ingestion.
- Engines: `lme4` / `SpATS` / `statgenSTA` / `statgenGxE` for trial-scale fits;
  **BLUPF90** (AIREMLF90 multi-trait REML; ssGBLUP) for multi-trait variance
  components & genomic scale, selected via the **engine registry** capability
  match (ADR-0016) and ADR-0014 scale tiering. Avoid sommer (memory/scale),
  ASReml (cost/support), INLA (memory).

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

## Phase 7 — Genomics & cross planning  *(genomic prediction in progress)*
- ✅ **Genotype storage + ingestion (ADR-0017):** BrAPI VariantSet / Variant /
  Sample / CallSet tables with packed dosage `bytea`; the G2F genotype panel
  ingested — 437,214 SNPs × 4,928 hybrids (~501 MB compressed); 1,153/1,198 MET
  hybrids genotyped.
- 🔄 **Genomic prediction foundation (branch `feat/genomic-prediction`):**
  `grm.ts` decodes packed CallSets → dosage matrix; `relationship.R` builds
  VanRaden **G** scaled to mean-diagonal 1; `genomic-check.ts` drives it. G
  validated on G2F (PSD, GBLUP h²≈0.20 for hybrid-mean yield, GEBVs cluster by
  family); **rrBLUP** installed as the cross-validation engine.
- **Next (genomic prediction):**
  - Native **preGSf90 / postGSf90** BLUPF90 genomic path + **cross-engine
    concordance** (rrBLUP vs BLUPF90 GEBVs correlate ~1.0).
  - **Validation suite:** k-fold CV predictive ability (identity / A / G), LR
    accuracy / bias / dispersion, GRM sanity, known-structure recovery —
    committed report; CV gates the UI.
  - **Pedigree A + single-step H (ssGBLUP)** — native preGSf90 H; brings the 45
    ungenotyped hybrids back via pedigree.
  - **Genomic UI:** GRM canvas heatmap, PCA / population structure, deployment
    diagnostics, a relationship "lens" workspace (Identity · A · G · H) with
    heuristic-default + cross-validation-on-demand, and the phenotypic-BLUP-vs-
    genomic-GEBV teaching insight.
  - Model selection: **heuristic default + cross-validation on demand**.
- Genomic prediction via **rrBLUP two-step** (fast/reliable) → **BLUPF90** for
  scale; tomato variant library used for demo insights and showcase predictions.
- AI-assisted **cross/parent planner**: given data + goals, recommend crosses
  (optimize genetic gain vs. inbreeding/diversity).

## Parking lot (ideas, unsorted)
- Pedigree management & coancestry.
- Multi-trait economic selection indices with $ weights.
- Benchmarking/anonymous variety performance network effects.
