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

## Recommended next (from the review, prioritized)

1. **`buildGenomicInputs()` — genomic-inputs TS module · Strong.** `genomic-build.ts`,
   `genomic-validate-run.ts`, `ssgblup-run.ts`, and `genomic-check.ts` each re-parse `MET_2019.csv`,
   rebuild the per-hybrid-means map, and assemble the founders-first pedigree — bypassing the clean
   `parseG2fMet()` seam. A module exposing the cohort / per-hybrid-means / pedigree view removes the
   duplication (a missing seam, not just repetition).
2. **`runRKernel()` — R-kernel runner seam · Strong.** The `spawnSync('Rscript', …, maxBuffer)` →
   status-check → `JSON.parse` idiom is hand-written in ~7 places (two drifting conventions: stdin vs
   cfg-file). One runner makes the eventual durable-job-queue move (ADR-0001) a one-module change.
3. **Driver-scripts-as-library · Worth exploring.** Load-bearing genomic logic lives inside
   `console.log`/`process.exit` `main()`s across five sibling scripts; only `genomic-build.ts` is a
   production path. The "does relationship info add value" CV flow should be importable.
4. **`blupf90.ts` param-builder · Worth exploring (preventative).** The repo's deepest module — before
   native A/G/H + ssGBLUP options land, factor an `Effect[]` model + `renderRenumPar` so it doesn't go
   shallow under per-feature branches.
5. **`bundleStore` (load-latest / persist / augment) · Worth exploring.** `genomic-build.ts` and
   `met-build.ts` each open-code Drizzle read-modify-validate-write; one store owns validation-on-write.
6. **Transparent index implemented 3× (met-build.ts / analyze.R / IndexExplorer.tsx) · Speculative.**
   Three runtimes can't share code, but a single spec + golden fixture would catch silent ranking drift.
