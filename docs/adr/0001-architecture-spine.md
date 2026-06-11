# ADR-0001 — Architecture spine: R compute kernel + TypeScript web tier + job-queue seam

**Status:** Accepted (2026-06-11)

## Context
Verdant must be "rock-solid, performant, stable" *and* "legible to an R-strong
founder." Those pull against each other on the web tier: R is where the breeding
science and the founder's expertise live, but R is weak at the things a robust web
service needs (concurrency, sessions/auth, structured errors, streaming, ecosystem).
Analysis fits (spatial/MET) take seconds-to-minutes; synchronous HTTP would block
and time out. The AI layer — our differentiator — has its best tooling in TypeScript.

## Decision
Three tiers with one clean seam:
- **R is a stateless *compute kernel*, not a server.** It takes `(data, model spec)`,
  runs the science, returns a **result bundle**. No app state in R. Long-term it is a
  **worker that pulls analysis jobs off a queue**, not an HTTP server.
- **TypeScript owns the entire web tier** — orchestration/API *and* frontend, one
  language, type-safe end to end. Hosts the AI/agent orchestration.
- **A durable job queue is the seam.** Analysis requests enqueue → an R worker runs →
  the result bundle is persisted → the UI subscribes to status. No request ever waits
  on a fit. Start with a **Postgres-backed job table + worker** (no new infra to
  learn); graduate to pg-boss/Redis only if volume demands.
- **Postgres is the single source of truth.** Result bundles are stored whole as JSONB;
  we render and the AI queries the object, rather than SQL-querying individual BLUPs.

## Consequences
- The part the founder owns (R science) stays small, pure, legible, and testable.
- The bulletproof-but-not-his-specialty web/AI tier lives in the language built for it.
- Async/performance is solved structurally, not patched later.
- Cost: two languages. The founder reads the R half fluently, not the TS half — accepted,
  because the whole point of hiring an engineer is that the web tier isn't hand-maintained
  by him.

## Alternatives rejected
- **R/plumber as the real API server** (spike's approach): optimizes founder-legibility at
  the direct expense of the stability/performance pillars and the AI tooling.
- **Porting the science out of R**: throws away the founder's expertise and the breeding
  library ecosystem. Never.
