# ADR-0011 — Decision-support: optimization & simulation as an AI-forward layer

**Status:** Accepted (2026-06-11) · post-MVP differentiator, architected-for now

## Context
A commercial breeding program's real objective is **ΔG per dollar** — genetic gain under budget
and operational constraints. Two underserved (emerging) capability areas address it: **optimization**
(linear/integer/heuristic — fast answers to financial/operational scenarios) and **simulation**
(flexible strategy contrasts, but slow). Examples the founder raised: allocating a limited budget
across stages/traits, routing harvesters across environments, scheduling samples to quality labs
under capacity, and optimizing crossing/pollination operations. Incumbents do little here.

## Decision
- **A decision-support layer**, separate from the statistics engine, built as a **Python solver
  service** — a third stateless compute worker behind the job-queue seam (ADR-0001), alongside the
  R stats kernel and the TS web tier. Rationale: the founder writes solvers in Python; Python solvers
  (PuLP, OR-Tools) are operationally more stable in his experience than R solvers. R solvers only if a
  specific one proves stable and worthwhile.
- **Two complementary methods, right tool for the question:**
  - **Optimization** (LP/MILP/heuristic) — fast; for complex financial scenarios and operational
    limits/constraints.
  - **Simulation** — flexible strategy/operational contrasts (incl. AlphaSimR-style breeding-scheme
    simulation); slower, used where optimization can't express the question.
- **Two flavors of optimization, different customers:**
  - **Resource/strategy allocation** (gain-per-dollar: entries × locations × reps per stage, budget
    split across cheap vs expensive traits, parent/cross selection). Plugs into the Stage /
    SelectionCriteria / measurement-cost model. **Beachhead-relevant** (small programs are the most
    budget-constrained).
  - **Operational logistics** (harvester routing, sample-to-lab scheduling under capacity, and
    **crossing/pollination operations**). Classic OR; **most valuable at scale.**
- **Surfaced AI-forward and simple.** The user expresses goals and constraints in plain terms; the AI
  formulates the optimization/simulation, the solver runs, results are transparent and explained.
  Hard requirement: effective, trustworthy, transparent, and **fun/easy** — never an OR interface
  dumped on the user. Same proposes/confirms and Visible-Reversible-Agency tenets (ADR-0002/0003).
  Do not overload the user.

## Sequencing
Post-MVP. Beachhead → **allocation** first; **logistics + crossing/pollination ops** → at-scale/later.
A deep, specialized build (OR + breeding); earned later. The data model carries the operational
entities (Resource, Capacity, Cost, OperationalConstraint, Budget, Plan/Schedule) now —
*mapped, not built* — so it's a slot-fill, not a retrofit (DOMAIN-MODEL §4).

## Consequences
- Polyglot compute (R + Python) behind one queue — consistent with the stateless-worker pattern;
  founder's solver expertise stays legible.
- Risk: a third language. Mitigated by it being a bounded, well-isolated service with one job.

## Alternatives rejected
- **R solvers as default** — stability concerns per the founder's experience.
- **Simulation-only** — too slow for fast financial/operational answers.
- **Exposing raw OR tooling to users** — violates the easy/fun requirement; overloads the user.
