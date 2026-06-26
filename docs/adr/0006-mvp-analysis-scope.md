# ADR-0006 — MVP analysis scope: spatial, as-planted layout, dual index

**Status:** Accepted (2026-06-11)

## Context
Science-first sequencing means the MVP analysis *is* the technical core — it must be deep enough that a
PhD breeder trusts it over their current workflow (and over existing tools). A naive wrapper around
three lines of `lme4` is not that.

## Decision
**Spatial analysis is in the MVP.** A breeder looking at field-trial BLUPs with no spatial
correction distrusts them on sight; spatial is where breeders get it wrong or need a statistician —
the kind of expert step the project aims to automate. Use row–column / AR1×AR1 or `SpATS`/`statgenSTA` splines.

**The as-planted layout is a first-class object, decoupled from any design.** Even a
Verdant-generated design is a *proposal* reality deviates from (you're a guest in a grower's
field). The bottleneck in practice is *capturing the messy as-planted layout*, not the spatial math.
- **MVP:** a **visual field-map editor** to construct/correct the as-planted grid (place plots, mark
  gaps/obstacles, non-contiguous ranges), feeding clean coordinates to the model. Coordinate-column
  import stays as the fast path when clean coordinates exist.
- **Architected for, deferred:** **AI-assisted layout reconstruction** (photo of a hand-drawn map /
  field-book → proposed layout the breeder corrects). A future "wow," not an MVP gate.
- The layout object is shared across designer (as-designed), capture (as-planted), and analysis
  (coordinates).

**Selection objective uses two indices, both in the MVP, because they do different jobs:**
- **Transparent weighted index** — a *communication/alignment instrument* (e.g. force weights to
  sum to 100% to drive the breeder↔commercial priority conversation). Live, slider-driven,
  instantly recomputed client-side. Statistically naive (ignores genetic correlations).
- **Genetically-aware index** (Smith–Hazel / desired-gains) — the *statistically optimal* decision,
  reusing the genetic-correlation matrix the multi-trait model already produces.
- **Their divergence is a first-class insight:** "your stated priorities rank X; what's statistically
  optimal given how your traits co-inherit ranks Y; here's why they part ways." The AI narrates the gap.
- Desired-gains is the breeder-friendly default for elicitation; economic ($) weights available for
  commercial-alignment cases. (Default UX settled at index-screen design time.)

## Consequences
- The heaviest part of the MVP (spatial stats + layout editor) — accepted, because skipping it ships
  an MVP a PhD finds unconvincing, defeating science-first.
- Genetic correlations are computed regardless, so the rigorous index is high-value at low marginal cost.

## Alternatives rejected
- **Simple single-trial/MET + z-score index only:** does nothing a breeder couldn't do in `lme4`
  themselves; can't be the thing that earns their trust.
- **Coordinate-columns-only layout:** fails on the real-world mess that is the actual bottleneck.
