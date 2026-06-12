# ADR-0016 — Deterministic model planner + engine registry; GxE/staging gated by data readiness

**Status:** Accepted (2026-06-11)

## Context
The headline promise — "picks and fits the *right* model so the breeder doesn't have to know what a
BLUP is" — currently leaks across scattered hardcodes. Single-trial selection lives in `analyze.R`
(SpATS-vs-lme4 by a grid test), MET staging is hardcoded in `met-build.ts` (always two-stage,
genotype-main, **no GxE**), and the grid/rep gating logic is **duplicated** between `analyze.R` and
`stage1-spatial.R`. Three gaps follow from that:

1. **GxE fires blindly or not at all.** It is hardcoded off today. But GxE is only *identifiable*
   when the data supports it: genotypes must be connected across environments, and the residual error
   must be estimable (within-environment replication, or a weighted two-stage carrying Stage-1 SEs).
   Estimating it anyway reports confounded variance dressed up as an interaction.
2. **Single-stage vs two-stage is a hardcode, not a choice.** One-stage (joint REML) is the
   statistical gold standard; the current unweighted two-stage was a pragmatic detour, not a
   principled selection.
3. **Engines are not pluggable.** rrBLUP/BGLR (genomic) have no seam to slot into; `relationship: A/G/H`
   is in the contract but unbuilt.

[ADR-0002](0002-deterministic-science-ai-explains.md) already fixes *where* the statistician lives
(deterministic, R-owned; the AI explains, never decides). This ADR makes that statistician a single
named component and gives it the mechanism to choose and explain every model decision.

## Decision
Introduce a deterministic **Model Planner** in the R kernel, backed by three concepts:

**1. Data readiness** — deterministic diagnostics computed from the generic plot record
([ADR-0015](0015-crop-agnostic-met-seams.md)), never from dataset column names:
- per-environment **GRID** — row/col density → is a spatial term fittable?
- per-environment **REPLICATION** — entry replication within an environment → is residual error
  identifiable?
- cross-environment **CONNECTIVITY** — genotypes shared across environments (median environments per
  genotype / concurrence) → is GxE/stability estimable?
- **SCALE** — n_obs / n_geno / n_env / n_traits, marker data present.

These unify the duplicated `has_grid`/`has_rep` logic into one shared module that both `analyze.R` and
`stage1-spatial.R` call (the deletion test: gating concentrates in one place).

**2. Model Plan** — the planner's declarative output *before* fitting: trial structure (single vs
MET), spatial method per environment, genotype effect (random/fixed), **GxE include/skip**,
**staging single vs two-stage (weighted)**, engine, relationship. **Every decision carries a reason
and the diagnostic value that triggered it.** The plan is the contract between deciding (R) and
executing (TS): the TS tier runs the named engine(s), it makes **no** scientific choice.

**3. Engine registry** — each engine (lme4, SpATS, BLUPF90, and future rrBLUP/BGLR) is an adapter
behind a uniform `plan → result` interface plus a **capability descriptor**: multiTrait, gxe, spatial
methods, relationship support, genomic, scale tier. The planner selects an engine by **matching the
plan's required capabilities**, breaking ties by the [ADR-0014](0014-scale-first-engine-selection.md)
scale tiering. rrBLUP plugs in by declaring a single-trait-genomic capability — no re-architecting.

Locked policy the planner encodes:

- **One-stage is the DEFAULT.** BLUPF90 fits `env(fixed) + genotype(random, G) + GxE(random, gated) +
  spatial` jointly in one AI-REML run — correct uncertainty propagation, the gold standard.
- **Weighted two-stage is the deliberate SCALE fallback** (Smith–Cullis–Thompson): SpATS adjusted
  means + their SEs as weights (`1/SE²`) feed BLUPF90. Chosen **only** when a scale/feasibility gate
  trips (equation count too large, or one-stage spatial infeasible) — not the everyday path.
- **GxE fires only when identifiable** — it requires cross-environment **connectivity** AND residual
  identifiability (within-environment **replication**), *or* a weighted two-stage whose Stage-1 SEs
  carry the residual. Otherwise GxE is skipped, and the breeder is told why with the diagnostic value
  and a hint about what data would unlock it (e.g. "genotypes appear in a median of 1.2 environments —
  connect more material across locations"; "no within-location replication — add replicated
  checks/reps").

## Consequences
- The decision narration — what was fitted and why, **and** what is *not* done plus what data would
  unlock it — becomes a first-class output and the product's trust/teaching surface ("automate the
  expert"). It rides the **result bundle** alongside `chosen_model` as a `decisions[]` log plus a
  `data_readiness` object with `unlocks[]` entries.
- Model selection stays deterministic and reproducible: two runs on the same data produce the same
  plan, so the plan goes straight into the validation suite ("given this data shape, the planner picks
  this model"), consistent with [ADR-0002](0002-deterministic-science-ai-explains.md).
- Engine **tiering** is unchanged from [ADR-0014](0014-scale-first-engine-selection.md) (SpATS/lme4
  small; BLUPF90 multi-trait/genomic; rrBLUP/BGLR single-trait genomic, M6). This ADR adds the
  registry/selection *mechanism*; it does not move any engine between tiers.
- Stays crop/user-agnostic ([ADR-0015](0015-crop-agnostic-met-seams.md)): the planner reads the
  generic plot record, never `Range`/`Pass`/`Hybrid`. Adding a crop = an ingestion adapter, not a
  planner change.
- rrBLUP/BGLR slot in as capability descriptors + adapter stubs (M6) without touching the planner's
  decision logic — the registry is a real seam, proven by two descriptors beyond the built engines.

## Alternatives rejected
- **Keep staging hardcoded (today's always-unweighted-two-stage).** Ships the *weakest* form of the
  analysis as if it were a choice, hides the gold-standard one-stage path, and forks per dataset when
  scale forces a different staging. The staging decision must be data-driven and explained.
- **Always-on GxE.** Estimating a genotype×environment term when genotypes aren't connected across
  environments or the residual isn't identifiable reports **confounded variance** as interaction —
  plausible-but-wrong, the one thing a breeder can't forgive. GxE must be gated on connectivity +
  residual identifiability.
- **TS-side model selection.** Letting the web tier (or an LLM) choose staging/spatial/GxE breaks
  reproducibility and violates [ADR-0002](0002-deterministic-science-ai-explains.md). The TS tier
  executes the plan; it never authors a model spec.
