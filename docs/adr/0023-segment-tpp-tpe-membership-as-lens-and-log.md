# ADR-0023 — Segment = TPP + TPE; membership is a lens + a log, never germplasm state

**Status:** Accepted (2026-06-13) — refines ADR-0019/0020 (combining ability; Segment×Stage Selection
Criteria); the data-model corollary of ADR-0011's decision-support framing.

## Context

A **Segment** (the breeder's *target market* — what material is bred for) drives market-specific
selection: same data + different Segment ⇒ different ranking (CONTEXT; ADR-0020). Designing it
surfaced three facts that break the naive `germplasm.segment_id` model:

1. An **inbred** serves many Segments at once — a reusable building block whose GCA feeds crosses for
   several markets, indefinitely. It never "narrows."
2. An **early-stage hybrid** is trialed across several Segments, then **narrows** to one (or few) as
   data reveals fit — the funnel in the *segment* dimension.
3. Segments are sometimes defined by **target environment** (the data partitions; GCA×E) and sometimes
   by **trait priorities over shared trials** (one fit, many index lenses). Both are common; and
   segmentation is a **business-strategy input** — effective-dated, not inferable from genetics.

So Segment membership is many-to-many AND time-varying AND of two different kinds. It cannot be state
on the germplasm.

## Decision

**1. A Segment is two facets — a TPP and a TPE.**
- **TPP — Target Product Profile**: the Selection Criteria `{gates, index}` — *what to select for*.
  Always present.
- **TPE — Target Population of Environments**: the environment envelope the trial network *samples* —
  *what data pools meaningfully*. Shared across Segments, or specific to one.

Trait-defined Segments differ in **TPP** and share a **TPE**. Environment-defined Segments differ in
**TPE**. Most differ in both — the model keys on the facets, never on a mode flag.

**2. Membership is never germplasm state — it is a lens + a log + a data tag.**
- **Evaluation (lens)** — any candidate can be scored against any Segment's TPP at any time. Free,
  ephemeral, fully many-to-many. A query, not a stored fact.
- **Advancement Decision (record)** — the *real* membership: per-(candidate, Segment, Stage),
  recorded, reversible (ADR-0003). The broad→specific **narrowing is emergent** from accumulated
  per-Segment `drop`/`advance` decisions — never a stored "current segment(s)" field.
- **Study ↔ TPE tag** — the poolable-data envelope lives on the **Study/environment** (many-to-many),
  not the candidate. "Analyze within Segment X" = fit on the studies tagged to X's TPE. Same boundary
  as **Discovery isolation** (training-set relevance).

**3. Fits key on the distinct TPE; rankings key on (TPE-fit × TPP-index).**
The expensive mixed model is computed **once per distinct TPE**; Segments that share a TPE share that
fit and apply N cheap index lenses. A Segment with its own TPE gets its own fit, so **GCA×E / G×E
falls out of TPE partitioning** natively — no special case. The Model Planner already scopes a fit
from data readiness (ADR-0016); the TPE is the study-set filter applied *before* planning. The kernel
stays column-blind (ADR-0015/0016): it receives the scoped dataset + the resolved index, never the
Segment's business meaning.

## Considered options

- **`germplasm.segment_id` (or a `germplasm_segment` membership table) — rejected.** Cannot express an
  inbred in five Segments, a hybrid narrowing over Stages, or the effective-dated business nature
  without a second timeline anyway. Membership is a *consequence* of decisions; storing it as state
  duplicates the Advancement-Decision log and inevitably drifts from it.
- **One global fit, many index lenses (always) — rejected.** Cannot express environment-defined
  Segments (no GCA×E); collapses the real "both" to one case.
- **One fit per Segment (always) — rejected.** Wastefully refits Segments that share a TPE and differ
  only in trait weights; the index lens is cheap and must be reused.
- **Segment as objective (TPP) only, envelope chosen per-analysis ad hoc — rejected.** Loses the
  durable, declarable, business-owned TPE; makes "what data pools meaningfully" a per-run guess rather
  than a Segment property.

## Consequences

- No `germplasm.segment` column will ever appear — a future reader who looks for one finds this ADR.
  Membership is derived: lens (query) + log (Advancement Decisions) + data tag (Study→TPE).
- The **target-authoring assistant** (the AI surface that turns a breeder's market intent into a
  TPP+TPE) is where **business strategy enters the system** — the seam ADR-0011 implies.
- A Segment's TPE being effective-dated means an analysis envelope can shift over time (new region,
  climate) without rewriting history — re-runs are new immutable analysis runs (ADR-0003).
- Schema, when built: a `segment` table (TPP = gates+index ref; TPE = an effective-dated study-tag
  query), a `study`↔`segment` relevance tag, and Advancement Decisions carry their already-specified
  per-Segment scope. **Mapped now, built with the selection-target work — not the ingestion thread.**

## Amendment (2026-06-14) — the data-cut model, built on the synthetic tomato program

The first concrete realization of "membership = tag + lens, never on germplasm." On the staged tomato
corpus (`docs/sim-corpus-spec.md`, `services/kernel/sim-corpus.R`), the breeder selects a **data cut**
without tagging germplasm or checking trials one by one:

- **Trials carry a market tag in a shallow hierarchy** (`All` > `Processing` / `Fresh-East`),
  **defaulted by stage**: early stages tag the broad parent (`All`), advanced stages tag the TPE node.
  Tagging a parent automatically covers its children — one tag, no per-trial work, "broad early /
  narrow late" emerges from *which level you tagged*, which tracks the stage.
- **Germplasm is never tagged.** A line's markets are **derived** — the markets of the trials it
  appears in. Early `All`-tagged trials surface a line under every market; once it only appears in a
  TPE-tagged trial, it narrows. No `germplasm.segment_id`, exactly as this ADR requires.
- **Two purposes assemble two cuts from the same tags** (`packages/pipeline/src/tomato-corpus.ts`):
  - **Prediction (broad)** — relevance is the **TPE, not the stage**: pool every trial tagged with the
    market's node *or an ancestor*, across all stages and years. The TPE is the target you predict
    *into*; testing environments are informants. (Correlation/covariate weighting of off-target
    proxies is the documented next increment — here the tag is the first-order relevance filter.)
  - **Advancement (narrow)** — only the latest-stage trials for that TPE node: the focused
    advance/drop decision set.
- **Markets sharing a TPE share one fit, differ only by index lens** (Proc·Brix and Proc·Firmness pool
  identical trials, ranked by different weights); an environment-defined market (Fresh-East) gets its
  own fit, carrying GCA×E. Demonstrated end-to-end: the cut's plots → multi-trait AI-REML
  (`tomato-build.ts`, the same crop-agnostic BLUPF90 engine as the G2F MET) → market index → bundle,
  with the cut's data scope recorded in `data_readiness.cut`. UI: `DataCutPicker` (pick purpose +
  market; see the full trial catalog with in/out highlighting) on the tomato front door; the grounded
  Q&A answers against the selected cut's bundle.

The durable schema this ADR sketches (a `segment` table, a `study`↔`segment` relevance tag, decisions
carrying per-Segment scope) is still deferred to the selection-target/ingestion work; the corpus seeds
the tags from a manifest. What's proven now is the *model*: tags on trials, lens on read, cut by purpose.

**The breeder DEFINES the cut (2026-06-14).** The templates (purpose × market) are starting points, not
the product. The `DataCutPicker` is a **builder**: seed from a template, then tick/untick the exact
trials (the breeder's judgement is the relevance model — keep a correlated off-target trial, drop a
noisy nursery), choose the market to rank on, **name it, and save it as a re-runnable preset**. A saved
cut persists as its own study (`source='tomato-cut'`) carrying its trial list in the bundle's
`data_readiness.cut`; it re-runs on current data and can be deleted (`saveAndRunCut` / `analyzeCut` /
`deleteCut` server actions; `buildCustomCut` in the pipeline). This is the "saved trial set" primitive —
the lightweight precursor to the durable `segment`/study-tag schema, validated against real fits.
