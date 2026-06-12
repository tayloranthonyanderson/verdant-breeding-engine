# Genomic prediction — validation (does relationship information add value?)

**Status:** validated 2026-06-11 · dataset: G2F MET_2019, 1,153 genotyped hybrids × 50,000 QC markers
(MAF ≥ 0.05) · engine: rrBLUP `kin.blup` · `services/kernel/genomic-validate.R`.

## The test

Three relationship models on a **common cohort and common folds**, cross-validated (5-fold × 2-rep):
**identity** (I — no borrowing between genotypes), **pedigree** (A — numerator relationship from
`parent1/parent2`), **genomic** (G — VanRaden, scaled to mean-diagonal 1). Predictive ability =
correlation between the GEBV predicted for a **masked** genotype and its observed phenotype. Masking is
the fair test: with identity a masked line has no relatives to borrow from, so it can only be predicted
as the mean (ability ≈ 0); A and G borrow from relatives, so the **gain over identity is the value of
the relationship data**, and G over A is the value of the markers.

## Result — predictive ability (CV r, predicted vs observed)

| Trait | identity | pedigree (A) | genomic (G) | **G − A gain** |
|---|---:|---:|---:|---:|
| Plant_Height_cm | 0.000 | 0.644 | **0.701** | +0.056 |
| Ear_Height_cm | 0.000 | 0.654 | **0.736** | +0.082 |
| Yield_Mg_ha | 0.000 | 0.191 | **0.326** | +0.135 |
| Grain_Moisture | 0.000 | 0.319 | **0.422** | +0.103 |

**Genomic beats pedigree on every trait**, and the gain is largest for **yield (+0.135)** — exactly the
trait where within-family Mendelian sampling matters most. Pedigree gives every full-sib the same
expectation; markers tell sibs apart. Identity predicts nothing for un-phenotyped material — which is
the entire value proposition of relationship-based prediction, shown starkly.

**Calibration (LR dispersion, slope of observed on predicted; 1.0 = well-calibrated):** 0.997 / 0.995 /
0.973 / 1.004 across the four traits — the genomic predictions are well-scaled, not over/under-dispersed.
(Absolute LR bias is not meaningful here because GEBVs are centered at 0 while phenotypes are on their
raw mean; dispersion is the calibration metric.)

## Single-step (ssGBLUP) — recovering un-genotyped lines

The point of single-step is predicting individuals with **no markers** by blending pedigree (A) and
genomic (G) into H (Legarra–Aguilar–Misztal). Tested on the **44 MET hybrids that have a phenotype but
no genotype** (leave-one-out predictive ability):

| Model | predictive ability (un-genotyped lines) |
|---|---:|
| genomic G | — (cannot predict — no markers) |
| pedigree A | 0.043 |
| **single-step H** | **0.077** |

H nearly doubles pedigree-only ability for the un-genotyped lines by borrowing marker information from
their genotyped relatives — the lines genomic-alone simply cannot touch. `services/kernel/genomic-ssgblup.R`.

## Reproduce

```
corepack pnpm --filter @verdant/pipeline exec tsx src/genomic-validate-run.ts
```

Builds G from the packed CallSets (ADR-0017) + A from the pedigree, runs the common-fold CV, prints the
table above, and writes the machine-readable results JSON. Deterministic (fixed fold seed).
