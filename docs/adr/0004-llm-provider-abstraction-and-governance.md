# ADR-0004 — LLM provider abstraction, user model choice & data governance

**Status:** Accepted (2026-06-11)

## Context
The AI is the differentiator, so its model must not be an accidental structural dependency.
The founder wants users to choose their model (cost, capability, familiarity), and target
cloud is GCP with possible Gemini. Enterprises are highly sensitive about data leaving their
walls / being used for training.

## Decision
- **Thin provider-abstraction in the TS tier.** One internal "chat-with-tools" interface;
  the model (Claude, Gemini, others) is *config*, not architecture.
- **Model choice is capability-driven and *measured*.** An eval harness (groundedness, tool-use
  reliability, refusal-on-unknown) picks/qualifies models on *our* tasks, not on host-nativeness.
- **Abstraction is "bring-your-own-endpoint," not just bring-your-own-key.** A tenant can point
  Verdant at a hosted API, Claude/Gemini in their own Vertex/Bedrock project, or a self-hosted
  open-weight container — spanning the full data-governance spectrum.
- **Inference cost: hybrid.** A strong **bundled default** so first-use is delightful with zero
  setup, **plus** model-choice/BYOK for power users and the governance-sensitive. The model menu
  is **eval-gated** — only models that clear a measured trust floor are offered.
- **Per-task routing** is allowed (cheap/fast model for low-stakes column-mapping suggestions,
  strongest model for reasoning/narrative/agentic flows).

## Timing
- The **abstraction** goes in early (cheap, future-proof). The **user-facing model picker + BYOK**
  is a multi-tenant, cloud-phase feature; the local single-user MVP just uses the founder's config.
- The bundled-vs-BYOK *business* decision is settled before cloud launch, not now.

## Consequences
- The differentiator isn't locked to one vendor; switching/mixing is a config change.
- Governance objections ("our data can't leave our walls") are answerable up to full self-hosting.
- Cost: a small abstraction tax over calling one API directly — accepted for optionality.

## Notes
- Factual basis: major commercial APIs (Anthropic, OpenAI, Gemini-on-Vertex) don't train on API
  data by default; Claude runs inside customer AWS/GCP via Bedrock/Vertex; self-hosted open-weight
  is the maximal-control tier. Most enterprises are satisfied below full self-hosting.
