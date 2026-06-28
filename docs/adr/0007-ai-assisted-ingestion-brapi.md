# ADR-0007 — AI-assisted ingestion with human confirmation; BrAPI-aligned data model

**Status:** Accepted (2026-06-11)

## Context
Real phenotype data arrives from many people in many formats (heterogeneous field books, trait
abbreviations, mixed units, serpentine plot numbering). Ingestion is the first thing a breeder does
and the biggest first-impression UX risk. Separately, a mature industry-standard breeding data model
already exists (BrAPI), adopted by Breedbase, Phenome, CGIAR, and the field-capture apps.

## Decision
- **AI-assisted ingestion (the smart default), with mandatory human confirmation before anything is
  committed.** The AI inspects the upload, *proposes* the column→role mapping (genotype, env, rep/block,
  row/col, trait…), detects the likely design, and flags problems; the breeder confirms or corrects in a
  mapping UI before ingestion completes. This is *safe* AI use — a suggestion a human ratifies, fully
  visible and reversible (consistent with ADR-0002/0003) — and it never touches the trust-critical science.
- **A flexible column-mapping UI is the floor** (the correction surface); the AI just pre-fills it so the
  common case is "glance, confirm, go." Pair with a plain-language validation report (balance, missingness,
  outliers, factor sanity, design detection).
- **Align the data model to BrAPI concepts and naming now** (germplasm, study/trial, observation unit,
  trait dictionary, pedigree). **Implement actual BrAPI import/endpoints later**, when interoperability is a
  customer need — same "build-ready, defer-the-tax" discipline. BrAPI import (from Breedbase / Field Book /
  Phenome) directly attacks the ingestion risk and lowers switching cost.

## Consequences
- The first experience feels like the software already understands the breeder's trial.
- We inherit a proven domain model instead of reinventing it, and gain a future interoperability
  advantage.
- Risk: a confidently-wrong AI mapping the user rubber-stamps could corrupt an analysis. Mitigations: the AI
  shows per-column confidence/reasoning; validation catches structural nonsense; nothing runs until confirmed.

## Alternatives rejected
- **Strict template** (user reshapes data to our columns): real field books never match a template.
- **Plain manual mapping, no AI:** misses the clearest place AI removes real toil.
- **Full BrAPI conformance in the MVP:** BrAPI v2 is rich; full conformance would bloat v1.
