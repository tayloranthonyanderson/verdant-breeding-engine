# Trait Library + BrAPI-orthodox units (harmonize at ingest, not per-observation)

**Status:** Accepted (2026-06-12) — Thread B, scheduled after ADR-0021. Recorded now so the
near-term Data Quality work (ADR-0021) and the schema do not drift from this decision.

## Context

Value-level Data Quality (ADR-0021) wants trait semantics that a column-blind kernel (ADR-0015)
must not sniff: an "impossible value" needs a valid range; judging a distribution as "wrong"
needs to know a 1–9 disease score *should* be discrete and skewed. And real uploads arrive in
conflicting units (kg/ha vs t/ha vs lb/acre; g vs oz) — a *wrong* unit conversion is an invisible
1000× error in a BLUP, worse than a missing value. Two questions fell out: where do trait
semantics come from, and where are units harmonized?

## Decision

**1. A persistent, per-program Trait Library — AI seeds the cold-start, deterministic thereafter.**
The breeder's curated trait list (with a typical QC procedure per trait) is a real domain object,
not per-upload config. A **Trait** carries: canonical name, **aliases** (for column-name matching
on import), **datatype**, **canonical unit**, **valid range**, and a default **QC method**
(type-keyed; overridable). Lifecycle: at first sighting of a new column the AI *proposes* an entry
from the header + observed distribution; the breeder *confirms once*; deterministic alias-match
reuses it every trial after. The LLM is used only at cold-start; the dictionary is deterministic
from then on. The kernel stays **column-blind** — it consumes the resolved trait tag
(`datatype` / `range`), never the column name (ADR-0015 honoured). Type-keyed default QC methods
mean the median breeder makes zero decisions; power users override per trait.

**2. BrAPI-orthodox units — on the Scale (per-variable), harmonized at ingest, never per-observation.**
This aligns to BrAPI ObservationVariable = Trait × Method × Scale (ADR-0009): the Trait Library
entry *is* a Trait + a canonical Scale; the unit lives on the **Scale**, so it is **per-variable,
never per-observation**. Mixed units are two ObservationVariables sharing one Trait, not one
variable with mixed rows. BrAPI gives the *model and the slots* (Trait, Scale, `dataType`,
`validValues`) but **not** unit conversion or QC — those are net-new and ours to build:

   - **Harmonization happens at ingest** (Thread B), via a small **deterministic conversion table
     keyed by physical dimension** (mass / length / area-yield / temperature). Source unit is
     declared in metadata, or **AI-proposed and breeder-confirmed** — *never magnitude-guessed and
     auto-applied* (the catastrophic path). Confirm-before-convert is a hard rule; an unconfirmed,
     inconsistent unit blocks or hard-flags rather than converting on a guess.
   - **Ordinal rating scales are not units.** A 1–9 Horsfall-Barratt score and a 0–100 % severity
     score are different *scales/methods*, not linearly convertible; the Trait marks them with a
     `scale`, mismatches are flagged for the breeder to reconcile, never fake-converted.
   - The stored `observation` keeps the canonical value; the **import record** (raw upload +
     mapping + conversions) is the immutable audit trail (ADR-0003). `observation` is *not*
     denormalized with a per-row unit.

**3. QC happens at three moments, not one.** **Ingest QC** (pre-commit, at the front door — mobile
capture validates at entry against the Trait Library; the import workflow stages → maps → converts
→ flags → breeder confirms → commits); **Data Quality** (analysis-time, pre-fit, ADR-0021 — now
simpler because it can assume unit-harmonized input); **Model QC** (post-fit, ADR-0021).

## Considered options

- **Per-observation `unit_id` on `observation` — explored and rejected.** It makes ingestion of
  mixed units trivial and self-describing, but it denormalizes away from BrAPI (which puts unit on
  Scale) and then taxes every future BrAPI import/export with a translation step. The mixed-unit
  problem it solves is already solved at the variable level; raw-unit audit is preserved by the
  import record without it.
- **Hardcoded crop preset ladder (`if trait == "Brix" → range 0–25`) — rejected.** Contradicts
  crop-agnostic positioning; every program names traits differently; an infinite curated list that
  still misses each program's idiosyncratic traits.
- **Live LLM on every upload (stateless) — rejected.** Nondeterministic QC run-to-run (poison for
  a trust layer), repeated cost, and the breeder re-confirms the same traits every season.

## Consequences

- The kernel never reads column names or handles units; all semantics arrive as a resolved trait
  tag and all values arrive canonical.
- Building the Trait Library promotes the embryonic `trait` / `unit` / `data_type` fields already
  on `observation_variable` ([`packages/db/src/schema.ts`](../../packages/db/src/schema.ts)) into a
  first-class `trait` table with a `traitId` FK; `observation` is left BrAPI-orthodox (no per-row
  unit). This is a schema change scheduled with Thread B, not Thread A.
- A future reader will not find a per-observation unit column — this ADR is why.
