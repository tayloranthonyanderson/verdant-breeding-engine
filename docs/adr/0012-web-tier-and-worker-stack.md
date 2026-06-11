# ADR-0012 — Web-tier & worker stack: pnpm, Drizzle, Rscript-subprocess kernel, graphile-worker behind a JobQueue port

**Status:** Accepted (2026-06-11) · concrete stack choices behind the ADR-0001 spine

## Context
The M0 walking skeleton (ADR-0010) needs concrete technology choices to realize the
architecture spine of ADR-0001 (TS web tier + R compute kernel + Postgres behind a durable job
queue). These are pervasive, expensive-to-reverse decisions. The founder's explicit guidance:
make the *long-term-correct* call now to avoid costly future refactors, since this is a large
application — but do not over-buy infrastructure (ADR-0010 "buy infrastructure, build science";
defer-the-tax). Decisions co-decided with the founder (two accepted directly, two delegated to
the engineer's recommendation).

## Decision
1. **Monorepo via pnpm workspaces.** One repo, strict per-package dependency isolation:
   `apps/` (web), `packages/` (shared, incl. the engine contract), `services/` (R kernel, later
   Python solver), `db/` (migrations). Rationale: the long-term-correct call for a polyglot
   monorepo; migration off the current npm setup is trivial now (one small frontend) and painful
   later. **Turborepo deferred** until build times justify it (defer-the-tax).
2. **Postgres access via Drizzle ORM** in the TS tier. TS-first, SQL-shaped, lightweight, strong
   inferred types, first-class JSONB — which matters because result bundles are stored whole as
   JSONB (ADR-0001). Trivial raw-SQL escape hatch; no hidden query engine.
3. **R kernel invoked as an Rscript subprocess per job.** The worker shells out to `Rscript`,
   passes the analysis request as JSON on stdin, and reads the result bundle as JSON on stdout.
   Truly stateless, crash-isolated, trivial to containerize. R's ~0.5–1 s startup is negligible
   against minute-long spatial/MET fits. Keeps R out of the web-server role (ADR-0001). The
   request/result shapes are the **engine contract** (`packages/contracts`).
4. **Job queue: graphile-worker, behind a thin `JobQueue` port.** graphile-worker is a mature
   Postgres-backed queue (SKIP LOCKED, retries, backoff, cron, low overhead) — Postgres-backed
   first, per ADR-0001. The **refactor insurance is the seam, not the library**: callers depend
   on a small `JobQueue` interface (`enqueue` / `process`), so the implementation can be swapped
   (pg-boss, Redis, Cloud Tasks) at scale without touching enqueue sites.

## Consequences
- The compute seam is uniform: web tier → `JobQueue.enqueue` → worker → `Rscript` subprocess →
  result bundle → Postgres JSONB → UI/AI. The same seam later carries the Python solver service
  (ADR-0011) as a second subprocess worker.
- Polyglot toolchain (pnpm/Node + R, later Python). Bounded by the stateless-worker pattern; each
  service has one job and a JSON contract.
- pnpm migration: the existing `frontend/` (npm) moves under the workspace as `apps/web`; its
  lockfile is regenerated. One-time, while the surface is tiny.
- Drizzle migrations become the source of truth for the relational schema; the conceptual model
  (DOMAIN-MODEL) is implemented incrementally per milestone ("map the territory, lay track where
  we drive").

## Alternatives rejected
- **npm / Bun workspaces** — npm: looser resolution, slower; acceptable but not the long-term call.
  Bun: youngest ecosystem, occasional Next.js/native rough edges — too bleeding-edge for the
  stability bar (ADR-0001).
- **Prisma / Kysely / raw SQL** — Prisma: heavier (separate engine), historically awkward with
  raw SQL and JSONB-heavy access. Kysely/raw: thinner but more boilerplate and a hand-rolled
  migration workflow.
- **Long-running Rserve/plumber, or a pooled R process** — avoids per-job startup but reintroduces
  a stateful R process to supervise/scale and drifts toward "R as server" (ADR-0001). Not worth the
  complexity until startup cost is measured to matter.
- **pg-boss directly / hand-rolled SKIP LOCKED** — pg-boss: fine, named as the natural later swap,
  but heavier than needed today. Hand-rolled: reimplements retries/visibility/observability we'd
  rather not own. Both are reachable through the `JobQueue` port if needed.
