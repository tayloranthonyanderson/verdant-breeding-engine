# ADR-0018 — Breeder model overrides: AI recommends, human confirms, kernel still owns the science

**Status:** Accepted (2026-06-12)

## Context
[ADR-0002](0002-deterministic-science-ai-explains.md) established that the kernel owns model choice and
the AI only explains it; the contract enforces this — *"The web tier MUST NOT send a formula or model
form."* The deterministic Model Planner ([ADR-0016](0016-deterministic-model-planner-and-engine-registry.md))
makes every decision (spatial, staging, GxE, relationship, engine) and records a reason.

That gave the breeder zero agency. Two problems surfaced in use:

1. **No override.** A breeder who disagrees with an included/excluded GxE term, the one- vs two-stage
   choice, the spatial correction, or the relationship matrix has no way to say so. "Trustworthy by
   design" must include the expert being able to overrule the machine — otherwise it is a black box
   with a nicer narration.
2. **A visible disconnect.** `chosen_model.relationship` was hardcoded to `identity` while the genomic
   panel proved genomic-G beats pedigree-A beats identity. The planner's recommendation was never
   informed by the cross-validation evidence the system itself produced.

The product owner's direction: *full override control over every model decision, AI-guided where
possible.* This evolves ADR-0002 — but it must not regress to "the web tier authors a model spec."

## Decision
Add **constrained breeder overrides**. The planner proposes the full Model Plan with a recommendation
+ reasoning (+ cross-validation evidence for relationship); the breeder may override any decision; the
**kernel remains the sole authority** that validates each override against data readiness and may
**refuse** an infeasible one, keeping its recommendation and recording why.

**1. Override intents, not model forms.** The request carries an optional `model_overrides` object
naming the planner's own decision factors (`spatial`, `staging`, `gxe`, `relationship`, `engine`) and
the breeder's preferred value — the same vocabulary the planner emits, never a formula. Absent =
accept every recommendation. This is the *only* relaxation of the ADR-0002 "no model form" rule.

**2. The kernel validates and may refuse.** `make_plan()` resolves each decision as
recommend-then-validate-override against the readiness diagnostics ([ADR-0015](0015-crop-agnostic-met-seams.md)):
spatial=spats needs a row×col grid; gxe=include needs cross-environment connectivity **and**
within-cell replication (and is impossible in a two-stage genotype-main fit); single_stage needs to
fit the equation budget; relationship A/G/H need pedigree/markers; native BLUPF90 genomic is a Phase-2
capability. An infeasible override is **refused**: the planner keeps its recommendation, sets
`feasible:false`, and records `refused_reason`. The science stays in R — the web tier never decides
feasibility.

**3. Visible and reversible.** Every decision records `source` (recommended | overridden),
`recommended` (what the planner would have chosen), `feasible`, and `refused_reason`. The bundle also
carries an `overridable` feasibility map (which values of each axis are currently selectable vs
blocked-with-reason) so the UI greys out impossible choices *before* a re-run. The breeder can always
reset to the recommendation. This is the [ADR-0003](0003-visible-reversible-ai-agency.md) tenet applied
to model choice: the AI proposes, the human disposes, nothing is hidden or irreversible.

**4. Relationship recommendation is evidence-driven.** When marker/pedigree data is present, the
driver runs the cross-validation comparison and passes the per-model predictive-ability summary to the
planner as `evidence`; the recommended relationship becomes the CV winner (with the G>A>identity
ordering tiebreak), and the evidence rides on the decision. This reconciles the disconnect:
`chosen_model.relationship` now equals the model actually fitted, and matches the genomic comparison.

**5. Determinism preserved.** `make_plan()` stays a pure function of `(readiness, intent, relationship,
overrides, evidence)` — CV evidence is computed by the driver and passed in, never inside the planner —
so the ADR-0016 reproducibility property holds.

## Consequences
- The contract gains optional `model_overrides` (request) and per-decision `source`/`recommended`/
  `feasible`/`refused_reason`/`evidence` + a `chosen_model.overridable` map (bundle). Additive; absent
  fields preserve the no-override behavior.
- A synchronous re-run path (Server Action) applies overrides and refreshes the result. The durable job
  queue ([ADR-0001](0001-architecture-spine.md)) remains the production answer; sync is the sanctioned bridge,
  with scope-aware recompute (a relationship-only change re-points GEBVs without refitting variance
  components).
- The breeder gets full control where the data permits, with the kernel as a guardrail that explains
  what it won't fit and why — not a wall, a teacher.
