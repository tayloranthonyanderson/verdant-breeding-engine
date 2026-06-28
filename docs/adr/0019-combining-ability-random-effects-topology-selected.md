# ADR-0019 — Combining ability as a topology-selected random-effects decomposition (no Griffing method)

When germplasm are crosses (`parent1`/`parent2` present), the planner can decompose the
genotype effect into **GCA** (parent main effects) and **SCA** (cross deviation), turning a
hybrid-performance trial into **parent selection** — which inbreds are good *combiners* — in
addition to the opaque hybrid BLUP we already report. We implement this as **one unified
random-effects (REML/BLUP) mixed model** whose GCA parameterization the planner **selects from
the measured cross-graph topology**, not as a classical fixed-effects Griffing/diallel method.
It is a new `genotype_structure` decision in the Model Plan (ADR-0016), gated by two new
data-readiness diagnostics — **cross-connectivity** (is GCA identifiable, and how precise per
parent, given each inbred's cross-degree) and **cross-replication** (is SCA separable from
residual) — and is overridable like every other planner decision (ADR-0018).

## Why

The decisive verified result (Möhring/Melchinger/Piepho 2011; the 2020 general-diallel work) is
that Griffing, Hayman, and line×tester are **special cases of one general linear model** — the
"stack-long single-GCA" practice and the "simultaneous GCA+SCA" model are reparameterisations of
the same fit, equivalent in balanced data. Real breeding uploads are essentially never balanced,
and each inbred typically has only ~1–6 crosses, so the choice that actually matters is
robustness under imbalance and low degree — where **random-effects BLUP** wins decisively:
REML tolerates imbalance, shrinkage protects thinly-crossed lines, and σ²_GCA stays identified
across many parents even when any one parent has few crosses. The correct *parameterization* is
topology-dependent and the topology is **measurable** from the parent cross-graph, so the kernel
detects it rather than trusting a declared design or column names (ADR-0016).

## Considered options

- **Fixed-effects Griffing / diallel ANOVA — rejected as a method.** It assumes balance (broken
  on real data), and its one genuine output the random model lacks — unbiased *estimates* (BLUE)
  of a deliberately-chosen small parent set with significance tests — is already served by the
  existing `comparison` intent and BLUE pathway. Baker's ratio and GCA/SCA significance come from
  the random model's variance components and likelihood-ratio tests, so nothing analytic is lost.
  Fixed GCA therefore survives only as (i) the automatic small-pool parameterization (e.g. the
  3–5 chosen testers of a line×tester, which cannot support a variance from so few levels and are
  a chosen set rather than a population sample) and (ii) the `comparison`/BLUE intent — not a
  separate Griffing module.
- **A standalone "combining ability" intent/endpoint — rejected.** It would duplicate
  spatial/GxE handling and split the result bundle; the decomposition belongs *inside* the
  existing `analyze()` flow as a genotype-effect parameterization.

## Consequences

- **GCA-only / mid-parent prediction is the default; SCA is the gated exception.** At ≤1 rep and
  ~2–6 crosses/inbred, SCA is usually not identifiable; it switches on only when cross-replication
  clears a real bar, or is predicted via a dominance relationship matrix.
- **The parent relationship matrix (A/G/H on the GCA effect) is load-bearing, not deferred.** Low
  cross-degree is exactly where a kinship matrix on the parents rescues GCA accuracy; the seam to
  the genomic-prediction machinery must exist from the start even if a phenotypic-only version
  ships first.
- **Every GCA estimate carries a degree-driven reliability**, so the UI can flag low-confidence
  (thinly-crossed) parents rather than presenting all GCA ranks as equally trustworthy.
- **A future reader will not find a diallel/Griffing analysis** — this ADR is why: it is a
  deliberate omission, not a gap.
