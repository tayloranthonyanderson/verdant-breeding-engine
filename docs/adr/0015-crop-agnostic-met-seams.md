# ADR-0015 — Crop-agnostic MET: generic plot-record schema + program-owned objective

**Status:** Accepted (2026-06-11)

## Context
The G2F maize MET is a **dev fixture**, not the product. The toolkit must serve many crops
(hybrid, inbred, clonal) and many users, so the analysis engine must carry **zero** knowledge of any
dataset's column names, trait list, or breeding objective. Two places were quietly violating that as
the MET model grew toward GxE + spatial:

1. **Field layout was about to be hardcoded.** Adding a within-environment spatial term needs plot
   coordinates (row/column) and design factors (rep/block). The G2F file spells these `Range`,
   `Pass`, `Replicate`, `Block`. If the spatial kernel reads those names, every new crop/dataset
   forks the engine.
2. **The selection objective is hardcoded in the tracer.** The seed index weights live as a literal
   `WEIGHTS` array in `met-build.ts` (maize-specific: `Ear_Height_cm → min 0.15`, …). That is a
   demo's *starting slider state* leaking into build scaffolding. A second crop's adapter would
   copy-paste a second hardcoded block — the classic shallow duplication.

This ADR fixes the seams **before** the second adapter exists, while there is still only one to
change.

## Decision

**1. The engine speaks a generic plot-record schema; ingestion adapters do the mapping.**

The spatial/MET stages consume a crop-neutral record:

```
{ genotype, environment, row, col, rep, block, values: number[] }   // values aligned to variableIds
```

- `row`/`col` are **generic field coordinates** (any 2D grid), `rep`/`block` generic design factors —
  all nullable. The engine decides *from the data* whether a usable grid exists (≥5×5, enough plots),
  exactly as `analyze.R::fit_trait` already does for single trials.
- **Dataset-specific column mapping is the ingestion adapter's job.** G2F's `Range→row`, `Pass→col`,
  `Replicate→rep`, `Block→block`, `Hybrid→genotype` mapping lives in the g2f layer
  (`packages/pipeline/src/g2f.ts`), never in the kernel or the BLUPF90 adapter. This is the same
  boundary [ADR-0007](0007-ai-assisted-ingestion-brapi.md) draws (BrAPI-aligned ingestion) and
  [build-crop-and-user-agnostic] in memory: crop specifics live in adapters, the core stays generic.

**2. The selection objective is program-owned config, not engine/tracer code.**

The index template (which traits, default selection mode, default weights, gates) describes a
**program's breeding goal** — it belongs to the program/study record the adapter creates, seeded into
the bundle, *not* to the engine and *not* hardcoded in a build tracer. The engine
(`select-index.R`, `IndexExplorer`) already treats the objective purely as data read from
`weights_used`; it has no trait-specific logic. The remaining smell is only the *location* of the
seed: it must move from a literal in `met-build.ts` toward `program.objective_template`, supplied by
ingestion. (Mechanically staged: keep the seed in the tracer for the dev fixture for now, but treat
it as fixture data, and give it a real home on the program record as the ingestion path matures — do
not add a second hardcoded objective.)

## Consequences
- The two-stage MET (Stage 1 spatial de-trend → Stage 2 multi-trait GxE) is implemented against the
  generic record above. Stage 1 (`stage1-spatial.R`) and the BLUPF90 stage-2 adapter never reference
  `Range`/`Pass`/`Hybrid`.
- Adding a crop = writing an ingestion adapter that emits the generic record + an objective template.
  No engine change. This is the **deletion test** passing: delete the g2f mapping and the engine
  still compiles and runs on any other adapter's records.
- Hybrid/inbred/clonal differences (pedigree vs genomic relationship) enter through the relationship
  matrix the adapter supplies, not through engine branches — consistent with the relationship field
  already in the contract.

## Alternatives rejected
- **Let the kernel read dataset column names directly** — fastest for one dataset, forks the engine
  per crop. Fails the crop-agnostic requirement.
- **Keep objectives as code in each tracer** — shallow duplication; a breeding goal is user/program
  data, not engine logic. It also blocks per-program objectives for multiple programs on one crop.
