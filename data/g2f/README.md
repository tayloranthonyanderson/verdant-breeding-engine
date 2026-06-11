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
Column glossary (key fields): Env=location-year · Range/Pass=spatial grid · Replicate/Block=design ·
Hybrid=genotype (Parent1/Parent2) · Yield_Mg_ha=grain yield · plus height, moisture, DAP, lodging traits.
