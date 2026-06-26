# ADR-0005 — Deployment posture: local-first → GCP, single-tenant-capable

**Status:** Accepted (2026-06-11)

## Context
Science-first sequencing (ADR-0010) says validate the engine before adding infrastructure
complexity. It's built part-time, there's no proprietary trial data, and the author is the
first user. Target cloud is GCP. Some users may want to run the app inside their own
environment.

## Decision
- **Local-first during the science-validation phase.** Runs on the author's machine
  (containerized: TS web tier + R worker + queue + Postgres), no auth, no cloud bill. Validate
  on public + simulated data locally.
- **Cloud-ready by construction.** 12-factor, fully containerized, all config in env, no
  localhost assumptions baked in — so local→cloud is a config-and-deploy afternoon, not a refactor.
- **Target GCP primitives:** Cloud Run (stateless TS tier and R worker scale independently),
  Cloud SQL (Postgres). Deploy when there's someone to show (≈ a first real demo).
- **Single-tenant deployability is a first-class architectural constraint** (the app can run inside
  a user's own GCP project/VPC). Build *ready* for single-tenant; don't build the deployment tooling yet.
- **Auth/tenancy enters exactly when crossing from single-user to a second user** (buy it —
  Clerk/Auth.js; don't hand-roll).

## Consequences
- No infrastructure complexity paid before the science is proven.
- "Easy to deploy" (a vision pillar) is served by good containerization regardless of when it deploys.
- Data-sovereignty falls out naturally, aligned with the "public + self-funded data only" constraint.
- Cost: single-tenant deployments are higher-touch support — deferred until actually needed.

## Alternatives rejected
- **Cloud-deployed from day one:** pays the hosting/auth cost before the engine is validated.
- **Pure multi-tenant only (no single-tenant path):** forecloses the data-sensitive use case
  that the design makes nearly free to keep.
