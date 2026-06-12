# Verdant — Build Plan to a Sellable MVP

How to read this: [ROADMAP.md](../ROADMAP.md) is the *product* phase list. This is the
*engineering execution plan*. The **decisions** behind it live as [ADRs](adr/) and the
shared **vocabulary** in [CONTEXT.md](../CONTEXT.md) — read those first; this plan assumes them.

> This plan was rewritten on 2026-06-11 after a full design-grilling session. It supersedes
> the earlier platform-first draft. The headline reversal: **science-first, not plumbing-first**
> (ADR-0010), built as a **tracer bullet** on the **G2F maize** dataset (ADR-0008).

---

## 1. The vision, made testable

| Pillar | Concretely | We'll know it's real when |
|---|---|---|
| **Trustworthy** | Every number correct *and provably* so; the AI never fabricates. | Validation suite green vs. known truth; AI answers cite tool outputs (ADR-0002). |
| **AI-native** | You can *talk to* and *direct* your program; the AI advises, explains, narrates, and acts. | A breeder reaches a selection decision through a GUI with a pervasive, action-capable AI (ADR-0003). |
| **Beautiful & fun** | Premium 2026 SaaS, instant-feeling, alive. | Consistent design system; sub-second perceived response; people *want* to demo it. |
| **Rock-solid** | Real data never lost; degrades gracefully; secure by default. | Stateless R kernel + durable queue; no sync request hangs the UI (ADR-0001). |
| **Makes you a better breeder** | Surfaces insight a non-statistician misses; teaches as it works. | Auto-narrative flags the yield–brix trade-off, GxE, unstable lines, design flaws — unprompted and correct. |

**Governing rule (ADR-0010): buy infrastructure, build science.** Don't hand-roll auth,
billing, or queues. Pour effort into the engine, the validation suite, and AI grounding —
the only parts no competitor can replicate.

---

## 2. The breeding lifecycle we build toward

```
   ┌────────────────────────────────────────────────────────────────┐
   ▼                                                                  │
 GOALS ─▶ CROSSES ─▶ GERMPLASM ─▶ TRIAL DESIGN ─▶ AS-PLANTED LAYOUT   │
                                                          │           │
   ┌──────────────────────────────────────────────────────┘           │
   ▼                                                                    │
 DATA CAPTURE ─▶ QC/CLEAN ─▶ ANALYZE ─▶ SELECT ─▶ ADVANCE/RECYCLE ─────┘
```

We start at **Analyze** (the moat) and expand outward. Note **as-planted layout** is its own
step — capturing the messy real-world field is the practical bottleneck, not the spatial math
(ADR-0006).

---

## 3. The build model (ADR-0010)

- **Science-first.** Prove the analysis is irresistible on **real public + simulated data**,
  with the founder as the only user, *before* paying the SaaS-plumbing tax. SaaS-ize a *validated*
  moat; don't harden infra around an unproven one.
- **Tracer bullet.** Thinnest end-to-end thread on the *real* architecture first, then thicken
  each station. Shallow the features, never fake the seam.
- **Defer-the-tax.** Auth, cloud, single-tenant tooling, the user-facing model picker, full BrAPI,
  and the formal AI audit/undo layer are all *architected-for now, built later*.

---

## 4. The staged path

Effort is relative (S/M/L/XL) at ~8–12 hrs/wk, not a date.

### Milestone 0 — Tracer bullet (walking skeleton) · **L**
*Prove the whole spine end-to-end on real data.*
- **Stack up (ADR-0001):** TS web tier + **Postgres-backed job queue** + **R compute-kernel worker**
  + Postgres, all containerized/12-factor (ADR-0005). Disposable spike code does **not** carry over.
- **The thread:** ingest **one G2F maize location-year** → *manual* column mapping →
  *coordinate-column* layout → **single-trial spatial fit** in R *through the real queue* → result
  bundle persisted → GUI renders BLUPs + heritability + the *weighted* index → AI answers **one
  grounded** question.
- **Done when:** that thread runs on the real seam, deployed locally, and the BLUPs look right on a
  real trial. The scary integration (TS→queue→R→bundle→render→grounded-AI) is dead-risked.

### Milestone 1 — The credible analysis MVP (local, single-user) · **XL** · ⟶ **science-validated moat**
*Thicken every station until a PhD breeder trusts it over their current workflow. Still no auth, no cloud.*
- **Analysis depth (ADR-0006):** spatial models (row–col / AR1×AR1 / `SpATS`); MET + **GxE**;
  **Cullis heritability**; genetic-correlation matrix; **diagnostics** (residuals, reliability/PEV,
  convergence, "why this model"). Engine selects the model deterministically (ADR-0002).
  - ✅ **Two-stage MET** built: SpATS within-environment spatial de-trending (Stage 1) →
    multi-trait AI-REML / BLUPF90 (Stage 2) for genetic covariance + correlations; validated
    vs lme4 to 3 sig figs.
  - ✅ **Deterministic Model Planner (ADR-0016):** shared data-readiness diagnostics
    (grid / replication / connectivity / scale) gate spatial / genotype-effect / GxE /
    single-vs-two-stage / engine, each decision carrying its reason + triggering diagnostic;
    a "Model & data readiness" UI panel narrates the choice and what would unlock more. The
    **engine registry** matches engines to the plan's required capabilities (ADR-0016).
    *Established empirically:* GxE is identifiable only in a one-stage plot-level fit
    (two-stage-on-means is non-identifiable) and is compute-bound at full G2F scale — so G2F
    routes to two-stage genotype-main and "GxE needs a one-stage fit on a higher-memory host"
    surfaces as an unlock.
  - ✅ **Crop-agnostic MET seams (ADR-0015):** generic plot record; dataset column names
    (G2F's `Range`/`Pass`/`Hybrid`…) live only in ingestion, never in the kernel/adapter.
- **As-planted layout (ADR-0006):** the **visual field-map editor** (gaps, obstacles, non-contiguous
  ranges); coordinate-import as the fast path; layout as a first-class object.
- **Ingestion (ADR-0007):** **AI-assisted column mapping + design detection + validation report**, with
  mandatory human confirmation. Data model **aligned to BrAPI** naming.
- **Selection (ADR-0006):** the **transparent weighted index** (sum-to-100% alignment tool, live sliders)
  *and* a **genetically-aware index** (Smith–Hazel / desired-gains); surface their **divergence** as insight.
- **AI copilot core (ADR-0003):** GUI-first, pervasive; grounded Q&A; **auto-narrative** insight; lightweight
  **action-capable** AI over view-state (re-weight, what-if, filter) — visible + reversible; eval harness for
  groundedness. Provider-abstracted (ADR-0004), founder's model config only for now.
- **Validation suite (ADR-0008):** correctness vs. the tomato-flavored simulator's known truth; robustness vs.
  a battery of public/G2F trials.
- **Done when:** a real G2F MET produces spatially-adjusted BLUPs, Cullis h², a GxE/stability view, both
  indices with a narrated divergence, and an AI that reaches a defensible selection decision — every number
  cited. *This is the moat, validated.*

### Milestone 2 — SaaS-ize the validated moat · **L** · ⟶ **MVP / first paying user**
*Cross from "founder's local tool" to "a breeder signs up and uses it on their data, securely." Triggered by user #2.*
- **Buy** auth + tenancy (Clerk/Auth.js); enforce program scoping; remove open CORS; authenticate the API (ADR-0005).
- Persistence-in-UI (save/list/reopen trials, analysis history) — the schema already supports it.
- Deploy to **GCP** (Cloud Run + Cloud SQL).
- One-click **breeder-readable report** export from the grounded results.
- **Done when:** signup → upload → validate → analyze → save → reopen works for a non-founder, nothing lost,
  no unauthenticated endpoint.

### Milestone 3 — AI copilot, full · **L**
*From "narrates & answers" to "drives & teaches."* Model/design advisor ("is this trial analyzable? why this
model?"); conversational what-if driving the index; teaching mode; expanded eval gating; **user-facing model
picker + BYOK** (ADR-0004) now that we're multi-tenant; begin the formal **command/undo/audit** layer (ADR-0003).

### Milestone 4 — Trial designer · **M**
Generate sound randomized designs (RCBD, augmented, α-lattice, row–col, p-rep) + plot-plan export; AI-assisted
design; feeds the as-planted layout object. (ROADMAP Phase 3.)

### Milestone 5 — Germplasm, pedigree & genetic gain · **XL**
Germplasm catalog, pedigree → A-matrix, cross-cycle lineage, realized-gain dashboards, cross/parent planner
(usefulness / optimal contribution). Program memory. (ROADMAP Phase 4/7.)

### Milestone 6 — Genomics at scale · **XL** · *(built)*
GBLUP (G-matrix), CV accuracy, single-step (H-matrix), marker ingestion/QC; heavy jobs to **BLUPF90**
behind the contract (verify licensing). (ROADMAP Phase 7.)
- ✅ **Marker ingestion + storage (ADR-0017):** BrAPI VariantSet / Variant / Sample / CallSet
  with packed dosage `bytea`; G2F panel ingested — 437,214 SNPs × 4,928 genotypes (~501 MB
  compressed; per-marker MAF + call-rate at ingest); 1,153/1,198 MET genotypes genotyped.
- ✅ **Relationship matrices + GEBVs:** `genomic-core.R` builds VanRaden **G** (scaled to mean-diag 1),
  pedigree **A**, and single-step **H** (Legarra blend) so **all phenotyped lines rank — incl. the 45
  un-genotyped, via the pedigree link**. `grm.ts` decodes CallSets → dosage matrix + fixed-width SNP export.
- ✅ **Two engines, cross-validated:** **rrBLUP** (fast CV / default) + **native BLUPF90/preGSf90 GBLUP**
  (scale); GEBV concordance r≈0.97 (`docs/validation/cross-engine-concordance.md`). 5-fold×2-rep CV shows
  **G > A > identity** on every trait + LR bias/dispersion (`docs/validation/genomic-prediction.md`).
- ✅ **Genomic UI + Model Studio (ADR-0018):** GRM heatmap, PCA / population structure, deployment
  diagnostics, field-BLUP-vs-genomic-GEBV divergence, and the relationship + engine selector — the planner
  recommends the CV winner, the breeder overrides any decision and re-runs, the kernel validates + refuses
  infeasible ones. Relationship/engine toggles re-point from precomputed GEBVs in seconds.
- **Next:** a `relationship_set` cache table (big GRMs out of the JSONB bundle); `sample.germplasm_id`
  mapping; native BLUPF90 ssGBLUP (H) at scale; forward-year predictive validation (train N → predict N+1).

### Milestone 7 — Mobile capture & image phenotyping · **XL**
**Integrate Field Book via BrAPI** (don't rebuild, ADR-0009); offline capture against the plot plan; a Python
image service for 1–2 high-value traits. (ROADMAP Phase 5/6.)

### Milestone 8 — Commercialize & scale · **L (ongoing)**
Stripe per-seat tiers (analysis → +genomics → +team); teams/sharing/roles; onboarding; **BrAPI import** from
Breedbase/Phenome as a switching-cost lever; **single-tenant/VPC** deployment tier for governance-sensitive
enterprises (ADR-0004/0005); content/teaching engine; observability/SLOs.

### Milestone 9 — Decision-support: optimization & simulation · post-MVP differentiator (ADR-0011)
A **Python solver service** (3rd compute worker behind the queue) for **ΔG-per-dollar**
decision-support. **Beachhead-relevant first:** resource/strategy **allocation** (budget across
stages/traits, entries×locations×reps) on the Stage/SelectionCriteria/cost model. **At-scale later:**
operational **logistics** (harvester routing, sample-to-lab scheduling under capacity, crossing/
pollination ops). Both **optimization** (fast) and **simulation** (flexible, slower). Surfaced
AI-forward, transparent, and easy — never raw OR tooling. Deep, specialized; earned later.

---

## 5. Cross-cutting tracks (every milestone)
- **Science validation** — grow the testthat suite; benchmark vs. published/known results. The moat made provable.
- **AI groundedness & evals** — every new analysis ships a safe tool + eval; the model never computes a statistic.
- **Design system & UX polish** — one component library; instant-feel; **Next.js 16 / React 19** conventions
  (read `node_modules/next/dist/docs/` per `frontend/AGENTS.md` — this version differs from older Next.js).
- **Performance** — async jobs, bundle-size discipline, caching (relationship matrices, fits), client-side recompute
  for live controls.
- **Security & tenancy** — auth on every endpoint; `program_id` isolation tested; secrets; data-ownership/export.
- **Testing / CI / CD / observability** — R + TS suites in CI; error contracts; structured logs; deploy pipeline.

---

## 6. Analysis-methods catalog (reference)

| Method | Library / approach | Milestone |
|---|---|---|
| Single-trial BLUP/BLUE | `lme4` | 0 |
| Spatial (row–col, AR1×AR1, splines) | `SpATS`, `statgenSTA` | 0→1 |
| MET + GxE; genetic correlations | **BLUPF90** (AIREMLF90, multi-trait REML) / `statgenGxE` | 1 |
| Heritability — standard & **Cullis** | variance components / PEV | 1 |
| Stability — Finlay–Wilkinson, AMMI, GGE | `statgenGxE` / `metan` | 1 |
| Selection index — weighted + **Smith–Hazel** / desired-gains | engine | 0→1 |
| Diagnostics — residuals, reliability/PEV, convergence | engine | 1 |
| Trial design — RCBD, augmented, α-lattice, row–col, p-rep | `agricolae` / `FielDHub` | 4 |
| Pedigree A-matrix; realized gain | `AGHmatrix` / `nadiv` | 5 |
| Cross planning — usefulness, optimal contribution | `optiSel` / custom | 5 |
| Genomic prediction — GBLUP, Bayesian; CV accuracy | `rrBLUP`, `BGLR` | 6 |
| Single-step (H-matrix); scale solvers | `AGHmatrix` + **BLUPF90** (ssGBLUP) / GCTA | 6 |
| Image phenotyping | Python service | 7 |

---

## 7. Decisions resolved (this session) & open details

All captured as ADRs: [spine](adr/0001-architecture-spine.md) ·
[deterministic science](adr/0002-deterministic-science-ai-explains.md) ·
[AI agency](adr/0003-visible-reversible-ai-agency.md) ·
[provider/governance](adr/0004-llm-provider-abstraction-and-governance.md) ·
[deployment](adr/0005-deployment-posture.md) ·
[analysis scope](adr/0006-mvp-analysis-scope.md) ·
[ingestion/BrAPI](adr/0007-ai-assisted-ingestion-brapi.md) ·
[data strategy](adr/0008-data-and-validation-strategy.md) ·
[wedge/incumbents](adr/0009-product-wedge-and-incumbents.md) ·
[build method](adr/0010-build-methodology.md).

**Open details to settle at design time (not blockers):**
- Index-screen default: desired-gains vs. economic weights as the primary elicitation (ADR-0006).
- Confirm G2F plot-spatial columns on first ingestion; pick a clean location-year (ADR-0008).
- Queue: stay Postgres-backed vs. graduate to pg-boss when volume warrants (ADR-0001).
- Bundled-vs-BYOK business decision before cloud launch (ADR-0004).

---

## 8. Immediate next steps — Milestone 0, v0.1

1. **Stand up the skeleton:** TS web tier + Postgres + job table/worker + R kernel container; one health-checked
   end-to-end "echo" job through the queue.
2. **Pull G2F:** fetch one location-year, confirm spatial columns, load to Postgres (BrAPI-aligned shape).
3. **First real job:** R single-trial spatial fit → result bundle → persist.
4. **First render + first grounded answer:** GUI shows BLUPs/h²/weighted index; AI answers one question, cited.

We implement these together, one at a time — I'll propose the concrete change set for each before writing it.
