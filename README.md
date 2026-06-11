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

Foundation slice complete: engine + correctness tests, Postgres backbone, plumber
API, beautiful frontend, embedded AI assistant, Docker artifacts. Roadmap:
persistence-in-UI, trial designer, genomics at scale, mobile capture, image
phenotyping, multi-tenancy/auth. See [ROADMAP.md](ROADMAP.md).
