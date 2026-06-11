# ADR-0002 — Deterministic science in R; the AI explains, never decides

**Status:** Accepted (2026-06-11)

## Context
The headline promise is "picks and fits the *right* model so the user doesn't have to
know what a BLUP is." Something must *be the statistician* — decide single-trial vs MET,
spatial correction or not, genotype fixed vs random, which solver. Where that brain lives
determines what crosses the R↔TS seam and whether the product is trustworthy.

## Decision
- **Model selection is deterministic and lives in R.** The TS tier sends *data + intent*
  ("analyze these traits for selection; here's the design"); R inspects the data, **decides**
  the model deterministically, fits it, and returns the bundle **plus a record of what it
  chose and why**. What crosses the seam is `data + intent → bundle + chosen-model-rationale`,
  never a TS-authored model spec.
- **The AI explains and advises around the choice; it never originates it.** R may expose a
  deterministic `recommend_model(data, intent)` the AI can call to *narrate* ("I used a
  row–column spatial model because your trial shows a clear field gradient").
- This generalizes to a product-wide principle: **the AI *proposes and explains* the messy
  human-judgment parts; deterministic R *owns* the science; the human *confirms*.** (See
  ADR-0003, ADR-0007.)
- **No model-form override in the MVP.** The breeder nudges weights and trait directions, not
  the model form. Expert hand-specification is a deferred post-MVP "expert mode."

## Consequences
- Two runs on the same data always pick the same model → reproducible, testable, defensible.
  Model selection goes straight into the validation suite ("given this data shape, the engine
  picks this model").
- The trust pillar ("never fabricates") is structural, not aspirational.
- Cost: less on-the-fly flexibility for power users (mitigated by the deferred expert mode).

## Alternatives rejected
- **LLM/TS picks the model:** an LLM probabilistically choosing the mixed model breaks
  reproducibility and is how plausible-but-wrong analyses ship — the one thing a breeder
  can't forgive.
