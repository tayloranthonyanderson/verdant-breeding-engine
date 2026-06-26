# Verdant — the engine contract

This directory is the **single most important seam in the system**: the language-neutral
boundary between the **web tier** (TypeScript — API, GUI, AI orchestration) and the **compute
kernel** (R — the only place statistics happen), and later the **solver service** (Python —
optimization). It is the interface in the architectural sense: everything a
caller must know to request an analysis and consume its result, with nothing of the implementation
behind it.

It exists so that **R, TypeScript, and Python agree on one shape without sharing one language**
(ADR-0001). The schemas here are the source of truth; each runtime binds to them (TS types, R
list-builders, Python dataclasses) rather than re-deriving the shape.

## What's here

| File | What it defines |
|---|---|
| [`v0/analysis-request.schema.json`](v0/analysis-request.schema.json) | the **`analyze()` request** — observations + design + relationship + objective; what the web tier enqueues |
| [`v0/result-bundle.schema.json`](v0/result-bundle.schema.json) | the **result bundle** — effects, varcomp, heritability, chosen-model rationale, indices, diagnostics, warnings; the single object the GUI renders and the AI queries |
| [`v0/examples/`](v0/examples/) | a worked **single-trial selection** request + its result bundle (4 entries, 2 traits, a gate, both indices, their divergence). Concrete, conformant fixtures — the first test data for the kernel and the web tier |
| [`validate.py`](validate.py) | the **conformance check**: meta-validates the schemas and validates every example against them. The seam's test surface |

**Verify it:** `python3 packages/contracts/validate.py` (needs `pip install jsonschema`), or `pnpm --filter @verdant/contracts test` for the TypeScript equivalent. Green means the schemas
are valid Draft 2020-12 and every example still conforms — i.e. the contract is internally consistent.

These two schemas are the realization of the generalized engine contract in
[DOMAIN-MODEL §6](../../docs/DOMAIN-MODEL.md):

```
analyze(data, intent, design+layout, relationship, objective) -> ResultBundle(...)
```

## Design rules (so it stays a deep seam, not a leaky one)

1. **The kernel is stateless (ADR-0001).** The request carries *everything* the fit needs — the web
   tier assembles it from Postgres and enqueues it; R never reaches back for data. (Whether large
   payloads are embedded inline vs. passed by a storage reference the worker resolves is an
   **OPEN** operational detail — see below — but the *logical* contract is "self-contained input.")
2. **The engine owns model choice; the contract carries the breeder's *intent*, never a model spec
   (ADR-0002).** The request says `selection | comparison | prediction`; the kernel decides BLUP vs
   BLUE, which spatial model, which variance structure — and returns *what it chose and why*
   (`chosen_model`) for the AI to narrate. The web tier must not author a formula.
3. **`relationship` is a first-class input, not a fork (DOMAIN-MODEL §6).** `identity | A | G | H`
   is one parameter. MVP fills `identity`; pedigree (A), genomic (G), and single-step (H) BLUP drop
   into the *same* request shape later (M5–M6) with no contract break — they are configurations of
   one model, not new endpoints.
4. **Two indices, divergence as insight (ADR-0006).** The bundle can carry both the transparent
   weighted index and the genetically-aware (Smith–Hazel / desired-gains) index, plus their
   divergence. The transparent weighted index is *also* recomputable client-side for instant live
   re-weighting (PRD §6); the kernel produces the authoritative first pass and the
   covariance structure the genetic index needs.
5. **Versioned and additive.** `contract_version` is required on both messages. `v0` is the
   draft/MVP version: shape may still change. Once we cut `v1`, changes are additive within a major
   version; breaking changes bump the major and live in a new `vN/` directory side-by-side.
6. **Mapped, not built.** Fields for capabilities beyond the current milestone (GxE/stability,
   genetic correlations at scale, A/G/H relationship sources, PEV/reliability) are present and
   **optional** so the seam anticipates them, but the MVP kernel may omit them. Optional ≠ promised.

## What the MVP (M0–M1) actually fills

- **Request:** `intent`, observation units with as-planted `layout`, long-format `observations`,
  `variables`, `design` hints, `relationship.type = "identity"`, and an optional `objective`
  (segment gates + index weights/directions).
- **Bundle:** `chosen_model` rationale, per-trait `effects` (BLUP/BLUE) + `heritability` (Cullis) +
  `varcomp`, `diagnostics`, `indices` (weighted + Smith–Hazel) with `divergence`, and `warnings`.

Everything else in the schemas is the territory mapped ahead of the track (DOMAIN-MODEL discipline).

## OPEN — operational choices deliberately *not* decided here

These are flagged, not silently resolved, because they are genuine forks to settle with the author
at scaffolding time (they do not change the *logical* contract above):

- **Payload transport:** embed observations inline in the queued job vs. pass a storage reference the
  R worker resolves. Affects job-size limits, not the schema.
- **Who computes the transparent weighted index:** kernel-authoritative only, client-only for live
  controls, or both (kernel seeds, client recomputes). Current schema supports all three.
- **Schema → code binding toolchain:** how TS/R/Python types are generated from these JSON Schemas
  (codegen vs. hand-written bindings). A tooling choice, made when the runnable skeleton lands.

## Status

`v0` · 2026-06-11 · draft. Derived from ADR-0001 (spine), ADR-0002 (deterministic science),
ADR-0006 (MVP analysis scope), and DOMAIN-MODEL §6. Not yet exercised by a running kernel — the M0
tracer bullet is what first proves it end-to-end.
