# Verdant — Product Requirements Document (PRD)

**What this is.** The consolidated statement of *what Verdant must do and why*. It sits between the
vision and the build:

| Doc | Answers |
|---|---|
| [PRODUCT.md](../PRODUCT.md) | the pitch / positioning (why this exists) |
| **PRD.md** (this) | **the requirements** (what it must do, for whom, to what bar) |
| [DOMAIN-MODEL.md](DOMAIN-MODEL.md) | the data model / lifecycle (the nouns) |
| [MVP-PLAN.md](MVP-PLAN.md) | the build sequence (how/when) |
| [ADRs](adr/) | the decisions (why it's built this way) |

Status: v1 (2026-06-11), derived from the design-grilling session. MVP requirements are firm;
post-MVP requirements are directional.

---

## 1. Vision & pillars

An AI-native breeding management + analysis platform that lets a breeder *upload a trial, get the
right answer, ask in plain English, and act* — without a statistician on staff. Every requirement
serves five pillars (each testable):

1. **Trustworthy** — every number correct and provably so; the AI never fabricates.
2. **AI-native** — you can talk to *and direct* the program; the AI advises, explains, narrates, acts.
3. **Beautiful & fun** — premium, instant-feeling, alive; people *want* to use it.
4. **Rock-solid** — never loses work; degrades gracefully; secure by default.
5. **Makes you a better breeder** — surfaces insight a non-statistician would miss; teaches as it works.

Organizing objective: maximize **genetic gain per dollar** (ΔG/$) — `ΔG = i·r·σ_A / L` under budget
and operational constraints (DOMAIN-MODEL §1).

---

## 2. Target users & jobs-to-be-done

**Beachhead:** maize breeders at small/mid programs incumbents price out. **Development data:** maize
(G2F); maize is the market story (ADR-0008).

The breeder's recurring jobs the product must serve:
- **Analyze a trial correctly** — the right mixed model, spatial correction, GxE, heritability — without
  knowing the statistics.
- **Decide what to advance** — rank candidates against a market objective; record the decision.
- **Organize material** — by Stage (pipeline maturity) and Market/Segment (commercial target).
- **Build lists** — assemble bounded, diversity-aware sets of parents/candidates (a daily task).
- **Manage germplasm & inventory** — elite collection, seed on hand, what to increase/discard.
- **See and learn from the data** — visualize, explore, reach decisions fast.
- **(At scale)** optimize operations and spend; move material with compliance.

---

## 3. Product principles (non-negotiable)

These constrain *every* feature.

- **Correctness is the engine's job, not the user's.** The system picks and fits the right model and
  explains the choice; the user never has to know what a BLUP is (ADR-0002).
- **AI proposes & explains; deterministic code owns the science; the human confirms.** The AI never
  computes a statistic or commits anything without a human "yes" (ADR-0002/0007).
- **Visible, Reversible AI Agency.** The AI can pull any lever a user can — always in the open, always
  undoable; never in the dark, never irreversibly (ADR-0003).
- **Insight-first, not table-first.** *(Your strongest requirement.)* The product must make data easy to
  access, visualize, and learn from. It must **avoid**: walls of huge complicated tables; functions the
  user doesn't understand; raw configuration variables/jargon exposed in the UI. Default to the answer
  and the picture; reveal detail on request. If we do this well, we win.
- **Don't overload the user.** Power (optimization, genomics, simulation) is surfaced through plain-language
  goals the AI formulates and explains — never raw tooling (ADR-0011).
- **Data sovereignty as a feature.** Clear ownership, export, provenance; no employer germplasm/IP, ever.

---

## 4. Capability map (MVP vs later)

The full lifecycle (DOMAIN-MODEL §2). **Bold = MVP (M0–M2).** Rest is mapped, sequenced by milestone.

| Area | Capability | Milestone |
|---|---|---|
| **Ingest** | **AI-assisted column mapping + validation report, human-confirmed** | **M1** |
| **Layout** | **As-planted visual field-map editor** (gaps/non-contiguous) | **M1** |
| **Analyze** | **BLUP/BLUE, spatial, MET/GxE, Cullis h², genetic correlations, diagnostics** | **M1** |
| **Organize** | **Stage + Market/Segment** | **M1–2** |
| **Select** | **Gates + market-specific index (weighted + Smith–Hazel); divergence as insight** | **M1** |
| **Decide** | **AdvancementDecision (per candidate × segment); staging rigor** | **M2** |
| **AI copilot** | **grounded Q&A, auto-narrative, view-state actions** | **M1** |
| **Accounts** | **auth, tenancy, persistence, save/reopen** | **M2** |
| Design | trial designer (RCBD/α-lattice/row-col/p-rep) + plot plans | M4 |
| Germplasm | germplasm, pedigree/A-matrix, **inventory mgmt**, elite curation, IP/MTA, lists, diversity/pools, gain | M5 |
| Genomics | markers, G/H, GS, QTL/GWAS; **genomic resources** (genomes/maps/loci/browser) | M6 |
| Capture | mobile (Field Book/BrAPI), image phenotyping | M7 |
| Decision-support | optimization (allocation→logistics) + simulation, Python solvers | M9 |
| Operations | shipping, phyto/permits, payments, disease testing | post-MVP |
| Intelligence | market research/intelligence feeding TPPs | post-MVP |
| Environment | weather/soil/enviromic covariates for GxE | post-MVP (first-class) |

---

## 5. MVP functional requirements (M0–M2)

The analysis → select → advance slice, validated on real (G2F) + simulated data.

**5.1 Ingestion.** Upload CSV/Excel → AI proposes column→role mapping (genotype, env, rep/block, row/col,
trait) and detects design → user confirms/corrects before anything runs → plain-language validation report
(balance, missingness, outliers, factor sanity). BrAPI-aligned storage. *Nothing ingests without confirmation.*

**5.2 As-planted layout.** Visual editor to construct/correct the physical plot map (gaps, obstacles,
non-contiguous ranges); coordinate-column import as fast path. Feeds clean coordinates to the spatial model.

**5.3 Analysis.** Engine deterministically selects and fits the model (single-trial/MET, genotype
random→BLUP / fixed→BLUE), applies spatial correction, computes Cullis h², genetic correlations, GxE/
stability, and diagnostics — and returns *what model it chose and why*. Runs async via the queue with
visible progress.

**5.4 Selection.** Per (Segment × Stage): apply **gates** (independent culling on must-have traits), then
rank survivors by the **market-specific index** — both the transparent weighted index (sum-to-100% alignment
tool) and the genetically-aware Smith–Hazel/desired-gains index. Surface their **divergence** with AI
narration. Live re-weighting recomputes instantly.

**5.5 Advancement.** Record the decision: candidate, from→to Stage, disposition (advance/hold/drop/…),
per Segment, rationale, linked to the analysis. The capstone that closes the loop and seeds gain tracking.

**5.6 AI copilot.** Grounded Q&A over the result bundle (cited, never fabricated); unprompted auto-narrative
("what this trial tells you"); view-state actions (re-weight, filter, what-if) that are visible and reversible.

**5.7 Accounts & persistence (M2).** Auth + tenancy; save/list/reopen trials and analyses; nothing lost.

---

## 6. Data presentation & UX requirements

Per the principle in §3 — treated as first-class because it decides adoption.

- **Lead with the answer and the visualization**, not the data dump. Ranking, biplot, trade-off, heritability —
  shown clearly; the underlying table is one click away, not the front door.
- **No jargon or config exposed by default.** Sensible defaults; the engine decides; advanced knobs hidden
  behind progressive disclosure and explained in plain language when shown.
- **Every chart is legible and purposeful** — no decoration, no overwhelming grids. One question per view.
- **Instant feel** — client-side recompute for live controls; async work behind clear progress.
- **The AI is a presentation surface** — "show me the lines that dropped in yield but held grain protein" yields the
  right view, narrated, not a query language.
- **Consistent design system**; **Next.js 16 / React 19** conventions (read `frontend/AGENTS.md`).

---

## 7. Non-functional requirements

- **Accuracy/trust:** validation suite proves BLUP recovery vs. known truth; AI groundedness eval-gated;
  numbers benchmarked against published/known results.
- **Performance:** no synchronous request waits on a fit (queue + worker); minutes-long spatial/MET fits
  stream progress; live controls feel instant.
- **Stability:** stateless R kernel; durable jobs; graceful degradation; error contracts everywhere.
- **Security & tenancy:** auth on every endpoint; `program_id` isolation tested; secrets managed;
  data export/ownership guaranteed.
- **Deployability:** 12-factor, containerized; local-first → GCP (Cloud Run + Cloud SQL); single-tenant/VPC
  capable for governance-sensitive customers (ADR-0005).
- **LLM flexibility:** provider-abstracted, endpoint-configurable, eval-gated model menu; bundled default +
  BYOK (ADR-0004).
- **Legibility:** science in R; web/AI in TS; optimization in Python — each a stateless worker behind the
  queue (ADR-0001/0011).

---

## 8. Post-MVP requirements (directional)

- **Germplasm & inventory (M5):** pedigree/A-matrix; **inventory** (quantity, location, age/viability,
  increase-needed, safe-discard via stage/market); elite-collection curation; IP/MTA; diversity-aware
  list/pool building.
- **Genomics (M6):** GS (G/H matrices, CV accuracy), QTL/GWAS; **genomic resources**
  (reference genomes, genetic/physical maps, loci, marker positions, genome-browser).
- **Trial designer (M4):** sound randomized designs + plot plans; AI-assisted.
- **Capture (M7):** Field Book/BrAPI mobile; image phenotyping.
- **Decision-support (M9):** ΔG/$ optimization (allocation first, logistics at scale) + simulation, AI-fronted.
- **Operations & compliance:** shipping, phyto/permits, payments, disease testing.
- **Market intelligence:** research feeding TPPs (markets, consumer preference, size/shifts).
- **Environment:** weather/soil/enviromic covariates as first-class GxE inputs.

---

## 9. Success metrics

- A real G2F trial yields spatially-adjusted BLUPs, Cullis h², GxE/stability, both indices with a narrated
  divergence — and a recorded advancement decision — with every number cited (the moat, validated).
- A discerning breeder prefers Verdant's answer to their current workflow (the adoption test).
- Time-to-decision (upload → defensible, recorded selection) is dramatically shorter than the status quo.
- AI groundedness: zero fabricated numbers in eval; refuses cleanly when tools can't answer.
- First non-founder user completes signup → upload → analyze → save → reopen with nothing lost.

---

## 10. Constraints

- **No employer germplasm, data, or IP, ever** — public + self-funded only.
- Built ~8–12 hrs/week; stack must stay legible (R science / TS web / Python solvers).
- MVP scope is the analysis→select→advance slice; do **not** rebuild incumbents' management breadth
  (borrow BrAPI, interoperate, don't fork Breedbase — ADR-0009).
