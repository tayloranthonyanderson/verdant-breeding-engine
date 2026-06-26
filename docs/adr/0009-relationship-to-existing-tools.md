# ADR-0009 — Relationship to existing breeding tools: interoperate, don't rebuild

**Status:** Accepted (2026-06-11)

## Context
Established tools already cover breeding management + standard analysis: **Breedbase**
(open-source; Perl/Catalyst/Mason on a PostgreSQL/Chado schema; field layouts, mobile
capture via Field Book, GS workflows, mixed models/heritability/stability) and **Phenome
(PhenomeOne)** (commercial; germplasm, graphic field-map design, MET/GxE, dashboards). Both
are BrAPI-compliant. A small, part-time project cannot — and need not — re-implement that
breadth.

## Decision
**Focus on the analysis/AI/UX layer; interoperate with the rest.**
- **Borrow the domain model and standards:** align to **BrAPI**; reuse the established
  ontology/workflow vocabulary; **read open-source Breedbase as a reference** for how
  breeding analyses/workflows are structured.
- **Integrate the ecosystem, don't rebuild it:** for mobile capture (a later stage),
  integrate **Field Book via BrAPI** rather than building a mobile app from scratch.
- **Build a clean TS + R stack** (ADR-0001). **Do not fork the Breedbase codebase** — it is
  Perl/Catalyst/Mason/Chado, which contradicts the TS web tier, is less legible to maintain
  solo, and would mean owning a decade of someone else's legacy. "Make it better" here means
  a modern stack connected to the same ecosystem — not inheriting the legacy.
- **Don't rebuild management breadth.** Put scarce hours into the layer these tools are
  weakest on: automated-correct modeling (ADR-0002), grounded AI insight (ADR-0003), and
  ease of use.

## Consequences
- Verdant is an analysis engine that *snaps onto* existing breeding data via BrAPI.
- Risk: "one more tool to plug in." Mitigated by BrAPI interop lowering the integration cost.

## Alternatives rejected
- **Fork Breedbase:** inherits Perl/Chado and its UX paradigm — the opposite of the goal.
- **Re-implement management breadth:** not feasible or useful for a focused, part-time project.
