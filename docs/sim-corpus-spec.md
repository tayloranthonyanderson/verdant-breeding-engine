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

## What to generate

One tomato program, one cycle across the funnel (multi-cycle is a later extension — see Out of scope).

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

## Out of scope (defer)

- **Genomic markers** for the synthetic inbreds beyond the existing loci scaffold (ADR-0017/0020) —
  add when genomic-on-tomato is demoed.
- **Multi-cycle recurrent loop** — start with one cycle across the stages; add cycle-over-cycle
  genetic-gain tracking later (the forward-simulation capability, ADR-0011 / M9).
- **The ingestion front door** — these CSVs are seeded directly for now; they become the dogfood
  corpus for the upload workflow when that thread is built (deferred — see this session's direction).
