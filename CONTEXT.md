# Verdant — Context & Glossary

Single-context domain doc for the whole product. Read this and the relevant
[ADRs](docs/adr/) before exploring or changing code. Decisions live in ADRs; this
file is the shared **vocabulary** and a one-screen orientation. Use these terms
exactly in code, tests, issues, and prose — don't drift to synonyms.

## What Verdant is
A free, open-source breeding **management + analysis** project for small/mid programs
without a statistician on staff. The promise: *upload your trial, get the right answer
(correct mixed-model BLUPs, heritability, a ranked selection index), and ask your data
questions in plain English.*
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
  (n_obs/n_geno/n_env/n_traits, markers present). When germplasm are crosses (`parent1`/`parent2`), two
  further diagnostics gate combining ability: **cross-connectivity** (the bipartite parent cross-graph —
  are parents linked through shared mating partners, and at what **degree** = crosses per inbred → is GCA
  estimable, on one common scale, and how precise per parent) and **cross-replication** (specific
  combinations observed more than once → is SCA separable from residual). Crop-agnostic (ADR-0015); never
  reads column names (ADR-0016). **Readiness gates model choice** — distinct from **Data Quality**, which
  gates *trust*.
- **Trait** (the Library entry) — the program's **canonical measurable**, promoted to a first-class object:
  canonical name, aliases (for column-name matching on import), **datatype** (BrAPI `Numerical / Ordinal /
  Nominal / Code / Date / Text`), **canonical unit**, **valid range** (BrAPI `validValues` min/max/
  categories), and a default **QC method** (type-keyed; overridable). Built once, reused every trial: the AI
  proposes an entry at first sighting of a new column, the breeder confirms once, deterministic alias-match
  thereafter. Aligns to BrAPI **ObservationVariable** = Trait × Method × Scale (ADR-0009); the unit lives on
  the **Scale** (so **per-variable, never per-observation** — mixed units = two variables, same Trait).
  _Avoid_: "trait dictionary", "trait config".
- **Trait Library** — the program-scoped set of **Trait** definitions; the persistent home for the
  curated-trait-list-with-per-trait-QC a breeder would otherwise re-specify every trial. The bridge between
  messy uploaded columns and the generic, column-blind kernel.
- **Ingest QC** — the **preventive, pre-commit** validation at the data's front door, where unit
  harmonization and per-value plausibility are resolved so nothing dirty reaches storage. Two doors: **mobile
  capture** (variable picked from the Trait Library at entry → unit fixed at source; live range-check) and the
  **import workflow** (messy file → **staging** → AI maps column→variable, resolves source unit,
  **deterministically converts to the Trait's canonical unit**, flags impossible values / unit mismatch /
  typos → breeder confirms → commit). The raw upload + mapping + conversions are logged in the **import
  record** (the audit trail; ADR-0003 reversible) — `observation` stores canonical, BrAPI-orthodox.
- **Data quality** — the **analysis-time, pre-fit, value-level** audit of an assembled dataset (distinct from
  **Ingest QC**, which is pre-commit at the front door, and from **data readiness**, which is structural and
  never reads trait values). Assumes **unit-harmonized** input (Ingest QC's job), so it does only the
  statistical/relative work that needs the whole assembled dataset + model context: **outliers** (robust, vs
  genotype×env neighbours — MAD / studentized residual), **missingness** pattern, trait **distribution**
  (skew / zero-inflation → transformation hint), and **factor-level sanity**. Surfaced in plain language
  before any model runs; the AI narrates, the breeder confirms, nothing is auto-removed (AI proposes / R owns
  / human confirms). Crop-agnostic — operates on the generic plot record, never on column names.
  _Avoid_: "data validation" (ambiguous — could mean readiness, ingest QC, or quality).
- **Model QC** — the **post-fit** validation of the fitted model (distinct from **data quality**, which is
  pre-fit): residual diagnostics (normality, heteroscedasticity, spatial-residual autocorrelation — did the
  spatial model actually remove the trend?), influential observations, variance-component sanity (Vg / h² at
  a boundary, REML convergence warnings), reliability / SE distribution. Readiness says a model is
  *feasible*; Model QC says it actually *worked*. Carried in the result bundle's per-trait `diagnostics`.
- **Two-pass QC** — outlier detection runs twice, by design: a **pre-fit** crude-robust pass (Data Quality —
  gross/structural errors that would wreck a fit: impossible values, dup coords, >5 MAD raw) and a **post-fit**
  residual pass (Model QC — studentized/deletion residuals + influence, the statistically proper outliers only
  visible relative to the model). The selection seam consumes flags from both.
- **`data_overrides`** — the **analysis-scoped exclusion overlay**: a filter list on one analysis run
  (targets: environment / observation-unit / germplasm / variable), never a deletion of `observation` rows.
  The sibling of `model_overrides` (Model Studio) — the sole channel by which a *data* choice changes the
  *model* (drop a site → connectivity changes → planner re-plans; decision-C). Each re-run is a new immutable
  `analysis_run` (with/without is a comparison, not a destruction; ADR-0003 reversible). Each entry records
  `source: manual | batch | auto_policy`.
- **Disposition policy** — the breeder-set rule that turns advisory QC suggestions into an actual
  `data_overrides` set: **mode** (review-each / batch-accept / auto-apply), a **per-trait cap** (max N or X%
  excluded per trait — a statistical guardrail against heritability inflation, not just UX), and a **residual
  threshold**. Lives in the web tier; the kernel stays **advisory-only** (emits findings + `suggested_exclusion`,
  never removes). Self-contained so it can later be persisted as a **Breeder profile** default.
- **Breeder profile** *(deferred — defer-the-tax)* — a future program/breeder-scoped preference container
  (disposition policy, QC thresholds, Trait Library QC defaults, Selection Criteria, …; extends beyond traits).
  Not built in MVP; the objects it will hold are kept self-contained so persisting them later is no refactor.
  Its tenancy shape (per-user curated view vs shared UI + subset) is an open Phase-4 (multi-user) question.
- **Model Plan** — the planner's declarative output *before* fitting: trial structure, spatial method
  per environment, genotype effect (random/fixed), **genotype structure** (opaque hybrid BLUP vs a
  GCA/SCA decomposition, plus its topology-selected parameterization), GxE include/skip, staging (single
  vs weighted two-stage), engine, relationship. Each decision carries a **reason** and the **diagnostic value** that
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

## Combining-ability vocabulary (ADR-0019, ADR-0020)
*Built* (2026-06-12): kernel `combining-ability.R` (lme4 long-form GCA/SCA, topology-selected, emits a
GCA genetic-covariance), the `combining_ability` bundle section, a `inbred_line` table + synthetic seed.
Combining ability is a **facet of the one trial analysis**, not a separate page: it is attached to the
hybrid bundle (`buildCombinedAnalysis` / `runMetAnalysis`), and the web app is **one journey-ordered
page** whose **Selection** workspace has a **level** switch (Hybrids / Parents·GCA) × a **lens** switch
(Stated / Genetically-optimal / Compare) over the shared index components — the genetic desired-gains
lens runs on GCA too. Within-pool GCA + hybrid ranking, per-se↔GCA divergence, SCA, native-trait gating,
recorded advancement. Validated on G2F MET line×tester. See `.scratch/ux-architecture/plan.md`.
The rich `combining_ability` + `recycling` **facet shapes** are typed ONCE in `@verdant/contracts`
(`facets.ts`) and imported by both the pipeline (which builds them) and the web tier (which renders
them) — the bundle types them loosely, so `combiningAbilityOf` / `recyclingOf` are the single read seams.
- **Combining ability** — the decomposition of a *cross's* performance into the contributions of its
  *parents*. Turns a hybrid-performance trial into **parent selection**: which inbreds are good
  *combiners*, not merely which hybrids won (the opaque hybrid BLUP can't say). Fired by the planner as a
  **genotype_structure** decision when germplasm are crosses (`parent1`/`parent2`) and **cross-connectivity**
  says GCA is identifiable; one unified **random-effects mixed model**, never a fixed-effects Griffing method
  (ADR-0019). Overridable (ADR-0018).
- **GCA — general combining ability** — a parent's *average* contribution across its crosses (additive gene
  action). The headline new deliverable: the **parent-selection target**, fitted random → **BLUP**
  (the displayed value, shrinkage baked in — the reason breeders trust it). A parent's **cross-degree**
  (times tested / combinations made) is surfaced as a separate visual signal (dot size/colour), not as the
  value. An inbred's per-se BLUP and its GCA can disagree — that **divergence** is
  itself the insight (mirroring transparent-vs-Smith–Hazel).
- **SCA — specific combining ability** — the *cross-specific* deviation from the additive (GCA + GCA)
  expectation (non-additive gene action). Rarely separable at real sparse-design degree (≤1 rep, ~2–6
  crosses/inbred); the planner gates it on **cross-replication** and otherwise folds it into the residual,
  or predicts it only via a dominance relationship matrix.
- **Mating-design topology** — the shape of the parent cross-graph, **measured not declared**: **diallel**
  (parent pools overlap, an inbred is both parents → *pool* both roles into one symmetric GCA, the
  "overlay"); **line × tester** (pools near-disjoint, one pool a few *chosen* testers → **tester fixed**,
  line-GCA random); **sparse factorial** (both pools large, sparse new×new → *both* pool-GCAs random). The
  per-pool fixed-vs-random call follows pool *size* (few chosen levels → fixed; many → random). Selects the
  GCA parameterization; auto-detected from the graph, overridable (ADR-0018).
- **Hybrid prediction** — predicting a cross's value. Two tiers: the additive **mid-parent / GCA-only**
  predictor `μ + GCA_a + GCA_b` (robust, predicts *unmade* crosses; the practical workhorse) and the
  **GCA+SCA** predictor that adds the specific deviation (only where SCA is estimable). Distinct from
  **observed hybrid performance** — the cross's own BLUP — which we still report alongside.
- **Baker's ratio** — `2σ²_GCA / (2σ²_GCA + σ²_SCA)`: the share of cross performance that is additive
  (predictable from GCA alone); a one-number read on how much SCA matters.
- **Parent relationship matrix** — the A/G/H structure applied to the **GCA effect** rather than the hybrid
  effect. At low cross-degree it is load-bearing, not optional: it borrows strength across the parents'
  kinship so a thinly-crossed inbred still gets a usable GCA. Same machinery as genomic prediction, pointed
  at the parents.

## Cross-planning vocabulary (ADR-0024)
The **forward** half of the cycle — combining ability stops being *displayed* and becomes a *generated
decision*: which matings to make. Two modes, not one tool:
- **Product cross** — pool-A inbred × pool-B inbred → the **F1 you sell** (terminal: no within-cross
  selection, not a parent). *Built* (2026-06-18): the **Cross** step ranks every across-pool A×B by a
  market-weighted index of **combined GCA** (`GCA_a + GCA_b`, the Hybrid-prediction workhorse above),
  gates each cross on **allele transmission** (a dominant R-gene fixes in the F1 if *either* parent
  carries it), and composes a **portfolio** under a per-parent use cap. **GCA-only by design** (these
  crosses are unmade → SCA unknowable); **no OCS/coancestry penalty** — the heterotic-pool split *is* the
  diversity, and a terminal F1 has no inbreeding to manage. A client-side derivation over
  `combining_ability` (`lib/cross-plan.ts`).
- **Recycling cross** — within-pool line × line → the **next inbred generation**. *Built* (2026-06-19,
  ADR-0024 amendment): the Cross step's **Recycle** mode shows two methods side by side so the breeder
  learns the contrast — **usefulness** (`μ + i·σ`, greedy, chases gain, over-uses related elites) vs
  **OCS** (optimal-contribution selection: maximise gain s.t. a cap on group coancestry — genomic, no
  pedigree — spreading parents to hold diversity). The teaching payoff is the gain-vs-coancestry
  **frontier** + where the two plans diverge. `cross-recycling.R` / `maize-recycling.ts`. Needs a pool
  with **family structure** (so gain and diversity are in tension) — the corpus builds each pool from 16
  founders → 60 descendants for exactly this.
- **Usefulness criterion** — a cross's value for a SELECTION program: `μ + i·σ`, the expected mean of its
  selected progeny (Schnell). For inbred parents `σ²ᵢⱼ = ¼ Σₖ aₖ²(Mᵢₖ−Mⱼₖ)²` — marker-effect-weighted
  parental divergence. The product F1 is terminal (no progeny selection) so usefulness is a *recycling*
  concept, not a product-cross one.

## Program organization vocabulary (the two axes — see [DOMAIN-MODEL.md](docs/DOMAIN-MODEL.md))
- **Stage** — a candidate's position on the program's *ordered* advancement ladder (e.g.
  stage 1 → pre-commercial → commercial). Program-defined; material moves between stages via an
  **Advancement Decision**. R&D/breeders say "stage," commercial says "phase" — we use **Stage**
  (R&D software). *Not* growth/phenological stage.
- **Market / Segment** — a program-defined *commercial target*, grouped by whatever segments share
  (mechanization, climate, season, soil); no single defining axis; set by business strategy and
  **time-variant** (effective-dated). Faceted, not a rigid hierarchy. Breeders call this the
  **target market** — *what material is bred for*; it is **never an attribute of the germplasm**
  but a lens applied to it (see **Segment membership** below). A Segment is two facets:
  a **TPP** (objective) + a **TPE** (analysis frame) — ADR-0023.
- **Target Product Profile (TPP)** — a Segment's commercial-target definition (full gate set + trait
  priorities; the north star); drives **market-specific selection** (same data + different Segment ⇒
  different ranking). The *objective* facet of a Segment (its Selection Criteria); always present.
- **Target Population of Environments (TPE)** — a Segment's **analysis frame**: the environment
  envelope its varieties are deployed into, which the trial network *samples* — *what data pools
  meaningfully*. The other facet of a Segment: **Segment = TPP + TPE** (ADR-0023). **Trait-defined**
  Segments differ in TPP and **share** a TPE; **environment-defined** Segments differ in TPE; most
  differ in both. Fits key on the **distinct TPE** — compute the mixed model once, reuse it across
  index lenses; a Segment with its own TPE gets its own fit, so **GCA×E / G×E falls out of the
  partitioning** natively. The same boundary as **Discovery isolation** (training-set relevance).
- **Segment membership** — a Segment is **never germplasm state**; membership is derived three ways
  (ADR-0023): an **evaluation lens** (any candidate scored against any Segment's TPP — a query, fully
  many-to-many), the **Advancement Decision** log (the recorded per-(candidate, Segment, Stage)
  membership; the broad→specific **narrowing is emergent** from accumulated per-Segment drop/advance
  decisions, not a stored "current segment" field), and the **Study→TPE tag** (which trials pool for a
  Segment). An **inbred** serves many Segments durably (a reusable combiner — never narrows); a
  **hybrid** narrows toward one (the product). _Avoid_: a `germplasm.segment_id` column.
- **Selection Criteria** — the operational `{gates, index}` applied at a **(Segment × Stage)**;
  selection = cull on **gates** (independent culling on must-have traits) then rank survivors by the
  **index**. Both vary by Stage: gates tighten toward commercial status (early stages stay loose to
  preserve diversity / combining potential); the index grows as more traits are measured (measurement
  economics). Converges to the Segment's TPP as Stage advances. In **GCA mode** the criteria gain two
  further scope facets — the selection **unit** (inbred-parent vs hybrid) and the **pool** (heterotic
  group, derived from the cross-graph, ADR-0019) — so parent selection is a separately-authored,
  **within-pool** ranking (ranking pools jointly would advance only the stronger pool and collapse the
  heterotic structure). The index ranks on **GCA**; gates may read **inbred per-se / marker-derived trait
  values** (e.g. "carries the disease gene"), a different value source keyed to the same parent (ADR-0020).
- **Advancement Decision** — the recorded staging move: candidate, from→to Stage, **disposition**
  (advance/hold/drop/recycle-as-parent/…), **per Segment**, rationale, source analysis. The capstone
  of the analysis→select→advance arc; the basis of genetic-gain tracking and institutional memory.
- **Breeding cycle (recurrent selection)** — the program's repeating spine: *define target
  (Segment/TPP) → evaluate & select within target → advance (Advancement Decision) → design crosses
  for the target → next cycle*. Each turn raises the population mean toward the TPP (**genetic gain**).
  The frame that makes a trial analysis part of a *program*, not a one-shot.
- **Breeding funnel (selection pyramid)** — across Stages toward commercialization the number of
  unique germplasm **shrinks** while design intensity (reps × locations × **trait panel**) **grows**
  on the survivors (measurement economics). Survivors carry forward as a *selected subset* of the
  prior Stage — correlated, with **compressed genetic variance** (Bulmer). Couples with the
  **segment funnel** (broad early → specific late). Drives the simulation corpus
  ([docs/sim-corpus-spec.md](docs/sim-corpus-spec.md)) and makes the **Model Planner** correctly do
  different things at each Stage (single-plot / no-GxE early → MET / GxE / stability late).
- **List** — a built set of germplasm (crossing block, nursery, trial entries, selection candidates),
  saved or dynamic, assembled by querying Stage + Segment + provenance + performance; **diversity-aware**
  (coancestry/effective-population-size) — how σ_A is actively managed.
- **Discovery isolation** — discovery/unadapted-material trials carry no commercial Segment, so they're
  excluded from segment-pipeline prediction training sets (training-set relevance; avoids variance distortion).

## Ecosystem & standards (ADR-0009)
- **BrAPI** — the industry-standard breeding data API/model; our data model aligns to it; a
  future import path from Breedbase / Field Book / Phenome.
- **Breedbase** — established open-source breeding software (Perl/Chado). A *reference to learn from
  and interoperate with*, **not** a codebase to fork.
- **G2F (Genomes to Fields)** — public maize program dataset; our development **north star**
  (real breeding-program complexity). Maize is the **lead crop / worked example** (ADR-0008).
