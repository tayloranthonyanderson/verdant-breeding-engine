# Synthetic tomato pipeline — simulation corpus spec

**Purpose.** The development + demo + teaching corpus. IP-clean — public/self-funded only, never
employer germplasm (ADR-0008, BUSINESS-STRATEGY). `services/kernel/sim.R` already generates **one**
tomato MET with known truth (yield/brix/fruit_wt/maturity, the yield↔brix −0.45 genetic trade-off,
GxE, per-trait h², the true G-correlation). This spec extends it into a **staged, multi-segment
breeding pipeline** so Verdant demonstrates a *program*, not a single trial.

**Why it earns its complexity.** A staged pipeline makes the **Model Planner** visibly do different,
correct things at each Stage (single-plot / no-GxE early → MET / GxE / stability late). That is the
clearest on-camera demonstration of the "automate the expert" wedge (ADR-0009), and it falls out of
simulating the **breeding funnel** honestly. It also gives the AI insight layer (target-authoring +
TPP-scoped Q&A) a realistic program to narrate, and — when the ingestion front door is built later —
these same per-stage CSVs dogfood it.

## The data cut is purpose-dependent (drives generation)

There are **two** cuts, and the corpus must support both:

- **Decision cut (narrow).** Advance-or-drop at a stage → that stage's trials, design-homogeneous, one
  market lens. The Model Planner reacts to the stage's design.
- **Prediction cut (wide) — the headline.** A training set for GEBVs. Relevance axis is the **TPE, not
  the stage**: pool every record that samples the market's target environments, **across stages and across
  years**. Validity comes from **genetic connectivity** (shared germplasm/checks/testers + **markers/GRM**
  as the glue across unbalanced data). Noise is **modeled, not filtered** (heterogeneous error/weights per
  stage design; loc×year environment random; GxE/FA structure down-weights crossover environments).
  Inclusion rule: (1) in the TPE, (2) genetically connected, (3) concordant not crossover (genetic
  correlation to the TPE is the relevance dial). Including the early-stage records that drove selection
  **de-biases** variance components (Henderson). Material tested early for multiple markets is in **every**
  relevant market's cut (many-to-many lens, ADR-0023). The user picks a **purpose**; the system proposes
  the cut (pool, connectivity, each block's genetic correlation to the TPE) and lets them include/exclude
  with the consequence shown — the "automate the expert" wedge.

## What to generate

One tomato program across the funnel, **≥2 years / cycles** with carried-over checks and survivors for
connectivity, and a **marker scaffold on the inbreds** so the GRM can glue the wide prediction cut.

| Stage | ~Entries | Locs × Reps | Traits measured (cumulative) | Planner should choose |
|---|---|---|---|---|
| S1 — Observation (single-plot) | 600 | 1 × 1 | yield est, maturity, gross fruit type | spatial-only, genotype fixed/BLUP, **no GxE**, single-stage |
| S2 — PYT | 80 | 3 × 2 | + Brix, firmness, basic disease | spatial + replication; GxE marginal |
| S3 — AYT | 20 | 6 × 3 | + full quality + disease panel | **two-stage MET**, GxE, stability |
| S4 — Pre-commercial / wide | 5 | 12 on-farm strips × — | + shelf-life, processing yield | wide-adaptation MET; stability emphasis |
| Commercial | 1–2 | — | — | reporting (BLUE) |

*(Counts/design are the breeder-confirmed tomato defaults; tune in one place.)*

### Funnel dynamics (must-haves — the realism that makes it credible)

1. **Survivors carry forward, correlated.** Stage *n+1* entries are the **selected top** of Stage *n*
   on that stage's index — not independent redraws. Consequence: advanced stages show **compressed
   genetic variance** (Bulmer) and shifted trait correlations. Expose the truth so teaching can show
   it.
2. **Design ramp.** Reps and locations grow with Stage; the **trait panel grows** (cheap traits early,
   expensive quality/disease only on survivors — measurement economics).
3. **GxE only estimable late.** Early stages are 1 location → the planner *correctly* returns
   no-GxE/single-stage; late stages are many locations → two-stage MET + GxE/stability. This contrast
   is the demo.

### Segments (TPP + TPE — ADR-0023)

Three Segments, chosen to exercise **both** definition modes:

- **CA-Processing · Brix** — trait-defined. TPE = arid CA processing locations. TPP index weights Brix.
- **CA-Processing · Firmness/viscosity** — trait-defined. **Shares the CA-processing TPE** with the
  above (⇒ one fit, two index lenses). TPP index weights firmness/viscosity.
- **Fresh-market · East** — environment-defined. **Own TPE** (humid East) → its own fit; carries
  GCA×E vs. the processing TPE. TPP weights size/appearance/flavor/shelf-life.

Material is **sorted into Segments across stages**: broad early (scored vs. all three), specific late
(Advancement Decisions narrow it). Membership is never stored on the germplasm — it is the
evaluation lens + the decision log + the Study→TPE tag (ADR-0023).

### Known-truth attributes to expose (validation + teaching)

True genotype means per trait; true G-correlation (incl. the yield↔Brix trade-off already in
`sim.R`); true entry-mean h² **per stage-design**; true **GCA per inbred** (and **GCA×TPE** where
env-defined); and the **true selection applied at each stage**, so a demo can show the model
recovering both the values and the selection.

## Output shape

Emit as the **generic plot record** the pipeline already consumes (per-stage long CSVs, or a direct
seed), tagged with **Study→TPE**, flowing through the existing build path (mirroring `met-build.ts` /
the G2F path) — but onto **tomato**. This moves the whole product off hardcoded G2F maize and onto the
beachhead/teaching crop.

## In scope now (pulled in for the prediction cut — decided 2026-06-14)

- **Markers on the synthetic inbreds** — the GRM glue that makes the wide cut valid. Extends the existing
  loci scaffold (ADR-0017/0020), kept minimal (enough for a credible GRM, not a full genome).
- **≥2 years/cycles with carried-over checks + survivors** — connectivity over time so cross-year pooling
  is demonstrable; also begins the cycle-over-cycle genetic-gain track (toward ADR-0011 / M9).

## Out of scope (defer)

- **Full forward-simulation / many-cycle ΔG loop** — two cycles establish connectivity + a gain delta;
  the long recurrent-selection projection stays at the M9 frontier (ADR-0011).
- **The ingestion front door** — these CSVs are seeded directly for now; they become the dogfood
  corpus for the upload workflow when that thread is built (deferred — see this session's direction).
