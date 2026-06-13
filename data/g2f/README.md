# G2F development data (public)

Source: **Genomes to Fields (G2F)** Maize GxE project — public release, via the 2022 GxE
Prediction Competition training set (`1_Training_Trait_Data_2014_2021.csv`).
Upstream: https://www.genomes2fields.org · CyVerse Data Commons. Public, freely available
(satisfies the "public + self-funded data only" constraint).

- `raw/` — the full 2014–2021 trait file (~25 MB, **git-ignored**; re-download, see below).
- `OHH1_2019.csv` — **M0 dev trial.** 500 plots, 383 hybrids, augmented/p-rep design, perfect
  20×25 Range×Pass grid, 100% yield-complete. Realistic breeding-program-scale single trial.
- `NEH4_2017.csv` — textbook sanity trial: 100 hybrids × 2 full reps, 5×20 grid (yield-focused).

Re-download the raw file:
```
curl -sL https://raw.githubusercontent.com/dperondi/maizegxeprediction2022/HEAD/data/raw/Training_Data/1_Training_Trait_Data_2014_2021.csv \
  -o data/g2f/raw/1_Training_Trait_Data_2014_2021.csv
```

## Genotype data (markers) — for GBLUP / rrBLUP

Source: the **official** G2F GxE competition archive on CyVerse Data Commons
(DOI [10.25739/tq5e-ak26](https://doi.org/10.25739/tq5e-ak26)). The competitor GitHub repo's
`5_Genotype_Data_All_Years.vcf.zip` is a macOS alias stub, not real data — use CyVerse.

- `5_Genotype_Data_All_Years.vcf.zip` — **368 MB zip → 8.6 GB VCF**, git-ignored. VCFv4.0, GT format,
  **~437k SNPs × 4,928 hybrids** (`G2F_2014-2023_Hybrids_437k`, TASSEL hybrid build, B73 contigs 1–10).
  Hybrid-level genotypes named `parent1/parent2` — **1,153 of our 1,198 MET_2019 hybrids match by
  exact name** (the rest are name/parent-order variants). No midparent derivation needed.

Re-download (resumable; the WebDAV endpoint can truncate — verify size = 385,667,072 bytes):
```
curl -L -C - --retry 5 -o data/g2f/raw/5_Genotype_Data_All_Years.vcf.zip \
  "https://data.cyverse.org/dav-anon/iplant/projects/commons_repo/curated/GenomesToFields_GenotypeByEnvironment_PredictionCompetition_2023/Training_data/5_Genotype_Data_All_Years.vcf.zip"
```
Storage model: [ADR-0017](../../docs/adr/0017-genotype-storage-packed-callsets.md) (BrAPI VariantSet/
Variant/Sample/CallSet, packed dosage `bytea` in Postgres).
Column glossary (key fields): Env=location-year · Range/Pass=spatial grid · Replicate/Block=design ·
Hybrid=genotype (Parent1/Parent2) · Yield_Mg_ha=grain yield · plus height, moisture, DAP, lodging traits.

## Combining ability (GCA/SCA) dev path — synthetic inbred fixture (ADR-0019/0020)

MET_2019 is itself a **line × tester** hybrid trial — 614 lines × ~13 testers (2 dominant: LH195, PHT69),
most lines crossed to 2 testers — so it drives combining-ability *modelling* directly (parent identity is in
`Hybrid_Parent1/2`). What G2F **cannot** provide is inbred-*level* data: heterotic **pool**, inbred **per-se**
performance, and **directly-observed native-trait** calls (e.g. an Ht1/NCLB-resistance gene scored on the
inbred). Those drive within-pool ranking, the per-se↔GCA divergence, and the native-trait advancement gate.

So we **synthesize** them — `packages/db` table `inbred_line`, seeded by
`packages/pipeline/src/seed-inbred.ts` (deterministic; no RNG): pool by a line's dominant tester (opposite
heterotic group), per-se correlated ~0.6 with testcross performance (so it diverges from GCA), NCLB
resistance ~38%. **This is scaffolding to wire the engine + UI (ADR-0020); real tomato inbred data replaces
it.** Run: `seed-inbred.ts` then `combining-ability-build.ts` → persists a `combining_ability` bundle the
web tier renders.
