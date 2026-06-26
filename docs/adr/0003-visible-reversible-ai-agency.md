# ADR-0003 — Visible, Reversible AI Agency (GUI-first, action-capable AI)

**Status:** Accepted (2026-06-11)

## Context
"AI-assisted, easy to chat with" could mean a chat-first app or a GUI-first app with a
pervasive AI. A breeder making selection decisions needs to *see* rankings, *drag* weights,
*scan* biplots — high-bandwidth visual work that pure chat makes slower. But the AI must be
more than a Q&A sidecar to be a real differentiator.

## Decision
- **GUI-first, AI-pervasive.** Rich visual analytical surfaces are primary and fully usable
  on their own. An always-present AI layer is woven through everything: it narrates insight
  unprompted, answers grounded questions, **and can drive the interface itself**.
- **Core tenet — Visible, Reversible AI Agency:** *the AI can pull any lever a human can,
  always in the open, always undoable; it can act, but never in the dark and never
  irreversibly.*
- **MVP mechanism (lightweight, deliberately not gold-plated):** one source of truth for
  *view state* (weights, directions, filters, selected environment); the AI writes to it
  through the **same setters the UI controls use**. "Visible" = the slider visibly moves;
  "reversible" = drag it back / a Reset button. The one discipline we keep: **the AI's tools
  map 1:1 to user actions** even in this lightweight form.
- **MVP scope of AI action:** only the cheap, idempotent view-state of an *already-computed*
  result. The AI does **not** take consequential/destructive actions (running/saving new
  analyses, mutating stored data) in v1.

## Consequences
- The tenet is preserved in spirit at low cost, and the 1:1-tools rule means the formal layer
  (below) can be added later without ripping anything out.
- The "magic" (AI fills in an analysis you watch happen and can roll back) is achievable.

## Deferred (post-MVP)
- Formal unified command layer / event log, action-history/audit panel (user vs AI),
  full undo/redo stack, and AI taking consequential actions.

## Alternatives rejected
- **Chat-first:** fights the "beautiful/fun" pillar (typing "set grain protein weight to 2" is neither)
  and is slower for visual selection work.
- **Full command-bus + audit + undo stack in the MVP:** more ceremony than v1 needs.
