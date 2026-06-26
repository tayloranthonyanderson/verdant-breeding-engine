# Groundedness evals

The gate for the AI layer: **the assistant may only state numbers that come from the
ResultBundle.** Fabricating a statistic is the one unforgivable failure (ADR-0002 — the AI
explains and narrates; it never computes). This harness exists *before* the AI does, so the
discipline is in place the moment the first grounded answer is wired (MVP-PLAN §5).

## How it works

Each case (`cases/*.json`) is:

```jsonc
{
  "id": "yield-grain protein-tradeoff",
  "bundle": "../../../packages/contracts/v0/examples/single-trial-bundle.example.json",  // relative to cases/
  "question": "Why do the two indices disagree on G1?",
  "must_reference": [-0.74],          // values a correct answer should surface
  "good_answer": "…cites only bundle numbers…",   // grounded exemplar
  "bad_answer":  "…invents -0.31…"                 // fabrication, for the checker's self-test
}
```

The runner (`run.mjs`) does two things:

1. **Self-tests the groundedness checker** on every case: `good_answer` must pass, `bad_answer`
   must be flagged. This proves the gate actually catches fabrication — today, with no AI.
2. **Tests the real answerer when one is wired.** Set `VERDANT_ANSWERER` to a module exporting
   `answer(question, bundle) -> string`; the runner then grounds-checks its output per case.
   Until then it reports `no answerer wired` and only runs the self-tests.

## The groundedness check (v1)

A number in the answer is *grounded* if the same number (to its stated precision) appears in
the bundle. Crude but real: it catches invented statistics, which is the failure that matters.
Known v1 limits — derived quantities (sums, rank deltas), small integers (ranks), and years can
false-flag; tighten with field-level citation as the answerer matures. Track that in the case's
`must_reference` rather than loosening the checker.

## Run

```bash
node evals/groundedness/run.mjs        # or: pnpm test:evals
```
