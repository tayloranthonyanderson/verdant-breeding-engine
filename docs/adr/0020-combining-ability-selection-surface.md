# Combining-ability selection surface: unit/pool-scoped objectives, within-pool ranking, dual-source gates

ADR-0019 settled how combining ability is *modelled*; this settles how it is *selected on*. The
GCA decomposition feeds the **existing** transparent + Smith–Hazel index machinery unchanged —
fed GCA BLUPs and a GCA trait-covariance matrix instead of hybrid values — but the **objective**
gains two scope facets beyond the existing (Segment × Stage): the selection **unit**
(`inbred-parent` vs `hybrid`) and the **pool** (heterotic group, derived from the cross-graph per
ADR-0019, not declared). A parent-GCA objective is therefore a first-class, separately-authored
`SelectionCriteria` instance — typically a *simpler, broader* trait subset than the hybrid
objective, because **complementation** lets one parent's weakness be covered by the opposite pool.

## Decisions

- **Ranking is always within-pool.** A single index across both pools would advance only the
  stronger pool and collapse the heterotic structure — treated as a correctness requirement, not a
  preference. Pools are ranked separately; pool membership comes from the topology detector.
- **The index reads GCA; gates may read a *different* value source.** A native-trait gate ("only
  advance inbreds carrying the Pto/bacterial-speck allele") references **directly-observed
  inbred-level data** — per-se phenotype or direct inbred genotyping — never a value inferred from
  hybrid data (which a breeder would not trust; hybrid marker genotypes are parental averages). So
  in GCA mode the gate and the index draw from two value sources keyed to the same parent: GCA
  (from the hybrid model) for ranking, inbred-per-se/marker scores for gating.
- **The native-trait gate is *not* a new gate type.** Presence/absence is a categorical trait run
  through the operators `evaluate_gates` already has (`==`, `!=`, `>=`). The only new thing is the
  **inbred-per-se value source** the contract must expose. (Deriving zygosity from raw marker
  dosage *is* genuinely new and stays deferred — and is largely moot for a ~homozygous inbred.)

## The fixture problem and what we chose

G2F provides parent **identity** only — no direct inbred genotype and no inbred per-se phenotype
(its marker file is a hybrid-level TASSEL build; its trait files are all hybrid-level). So GCA
modelling and within-pool ranking are demonstrable on G2F, but the native-trait gate is
**buildable yet unfixturable** there, and it is really a **tomato-beachhead** workflow (Pto is a
tomato gene), not a maize one.

We chose to **build a small synthetic inbred fixture now** — a per-inbred table over the G2F
parent names carrying a synthetic pool label and one or more presence/absence native-trait scores
— purely to **wire the engine and UI end-to-end** (the inbred-per-se value source, within-pool
ranking, the dual-source gate). It is explicitly scaffolding: the native-trait gate is validated
and shipped for real only against a genuine **tomato inbred dataset** (per-se + Pto-style marker
scores) later. Rejected alternatives: fabricating maize inbred *genotypes* (a detour from the
tomato go-to-market), and sourcing a maize inbred panel from G2F (same detour).

## Deferred (mapped, not built)

SCA-based hybrid prediction, complementation-aware *optimal-cross* selection, and zygosity/
genotypic-state gates derived from raw markers — all land in the later marker / hybrid-prediction
/ GWS bundle, not this cut.
