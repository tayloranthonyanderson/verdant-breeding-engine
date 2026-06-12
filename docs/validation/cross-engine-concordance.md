# Cross-engine GBLUP concordance — rrBLUP vs native BLUPF90 (preGSf90)

Same genomic model (VanRaden G, GBLUP), two independent engines, MET Yield_Mg_ha cohort.

| metric | value |
|---|---|
| genotypes compared | 1153 |
| Pearson r (GEBV) | **0.9687** |
| Spearman ρ (GEBV rank) | 0.9645 |
| h² rrBLUP | 0.2026 |
| h² BLUPF90 | 0.2026 |

rrBLUP is the fast cross-validation engine; native BLUPF90/preGSf90 is the scale engine. A high GEBV
correlation confirms the two solvers agree on the same model — the trust gate for swapping engines.
Pearson can sit just under 1.0 because preGSf90's VanRaden G and rrBLUP's are scaled differently
(a near-monotonic transform), so Spearman ρ is the cleaner agreement measure.
