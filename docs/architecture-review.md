# Architecture review — genomic station (2026-06-11)

Deepening review (deep/shallow/seam vocabulary) after the fast genomic-prediction build. Full HTML
report was generated to a temp file; findings preserved here.

## Refined (done)

**Shared genomic core (`services/kernel/genomic-core.R`).** The VanRaden G build, pedigree-A
recursion, and packed-dosage IO were copy-pasted across `relationship.R`, `genomic-validate.R`,
`genomic-analyze.R`, and `genomic-ssgblup.R`. Extracted to one module (`read_dosage` / `build_G` /
`build_A`) that all four now `source()` — the same pattern the MET kernels already use with
`diagnostics.R`/`plan.R`. **Verified the cross-validation numbers reproduce exactly** after the
extraction (G predictive ability 0.701/0.736/0.326/0.422), so the science is unchanged — the gating
is just concentrated in one testable place now.

## Refined (done) — the genomic-driver sweep (2026-06-12)

Candidates 1–3 below were the same friction from three angles; landed as one sweep on
`feat/genomic-prediction`. All driver paths re-verified end-to-end with **exact** numeric reproduction
(G sanity h²=0.2026; CV G=0.701/0.736/0.326/0.422, A=0.644/0.654/0.191/0.319, identity=0; ssGBLUP
H=0.0765 vs A=0.043), and both kernel transports (stdin + cfg-file) exercised. Package + workspace
typecheck clean.

- **`runRKernel()` — kernel-invocation seam (`kernel.ts`) · was Strong.** The `spawnSync('Rscript', …)`
  → status-check → `JSON.parse` idiom (8 sites, two drifting conventions) now lives behind one runner
  with a `transport: 'stdin' | 'cfg-file'` option; callers name the kernel + payload. The move to a
  durable job queue (ADR-0001) is now a one-module change. Rewired: `pipeline.ts`, `stage1.ts`,
  `planner.ts`, `met-build.ts`, and the four genomic drivers.
- **`buildGenomicInputs()` — genotype-cohort intake module (`genomic-inputs.ts`) · was Strong.** The
  four genomic drivers no longer re-parse `MET_2019.csv` or assemble the pedigree by hand; they ask the
  module for the cohort view (means / genotyped subset / founders-first pedigree). G2F column names are
  confined to a new `parseG2fHybrids()` in the `g2f.ts` adapter (same discipline as `parseG2fMet()`).
- **Driver-scripts-as-library (`entry.ts`) · was Worth exploring.** Each genomic driver now exports its
  core flow (`checkRelationship` / `crossValidateRelationships` / `runSsGblup` / `buildGenomicBlock`)
  and guards the CLI shell with `isEntrypoint(import.meta.url)` — the "does relationship info add value"
  CV flow is importable for the eventual UI/queue trigger without firing the subprocess + DB side
  effects.

## Recommended next (from the review, prioritized)

1. **`blupf90.ts` param-builder · Worth exploring (preventative).** The repo's deepest module — before
   native A/G/H + ssGBLUP options land, factor an `Effect[]` model + `renderRenumPar` so it doesn't go
   shallow under per-feature branches.
2. **`bundleStore` (load-latest / persist / augment) · Worth exploring.** `genomic-build.ts` and
   `met-build.ts` each open-code Drizzle read-modify-validate-write; one store owns validation-on-write.
3. **Transparent index implemented 3× (met-build.ts / analyze.R / IndexExplorer.tsx) · Speculative.**
   Three runtimes can't share code, but a single spec + golden fixture would catch silent ranking drift.
