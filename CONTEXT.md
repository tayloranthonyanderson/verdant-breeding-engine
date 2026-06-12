# Verdant — Context & Glossary

Single-context domain doc for the whole product. Read this and the relevant
[ADRs](docs/adr/) before exploring or changing code. Decisions live in ADRs; this
file is the shared **vocabulary** and a one-screen orientation. Use these terms
exactly in code, tests, issues, and prose — don't drift to synonyms.

## What Verdant is
An **AI-native breeding management + analysis platform**. Beachhead: tomato breeders
at small/mid programs the incumbents price out. The promise: *upload your trial, get
the right answer (correct mixed-model BLUPs, heritability, a ranked selection index),
and ask your data questions in plain English — without a statistician on staff.*
See [PRODUCT.md](PRODUCT.md), [ROADMAP.md](ROADMAP.md), [docs/MVP-PLAN.md](docs/MVP-PLAN.md).

## The shape of the system (ADR-0001)
- **Compute kernel** — R; stateless; the *only* place statistics happen. A worker that
  runs analysis jobs and returns a **result bundle**. Owns model selection (ADR-0002).
- **Web tier** — TypeScript; owns API/orchestration, the GUI, and AI orchestration.
- **Seam** — a durable **job queue**; analysis enqueues, the R worker runs, the bundle
  is persisted, the UI subscribes. No request waits on a fit.
- **Source of truth** — Postgres; result bundles stored whole as JSONB.

## Product & architecture vocabulary
- **Engine contract** — the language-neutral seam between the web tier (TS), the compute
  kernel (R), and the solver service (Python): the `analyze()` **request** in, the **result
  bundle** out. Source of truth is the versioned JSON Schema under [`packages/contracts/`](packages/contracts/);
  each runtime binds to it rather than re-deriving the shape (DOMAIN-MODEL §6, ADR-0001).
- **Result bundle** — the single object an analysis produces: per-trait effects,
  heritability, varcomp, chosen-model rationale, warnings, selection index. Rendered by
  the GUI and queried by the AI; never re-derived elsewhere. Schematized in the **engine contract**.
- **Intent** — what the breeder is analyzing *for* (e.g. selection), sent with the data;
  the engine turns data + intent into a model choice. The web tier never authors a model spec.
- **Chosen-model rationale** — the engine's record of *what* model it picked and *why*;
  what the AI narrates. The AI explains the choice, never makes it (ADR-0002).
- **Visible, Reversible AI Agency** — core tenet: the AI may pull any lever a human can,
  always in the open, always undoable; it acts, but never in the dark or irreversibly (ADR-0003).
- **AI proposes / R owns / human confirms** — the product-wide division of labor: the AI
  proposes & explains messy human-judgment parts (mapping, layout, narrative); deterministic
  R owns the science; the human confirms before anything commits (ADR-0002/0007).
- **As-planted layout** — a first-class object: the *actual* physical arrangement of plots
  in the field, gaps/obstacles/non-contiguity and all. Distinct from the **as-designed**
  layout (a proposal reality deviates from). Shared across designer, capture, and analysis (ADR-0006).
- **Tracer bullet** — the build method: thinnest end-to-end thread on the real architecture
  first, then thicken each station (ADR-0010).
- **Defer-the-tax** — architect for a capability now, build it later (auth, single-tenant,
  model picker, full BrAPI, formal AI audit layer).

## Breeding-science vocabulary
- **BLUP** — Best Linear Unbiased Prediction; per-genotype value with genotype **random**.
  Used for **selection**.
- **BLUE** — Best Linear Unbiased Estimate; per-genotype value with genotype **fixed**.
  Used for unbiased **comparison/reporting**.
- **MET** — Multi-Environment Trial (genotypes across sites × years).
- **GxE** — genotype-by-environment interaction; **stability** = how consistent a genotype
  is across environments (Finlay–Wilkinson, AMMI, GGE).
- **Heritability (h²)** — proportion of phenotypic variation that is genetic; **Cullis h²**
  is the reliability-based form preferred for unbalanced/spatial trials.
- **Spatial model** — corrects for field gradients (row–column, AR1×AR1, or `SpATS` splines).
  Required for credible field-trial BLUPs (ADR-0006).
- **Selection index** — combines per-trait values into one ranking. Two kinds, both shipped:
  the **transparent weighted index** (a communication/alignment instrument) and the
  **genetically-aware index** (Smith–Hazel / desired-gains; the statistically optimal decision).
  Their **divergence** is itself an insight (ADR-0006).
- **Genomic prediction / GBLUP** — predicting breeding values (GEBVs) from markers. *Built*
  (branch `feat/genomic-prediction`): the genotype panel is stored as packed CallSets (ADR-0017);
  the kernel builds **G / A / H** relationship matrices and drives GBLUP / ssGBLUP via **rrBLUP** (CV
  default) and **native BLUPF90/preGSf90** (scale), cross-engine validated; the genomic UI + Model
  Studio selector ship (ADR-0018). Remaining: a `relationship_set` cache table + forward-year validation.
- **Relationship matrix (G / A / H)** — the genotype×genotype kinship the mixed model uses in place
  of identity. **G** (genomic): VanRaden marker relationship, scaled to mean-diagonal 1 so genotype
  variance is interpretable additive variance and G sits on A's scale. **A** (pedigree): numerator
  relationship from `parent1`/`parent2`. **H** (single-step): blends A + G natively via preGSf90, so
  ungenotyped lines re-enter via pedigree. The planner picks the default by data availability;
  **cross-validation** picks the measured winner on demand. The `relationship: A/G/H` contract field
  selects it; relationship matrices are cached out of the JSONB bundle (ADR-0017 packing style).
- **Data readiness** — deterministic diagnostics the kernel computes from the generic plot record to
  gate every model choice: per-environment **grid** (row/col density → spatial-capable?), per-environment
  **replication** (within-env entry replication → residual identifiable?), cross-environment
  **connectivity** (genotypes shared across environments → GxE/stability estimable?), and **scale**
  (n_obs/n_geno/n_env/n_traits, markers present). Crop-agnostic (ADR-0015); never reads column names (ADR-0016).
- **Model Plan** — the planner's declarative output *before* fitting: trial structure, spatial method
  per environment, genotype effect (random/fixed), GxE include/skip, staging (single vs weighted
  two-stage), engine, relationship. Each decision carries a **reason** and the **diagnostic value** that
  triggered it. One-stage is the default; weighted two-stage is the deliberate scale fallback; GxE fires
  only when **data readiness** says it is identifiable (ADR-0016).
- **Engine registry** — engines (lme4, SpATS, BLUPF90, rrBLUP) as adapters behind a uniform
  `plan → result` interface plus a **capability descriptor** (multiTrait, gxe, spatial methods,
  relationship support, genomic, scale tier). The planner selects an engine by matching the **Model
  Plan**'s required capabilities, tie-broken by ADR-0014 scale tiering; new engines plug in by
  capability, not by rewrite (ADR-0016).
- **Model Studio / breeder override** — the planner *recommends* every Model-Plan decision; the breeder
  may *override* any of them (relationship / spatial / staging / GxE / engine) and re-run. R still owns
  the science: each override is an *intent*, validated against **data readiness**, and the kernel
  **refuses** an infeasible one (e.g. force GxE without connectivity, force G without markers) with a
  reason — keeping its recommendation. Overrides are first-class, **visible, and reversible** (ADR-0018,
  evolving ADR-0002 from "kernel owns, human can't author" to "AI proposes / human overrides / kernel
  guards"). Each decision carries `source` (recommended/overridden), `recommended`, `feasible`,
  `refused_reason`; the bundle's `overridable[]` map drives which options the UI greys out before a re-run.
- **Genomic engine (rrBLUP vs BLUPF90)** — the GEBVs can be computed by **rrBLUP** (fast, the default and
  the CV workhorse) or by **native BLUPF90/preGSf90 GBLUP** (the scale engine for large cohorts). The two
  are **cross-engine validated** to give equivalent GEBVs (concordance). Precomputed together so the engine
  choice is an instant re-point, not a refit. **Single-step H** ranks *all* phenotyped lines — including
  un-genotyped ones, which borrow through the pedigree link to genotyped relatives.

## Program organization vocabulary (the two axes — see [DOMAIN-MODEL.md](docs/DOMAIN-MODEL.md))
- **Stage** — a candidate's position on the program's *ordered* advancement ladder (e.g.
  stage 1 → pre-commercial → commercial). Program-defined; material moves between stages via an
  **Advancement Decision**. R&D/breeders say "stage," commercial says "phase" — we use **Stage**
  (R&D software). *Not* growth/phenological stage.
- **Market / Segment** — a program-defined *commercial target*, grouped by whatever segments share
  (mechanization, climate, season, soil); no single defining axis; set by business strategy and
  **time-variant** (effective-dated). Faceted, not a rigid hierarchy.
- **Target Product Profile (TPP)** — a Segment's commercial-target definition (full gate set + trait
  priorities; the north star); drives **market-specific selection** (same data + different Segment ⇒
  different ranking).
- **Selection Criteria** — the operational `{gates, index}` applied at a **(Segment × Stage)**;
  selection = cull on **gates** (independent culling on must-have traits) then rank survivors by the
  **index**. Both vary by Stage: gates tighten toward commercial status (early stages stay loose to
  preserve diversity / combining potential); the index grows as more traits are measured (measurement
  economics). Converges to the Segment's TPP as Stage advances.
- **Advancement Decision** — the recorded staging move: candidate, from→to Stage, **disposition**
  (advance/hold/drop/recycle-as-parent/…), **per Segment**, rationale, source analysis. The capstone
  of the analysis→select→advance arc; the basis of genetic-gain tracking and institutional memory.
- **List** — a built set of germplasm (crossing block, nursery, trial entries, selection candidates),
  saved or dynamic, assembled by querying Stage + Segment + provenance + performance; **diversity-aware**
  (coancestry/effective-population-size) — how σ_A is actively managed.
- **Discovery isolation** — discovery/unadapted-material trials carry no commercial Segment, so they're
  excluded from segment-pipeline prediction training sets (training-set relevance; avoids variance distortion).

## Ecosystem & standards (ADR-0009)
- **BrAPI** — the industry-standard breeding data API/model; our data model aligns to it; a
  future import path from Breedbase / Field Book / Phenome.
- **Breedbase** — open-source incumbent (Perl/Chado). A *reference to learn from and interoperate
  with*, **not** a codebase to fork.
- **G2F (Genomes to Fields)** — public maize program dataset; our development **north star**
  (real breeding-program complexity). Tomato is the **beachhead** for marketing (ADR-0008).
