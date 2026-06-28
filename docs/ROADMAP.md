# Roadmap

Captured so nothing is lost, but only Phase 1 is "now." Everything below it is
deliberately deferred until the slice above it is real and validated.

> **Status (2026-06-14).** Phase 1 (analysis engine) and Phase 7 (genomic prediction) are
> built and validated on G2F; the grounded NL Q&A layer (Phase 2) is live. Per-phase detail below.
>
> Done:
> - **Two-stage MET** — SpATS spatial de-trending → multi-trait AI-REML (BLUPF90), validated vs lme4 to 3 sig figs.
> - **Deterministic Model Planner** with data-readiness gating, plus crop-agnostic seams (ADR-0015/0016).
> - **Genotype storage + ingestion** — 437k SNPs × 4,928 genotypes (ADR-0017).
> - **Genomic prediction** — VanRaden G, pedigree A, single-step H GEBVs; rrBLUP (CV) + native BLUPF90/preGSf90 GBLUP (scale), cross-engine validated (GEBV r≈0.97); G > A > identity on every trait.
> - **Model Studio** (ADR-0018) — the planner recommends every model decision; the breeder overrides any and re-runs; the kernel validates and refuses infeasible ones.
> - **Combining ability (GCA/SCA)** (ADR-0019/0020) — topology-selected (line×tester, 614 lines × 13 testers), within-pool ranking, per-se↔GCA divergence, SCA heatmap, recorded advancement.
> - **Trust layer** (ADR-0021) — pre-fit Data Quality + post-fit Model QC on the fit's own residuals, advisory-only, with a non-destructive `data_overrides` overlay that re-plans on re-run.
> - **Selection-target (Segment) frame** (ADR-0023) — switch target market and the same trial re-ranks live under that market's objective (TPP). Trait-defined Segments over one shared TPE are built; the environment-defined TPE partition is next.
> - **Grounded NL Q&A** (Phase 2; ADR-0002/0004) — an "Ask your results" panel narrates the bundle and may state only numbers present in it (the AI explains, never computes), on a provider-abstracted LLM seam with a keyless offline fallback.
>
> Next: wire the answerer into the groundedness eval gate; a target-authoring assistant (NL → TPP+TPE); the ingestion front door (Trait Library + unit harmonization, ADR-0022); a `relationship_set` cache table + `sample.germplasm_id` mapping; forward-year predictive validation.

## Phase 0 — Plan + thin slice  *(current)*
- Product brief, this roadmap, analysis-engine workflow map.
- A minimal working R/Shiny slice: upload CSV → fit single-trial mixed model →
  show BLUPs + heritability + a basic selection-index ranking.
- Goal: something *you* would actually use on a real trial.

## Phase 1 — Analysis engine (the MVP)  *(largely built + validated)*
- ✅ Single-trial and **multi-environment (MET)** models; genotype as random
  (BLUPs for selection) vs fixed (BLUEs for comparison). Two-stage MET: SpATS
  within-environment spatial de-trending (Stage 1) → multi-trait AI-REML / BLUPF90
  (Stage 2) for the across-environment genetic covariance; validated vs lme4 to
  3 sig figs.
- ✅ Heritability / repeatability, genetic correlations; **GxE gated by data
  readiness**: fires only in a one-stage plot-level fit with connectivity +
  replication (two-stage-on-means is non-identifiable, and one-stage GxE is
  compute-bound at full G2F scale), surfaced as a readiness unlock (ADR-0016).
- ✅ Interactive **selection index** with user-set trait weights and directions,
  plus the genetically-aware desired-gains index and the live divergence view.
- ✅ **Data Quality + Model QC + raw-data selection: the trust layer (ADR-0021).** Two-pass QC: a
  column-blind **pre-fit** `data_quality` audit (raw MAD outliers, missingness, duplicate plot
  coordinates, near-duplicate genotype names, distribution/skew) and a no-refit **post-fit Model QC**
  (conditional residuals from the BLUPs: normality, heteroscedasticity, spatial-residual Moran's I,
  influential observations, h²/varcomp boundary). Advisory only: findings propose; the breeder
  **disposes** them (review / accept-all / auto, capped per trait) into a `data_overrides` **exclusion
  overlay** that never deletes stored data and re-plans on re-run (the sole data-to-model channel). Shipped
  as the **"Quality" journey step** with one-click excludes + a with/without comparison; validated on G2F
  MET in the browser. Trait-semantic checks (impossible-value ranges, datatype-aware distribution) await
  the Trait Library (Thread B, ADR-0022).
- ✅ **Deterministic Model Planner** (ADR-0016): shared data-readiness diagnostics
  (grid / replication / connectivity / scale) gate spatial / genotype-effect /
  GxE / single-vs-two-stage / engine, each decision explained, with a "Model &
  data readiness" UI panel. **Crop-agnostic seams** (ADR-0015): generic plot
  record; dataset column names confined to ingestion.
- ✅ **AI-recommended model selection + full breeder override** (ADR-0018,
  "Model Studio"): the planner *recommends* every decision; the breeder can
  *override* any of them (relationship / spatial / staging / GxE / engine) and
  re-run synchronously; the kernel validates each override against readiness and
  *refuses* infeasible ones with a reason (R still owns the science). Relationship
  / engine changes re-point from precomputed GEBVs in seconds; structural changes
  refit. The whole option menu is always shown; locked options explain what data
  would unlock them.
- Engines: `lme4` / `SpATS` / `statgenSTA` / `statgenGxE` for trial-scale fits;
  **BLUPF90** (AIREMLF90 multi-trait REML; ssGBLUP) for multi-trait variance
  components & genomic scale, selected via the **engine registry** capability
  match (ADR-0016) and ADR-0014 scale tiering. Avoid sommer (memory/scale),
  ASReml (cost/support), INLA (memory).

## Phase 2 — Natural-language Q&A
- Ask questions over the analyzed results ("which lines were most stable across
  sites?"). LLM translates to queries/operations on the result objects.
- The main new capability; lighter stats, leans on Phase 1 outputs.

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
- Extract traits from images (ear/kernel-row counts, kernel size/color, disease scoring).
- Likely a Python service; start with one or two high-value traits.

## Phase 7 — Genomics & cross planning  *(genomic prediction built)*
- ✅ **Genotype storage + ingestion (ADR-0017):** BrAPI VariantSet / Variant /
  Sample / CallSet tables with packed dosage `bytea`; the G2F genotype panel
  ingested: 437,214 SNPs × 4,928 genotypes (~501 MB compressed); 1,153/1,198 MET
  genotypes genotyped.
- ✅ **Relationship matrices + GEBVs:** `grm.ts` decodes packed CallSets into a dosage
  matrix and a fixed-width SNP export; `genomic-core.R` builds VanRaden **G** (scaled
  to mean-diag 1), pedigree **A**, and single-step **H** is blended (Legarra) so
  **all phenotyped lines are ranked, incl. the un-genotyped via the pedigree link**.
- ✅ **Two engines, cross-validated:** **rrBLUP** is the fast CV / default engine;
  **native BLUPF90 / preGSf90 GBLUP** is the scale engine. Cross-engine concordance
  committed (GEBV r≈0.97 rrBLUP vs BLUPF90; `docs/validation/cross-engine-concordance.md`).
- ✅ **Validation:** 5-fold × 2-rep CV predictive ability per model (identity / A /
  G) + LR bias/dispersion + GRM sanity + structure recovery; G > A > identity on
  every trait, committed report (`docs/validation/genomic-prediction.md`).
- ✅ **Genomic UI:** GRM canvas heatmap, PCA / population structure, deployment
  diagnostics (reliability / QC / distribution), the field-BLUP-vs-genomic-GEBV
  teaching divergence, and the **Model Studio** relationship + engine selector
  (ADR-0018): the planner recommends, the breeder overrides and re-runs.
- ✅ **Combining ability (GCA / SCA, ADR-0019/0020):** the hybrid trial decomposed
  into parental **GCA** (a random-effect BLUP, the parent-selection target, shrinkage baked in,
  with cross-degree as the visual trust signal) + **SCA**, in one unified random-effects mixed
  model whose parameterization is **selected from the measured cross-graph topology**
  (diallel / line×tester / sparse factorial; testers fixed when few in effect; ADR-0019;
  no fixed Griffing). Ranking is **within heterotic pool** (ADR-0020). A breeder-grade
  workspace: within-pool GCA ranking, hybrid ranking, the **per-se↔GCA divergence**
  (hidden gems / false promises), the SCA heatmap, Baker's ratio + variance components,
  the cross-graph readiness diagnostics, **native-trait gating** from directly-observed
  inbred data (dual-source gate), and recorded **advancement** (analysis→select→advance).
  Built on the G2F MET line×tester; the inbred-level facts (pool / per-se / native trait)
  are **synthetic scaffolding** until real maize inbred data lands. Combining ability is a
  **facet of the one trial analysis** (attached to the hybrid bundle, not a separate page): the
  web app is one journey-ordered page whose **Selection** workspace switches **level**
  (Hybrids / Parents·GCA) × **lens** (Stated / Genetically-optimal / Compare) over the shared
  index components; the desired-gains/Smith–Hazel lens runs on GCA too (kernel emits a GCA
  genetic-covariance).
- **Next (genomic):** a `relationship_set` cache table (keep big GRMs out of the
  JSONB bundle); `sample.germplasm_id` mapping; native BLUPF90 ssGBLUP (H) at
  scale; forward-year predictive validation (train year N, predict N+1).
- AI-assisted **cross/parent planner**: given data + goals, recommend crosses
  (optimize genetic gain vs. inbreeding/diversity).

## Parking lot (ideas, unsorted)
- Pedigree management & coancestry.
- Multi-trait economic selection indices with $ weights.
- Benchmarking/anonymous variety performance network effects.
