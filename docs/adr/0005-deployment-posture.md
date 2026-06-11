# ADR-0005 — Deployment posture: local-first → GCP, single-tenant-capable

**Status:** Accepted (2026-06-11)

## Context
Science-first sequencing (ADR-0010) says prove the moat before paying the SaaS-infra tax.
The founder builds 8–12 hrs/week, has no proprietary trial data yet, and is the first user.
Target cloud is GCP. Enterprise customers may require the app to run inside their own boundary.

## Decision
- **Local-first during the science-validation phase.** Runs on the founder's machine
  (containerized: TS web tier + R worker + queue + Postgres), no auth, no cloud bill. Validate
  on public + simulated data locally.
- **Cloud-ready by construction.** 12-factor, fully containerized, all config in env, no
  localhost assumptions baked in — so local→cloud is a config-and-deploy afternoon, not a refactor.
- **Target GCP primitives:** Cloud Run (stateless TS tier and R worker scale independently),
  Cloud SQL (Postgres). Deploy when there's someone to show (≈ user #2 / first real demo).
- **Single-tenant deployability is a first-class architectural constraint** (the app can run inside
  a customer's own GCP project/VPC) — but **go-to-market leads with multi-tenant SaaS.** Build
  *ready* for single-tenant; don't build the enterprise deployment tooling yet.
- **Auth/tenancy enters exactly when crossing from single-user to user #2** (buy it — Clerk/Auth.js;
  don't hand-roll).

## Consequences
- No infra tax paid before the science is proven.
- "Easy to deploy" (a vision pillar) is served by good containerization regardless of when *we* deploy.
- Data-sovereignty becomes a sellable feature, aligned with the "no employer IP" DNA.
- Cost: single-tenant deployments are higher-touch support — gated behind real enterprise revenue.

## Alternatives rejected
- **Cloud-deployed from day one:** pays the hosting/auth tax before the moat is validated.
- **Pure multi-tenant only (no single-tenant path):** forecloses the data-sensitive enterprise segment
  that our choices make nearly free to keep.
