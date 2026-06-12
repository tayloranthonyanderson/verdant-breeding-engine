# Verdant — Breeding Analytics Platform

An AI-native breeding **management + analysis** platform. The foundation slice:
load a trial → correct mixed-model **BLUPs/BLUEs**, **heritability**, and a live,
re-weightable **selection ranking** → ask an embedded **AI assistant** that can
only answer from the computed results (never fabricated).

Decoupled, professional, scale-ready architecture:

```
Next.js + TypeScript frontend  ──HTTP──▶  plumber API (R)  ──▶  breedeng engine (lme4 / rrBLUP)
   beautiful GUI + AI chat                 + Postgres backbone        BLUPF90/GCTA adapters later
```

See [PRODUCT.md](PRODUCT.md), [ROADMAP.md](ROADMAP.md), and
[docs/analysis-engine-workflow.md](docs/analysis-engine-workflow.md).

## Layout

| Path | Purpose |
|---|---|
| `engine/` | **`breedeng`** R package — `fit_genotype_values()` contract (lme4 + rrBLUP), `analyze_trial()`, selection index, IP-clean simulator, tool-safe AI ops. `testthat` suite proves BLUPs recover true genetic values. |
| `api/` | plumber REST API (`db.R`, `assistant.R`, `plumber.R`, `entrypoint.R`) |
| `db/migrations/` | Postgres schema (programs, trials, observations, results) |
| `frontend/` | Next.js + TypeScript + Tailwind app (analysis UI + AI chat) |
| `infra/` | Dockerfiles + `docker-compose.yml` |
| `scripts/dev.sh` | one-command native dev runner |
| `prototype/` | the original Shiny spike (internal only, not shipped) |

## Run it

**Native (fastest on the dev machine):**

```bash
./scripts/dev.sh          # starts Postgres, the API (:8000), and the frontend (:3000)
```
Open http://localhost:3000 and click **Load demo trial**.

**Portable (Docker):**

```bash
docker compose -f infra/docker-compose.yml up --build
```

Set `ANTHROPIC_API_KEY` (in `.env`, see `.env.example`) to enable the AI chat;
without it the analysis works fully and the assistant reports it isn't configured.

## Tests

```bash
R CMD INSTALL --no-docs engine
Rscript -e 'library(breedeng); testthat::test_dir("engine/tests/testthat")'
```

## Engine strategy

`lme4` for fast, reliable everyday fits; `rrBLUP` two-step for the genomic path
(pass a relationship matrix `K` later for true GBLUP). Heavy/at-scale genomic jobs
route to compiled **BLUPF90/GCTA** behind the same `fit_genotype_values()` contract
— verify commercial licensing before shipping. Deliberately avoiding sommer (scale
crashes), ASReml (cost/support), and INLA-as-core (memory).

## Status

The Phase-1 analysis engine is largely built and validated on the G2F maize MET, and
early genomic work is underway. **Done:** two-stage MET (SpATS spatial de-trending →
multi-trait AI-REML, validated vs lme4 to 3 sig figs); a **deterministic Model Planner**
that gates spatial / genotype-effect / GxE / staging / engine on data readiness and
explains each choice in a UI panel (ADR-0016); **crop-agnostic MET seams** (ADR-0015);
and **genotype storage + ingestion** — 437,214 SNPs × 4,928 hybrids packed into BrAPI
genotyping tables (ADR-0017). **In progress (branch `feat/genomic-prediction`):** genomic
prediction — VanRaden **G** built and validated (PSD, GBLUP h²≈0.20, GEBVs cluster by
family), rrBLUP as the CV engine; native BLUPF90 genomic path, the validation suite,
pedigree **A** / single-step **H** (ssGBLUP), and the genomic UI are next.

Still ahead: persistence-in-UI, trial designer, mobile capture, image phenotyping,
multi-tenancy/auth. See [ROADMAP.md](ROADMAP.md) and [docs/MVP-PLAN.md](docs/MVP-PLAN.md).
