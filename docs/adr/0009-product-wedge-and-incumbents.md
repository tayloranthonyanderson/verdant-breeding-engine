# ADR-0009 — Product wedge & relationship to incumbents: borrow, interoperate, build our own

**Status:** Accepted (2026-06-11)

## Context
Capable incumbents already do breeding management + standard analysis: **Breedbase** (open-source;
Perl/Catalyst/Mason on a PostgreSQL/Chado schema; field layouts, mobile capture via Field Book, GS
workflows, mixed models/heritability/stability) and **Phenome (PhenomeOne)** (commercial; germplasm,
graphic field-map design, MET/GxE, dashboards). Both are BrAPI-compliant. A part-time founder cannot
out-breadth them.

## Decision
**Hold a narrow AI/analysis/UX wedge — out-*delight*, not out-*feature*.**
- **Borrow the domain model and standards:** align to **BrAPI**; reuse the established ontology/workflow
  vocabulary; **read open-source Breedbase as a reference** for how breeding analyses/workflows are structured.
- **Integrate the ecosystem, don't rebuild it:** for mobile capture (a later stage), integrate **Field Book
  via BrAPI** rather than building a mobile app from scratch.
- **Build our own clean TS + R, AI-native stack** (ADR-0001). **Do not fork the Breedbase codebase** — it is
  Perl/Catalyst/Mason/Chado, which contradicts the TS web tier, is *less* legible to the founder (not more),
  carries the exact desktop-era UX we differentiate against, and would make a part-time founder the maintainer
  of a decade of someone else's legacy. "Make it better" = out-design on a modern stack, connected to the same
  ecosystem — not inherit the legacy.
- **Do not rebuild management breadth in the MVP.** Pour scarce hours into the layer incumbents are weakest on:
  automated-correct modeling (ADR-0002), AI-native insight/agency (ADR-0003), and ease/beauty.

## Consequences
- We become the brilliant AI-native analysis brain that *snaps onto* existing breeding data via BrAPI — a
  feature, not a weakness; the wedge later widens into management on our terms.
- Risk: "yet another tool to plug in." Mitigated by BrAPI interop lowering switching cost and by the
  differentiator being genuinely hard to copy (breeder expertise + AI).

## Alternatives rejected
- **Fork Breedbase:** inherits Perl/Chado, its UX paradigm, and all its breadth — the opposite of the wedge.
- **Compete head-on on management breadth:** how a part-time founder loses to a decade-ahead incumbent.
