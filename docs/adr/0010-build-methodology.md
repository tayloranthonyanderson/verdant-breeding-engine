# ADR-0010 — Build methodology: science-first sequencing via a tracer bullet

**Status:** Accepted (2026-06-11)

## Context
The vision is a full platform; it's built 8–12 hrs/week by an R-strong author. The riskiest assumption
is not "can we add auth" (bought, low-risk) but **"is the analysis correct, deep, and insightful enough
on real messy data that a discerning breeder abandons their current workflow."** That is the core question and it
is untested. The agreed MVP is ambitious (spatial, layout editor, AI ingestion, dual index, action-capable AI).

## Decision
- **Science-first sequencing.** Prove the analysis on real public + simulated data with the author as the only
  user, *before* paying the deployment-plumbing tax (auth, tenancy). Add infra "just before a second user."
- **Buy infrastructure, build science.** Don't hand-roll auth/queues; pour effort into the engine, the
  validation suite, and AI grounding — the parts that carry the real intellectual weight.
- **Tracer bullet / walking skeleton.** Build the *thinnest version of every station, connected end-to-end
  first*, then thicken. v0.1: one G2F location-year → manual mapping → coordinate-column layout → single-trial
  spatial fit *through the real queue* → result bundle → GUI renders BLUPs + heritability + weighted index → AI
  answers one grounded question. Then thicken each station toward the MVP (AI ingestion, layout editor, MET/GxE,
  Smith–Hazel, action-capable AI).
- **Discipline that makes it safe:** every thin station runs on the *real architecture/seam*, never a shortcut
  around it. We shallow the *features*, never fake the *seam*.
- **Defer-the-tax pattern (recurring):** auth, single-tenant tooling, user-facing model picker, full BrAPI,
  formal AI command/audit layer are all *architected-for now, built later* (see ADR-0003/0004/0005/0007).

## Consequences
- The scary part (TS→queue→R→bundle→render→grounded-AI, deployed) is de-risked in week one.
- A working app exists every week → momentum for a part-time author; science validation can start early.
- Cost: many stations sit visibly shallow for a while — accepted; a working spine beats polished fragments.

## Alternatives rejected
- **Station-by-station (breadth-first):** discovers integration risk last, after months; nothing works
  end-to-end for a demoralizing stretch.
- **Platform-first (auth/tenancy before the science is proven):** hardens infra around an unproven core.
