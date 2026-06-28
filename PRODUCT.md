# Verdant — Product Brief

> An open-source breeding-analytics engine for small breeding programs that have
> trial data but no statistician on staff. A teaching project — not a
> commercial product.

## The one-liner
Upload your trial data, get the right answer — correct mixed-model BLUPs/BLUEs,
heritabilities, and a ranked selection index — then ask your data questions in plain
English, answered only from the computed result.

## The problem it addresses
Small breeding programs (specialty crops, controlled-environment ag, university and
overseas programs) collect good data but often lack a quantitative geneticist to:
- design sound trials,
- fit the *correct* linear mixed model (fixed/random effects are easy to get wrong),
- compute selection indices and interpret GxE / stability,
- and, increasingly, run genomic prediction.

Established tools (Breedbase, BMS/IBP, EBS, and stats engines like ASReml) are powerful
but assume the user already has statistical expertise. Verdant explores the opposite
assumption: encode the modeling choices in the engine so a non-specialist gets a
correct, explainable answer.

## What it demonstrates
- **Automated-correct statistics:** the engine picks and fits the right mixed model and
  returns BLUPs/BLUEs, heritability, and a ranked, re-weightable selection index.
- **A grounded AI layer:** an assistant that explains the result in plain language and is
  tool-constrained so every number traces to the computed bundle — it explains, it never
  computes.
- **A clean orchestration layer** over proven solvers (lme4 → rrBLUP → BLUPF90).

## Scope
- **MVP slice (built):** trial/phenotype data in → BLUPs/BLUEs, heritability, ranked
  selection index out, with interactive trait weighting. Everything else is roadmap.
- Built part-time, on **public and self-funded data only** — no employer germplasm, data,
  or IP, ever. Demonstrated on a public/simulated maize corpus.
