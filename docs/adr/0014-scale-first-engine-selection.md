# ADR-0014 — Scale-first engine selection: BLUPF90 for multi-trait & genomic, not sommer

**Status:** Accepted (2026-06-11)

## Context
**Scalability to large datasets is a hard product requirement, not a nice-to-have.** The dev dataset
being small (OHH1_2019: 383 genotypes, single location) must never justify a memory-hungry engine —
the toolkit has to hold up on real, large trials and genomic-scale data.

Prior notes were inconsistent and I drifted to the wrong side of them:
- The spike [README](../../README.md) engine-strategy note already said: *"Deliberately avoiding
  sommer (scale crashes), ASReml (cost/support), and INLA-as-core (memory)."*
- But [MVP-PLAN §6](../MVP-PLAN.md) and [ROADMAP](../../ROADMAP.md) still listed **sommer** for
  Milestone-1 "MET + GxE; genetic correlations." This ADR resolves the contradiction in favor of the
  scale-first README position and updates those stale references.

The immediate driver is the Smith–Hazel prerequisite: estimating the **cross-trait genetic
covariance matrix G**. That is a *multi-trait variance-component* problem, and the heavy end (large
single-step genomic evaluation) is where scale bites hardest.

## Decision
**Tiered, scale-first engine strategy:**

| Job | Engine |
|---|---|
| Single-trait everyday spatial/mixed fits (BLUPs/BLUEs, h², spatial) | **SpATS / lme4** (built, M0) — memory-light, fine at trial scale |
| Multi-trait variance components (genetic correlations, the **G** for Smith–Hazel) + large single-step genomic (ssGBLUP) | **BLUPF90 family — `AIREMLF90`** (multi-trait AI-REML), **ssGBLUP** for genomic — compiled Fortran, memory-efficient, the standard for large multi-trait genetic evaluation |
| Single-trait genomic prediction | **rrBLUP / BGLR** (two-step with relationship matrix K), M6 |

**Explicitly avoided:** **sommer** (memory / scale crashes), **ASReml** (cost + poor support — the
established tool this improves on), **INLA-as-core** (memory).

**Why BLUPF90 over rrBLUP for the genetic-correlation / Smith–Hazel task specifically:** rrBLUP is a
*single-trait* tool (`mixed.solve`/`kin.blup` GBLUP, ridge regression) — it does **not** estimate a
multi-trait genetic covariance matrix. A two-step `lme4 + rrBLUP` is the right scalable path for
*single-trait genomic prediction*, but it cannot produce the **G** that Smith–Hazel needs.
`AIREMLF90` does multi-trait REML and returns the full genetic (co)variance matrix directly. So
BLUPF90 is the correct engine for this task, not a compromise.

## Consequences
- BLUPF90 is invoked as an **external compiled subprocess** (renumf90/parameter + data files →
  `airemlf90` → parse solutions & (co)variance components), consistent with
  [ADR-0012](0012-web-tier-and-worker-stack.md)'s subprocess-per-job kernel pattern — now generalized
  from "Rscript" to "any compiled binary behind the same job contract."
- **Runtime: containerized native Linux, not Rosetta.** BLUPF90 ships Intel-only Mac builds and no
  ARM build; the dev machine is Apple Silicon. Rather than translate Intel binaries via Rosetta, we
  run the native **Linux (amd64)** binaries inside a container — which *is* production (Linux hosts).
  Local dev runs the same image under Docker emulation; production runs it native. (Decided
  2026-06-11.)
- **Licensing:** BLUPF90 is free for research/academic use; other uses need a license/agreement
  with the UGA (Misztal) group — note the terms before distributing (the README's "verify licensing").
- Heavier integration than an R library call (data prep, parameter files, convergence handling);
  accepted as the cost of scalability.
- The `engine` contract field already allows arbitrary backends; add `blupf90` / `aireml` as values
  when wired.

## Alternatives rejected
- **sommer** — memory/scale crashes; fails the hard scalability requirement.
- **ASReml** — license cost and difficult support; the established tool this improves on.
- **INLA-as-core** — memory footprint.
- **Two-step `lme4 + rrBLUP` for genetic correlations** — rrBLUP is single-trait and yields no
  multi-trait **G**; retained for the single-trait genomic-prediction path (M6), not for Smith–Hazel.
