# ADR-0021 — Data Quality & Model QC: an advisory, two-pass trust layer the breeder disposes

**Status:** Accepted (2026-06-12)

## Context

The engine grew sophisticated downstream (two-stage MET, the deterministic Model Planner,
genomic prediction, combining ability) but the bookend a statistician never skips — *look at
the data, then check the fit* — was never built. [`ROADMAP.md`](../ROADMAP.md)
("Data validation: balance, missingness, outliers, factor-level sanity") is the only unchecked
Phase-1 item, and the per-trait `diagnostics` the fit emits is a stub (`{converged, n_obs,
n_genotypes}`). Today the engine will confidently rank genotypes off a column with a
fat-fingered `9999`, a failed location-year, or a model whose residuals are garbage — and say
nothing. That is the single largest credibility risk against the product promise ("get the
right answer, without a statistician on staff").

A precise distinction makes the gap legible. **Data readiness** (ADR-0016) is *structural* — it
reads `environment / genotype / row / col / rep`, never a trait value, and gates *model choice*.
What was missing is the *value-level* audit (outliers, missingness, distribution, factor
sanity) that gates *trust*, plus the *post-fit* validation that the chosen model actually worked.

## Decision

Build a trust layer with three principles.

1. **Two-pass QC.** Outlier and quality detection runs twice, by design:
   - **Pre-fit (Data Quality)** — a crude-robust pass over the assembled dataset for the
     gross/structural errors that would wreck a fit (impossible / out-of-range values,
     duplicate plot coordinates, near-duplicate genotype names, high missingness, raw robust
     outliers e.g. > 5 MAD, distribution shape). Always runs; present in the bundle even if the
     fit is skipped. Emitted as a new structured **`data_quality`** section.
   - **Post-fit (Model QC)** — the statistically proper pass from the fit itself: studentized /
     deletion residuals, influential observations, residual normality / heteroscedasticity,
     spatial-residual autocorrelation (did the spatial model remove the trend?), variance-
     component / heritability boundary flags, REML convergence detail, reliability / SE
     distribution. Enriches the per-trait **`diagnostics`** from stub to real validation.

   The split is principled, not arbitrary: a true field-trial outlier is best seen in *model
   residuals* (which account for genotype, environment, spatial trend), but the pre-fit pass
   still earns its keep by catching transcription disasters before they corrupt the fit.

2. **Advisory only — the kernel never removes data.** Both passes *report* findings and may
   attach a `suggested_exclusion`; neither ever drops a row. Removal is a **human disposition**
   expressed through a new **`data_overrides`** exclusion overlay — the sibling of
   `model_overrides` (ADR-0018). An exclusion is an *analysis-scoped filter list* (targets:
   environment / observation-unit / germplasm), **never a deletion** of `observation`
   rows; each re-run produces a new immutable `analysis_run`, so "with vs without the dropped
   site" is a comparison, not a destruction. (There is deliberately no *variable*/trait exclusion
   level — which traits enter the analysis is a **selection** decision via the objective's index
   weights, not a data-exclusion overlay.) This is the **sole channel** by which a data choice
   changes the model: dropping a site changes connectivity, which re-plans (ADR-0016) — and only
   because the breeder chose to exclude, never silently.

3. **A flexible disposition policy applied in the web tier.** The breeder picks how much to
   delegate, per analysis: **review-each** (default, max control), **batch-accept** (apply all
   suggestions at once), or **auto-apply** (a standing residual-threshold rule). Two guardrails:
   a **per-trait cap** (max N or X% excluded per trait — a real statistical guardrail against
   heritability inflation from over-pruning, not merely UX) and a tunable **residual threshold**.
   The disposition policy is a self-contained object that turns advisory suggestions into the
   `data_overrides` set; the kernel stays advisory and deterministic. Each `data_overrides` entry
   records `source: manual | batch | auto_policy` for audit.

This keeps the product spine intact: **AI proposes / R owns / human confirms** (ADR-0002/0007)
and **visible, reversible AI agency** (ADR-0003). Auto-apply is breeder-*enabled*, always shown
as an explicit overlay, always reversible — convenience, not invisible agency.

**Sequencing.** This (Thread A) is built first — it runs on data already in the system (G2F),
needs no new database tables, completes the unchecked Phase-1 item, and makes the *existing*
engine outputs trustworthy. The ingestion front door (Thread B: Trait Library, import staging,
unit harmonization, Ingest QC — ADR-0022) is the next thread.

## Considered options

- **Fold everything into `warnings[]` — rejected.** Flat strings can't carry a finding's
  `target` id, and the target is load-bearing: it is what wires a flag to a one-click
  `data_overrides` exclude. `warnings[]` survives for run-level notes.
- **Auto-clean (drop > kσ automatically) — rejected.** Invisible agency, silent science, and it
  destroys the with/without comparison. Auto-apply survives only as a breeder-*chosen*, visible,
  capped, reversible mode.
- **One QC pass — rejected.** Pre-fit-only leaves the best outlier signal (model residuals) on
  the floor; post-fit-only lets transcription garbage corrupt the fit before it can be seen.
- **QC gates/blocks the analysis — rejected.** QC is about trust, not feasibility. It always
  produces a result + findings; the only hard stop is genuine compute infeasibility (too few obs
  to fit), which is a readiness floor, not a QC policy.

## Consequences

- The result bundle grows a `data_quality` section and richer per-trait `diagnostics`; the
  analysis request grows `data_overrides`. Contract change, versioned with the existing v0 work.
- The kernel gains `data-quality.R` (pre-fit) and Model-QC residual diagnostics wired into the
  fit; the web tier gains the disposition policy and the exclude→re-run loop.
- **Breeder profiles are deferred (defer-the-tax).** The disposition policy is kept
  self-contained so it can later be persisted as a profile default without refactor; its tenancy
  shape (per-user view vs shared+subset) is an open Phase-4 question.
- A future reader will find QC that *never removes data on its own* — this ADR is why: it is a
  deliberate spine decision, not a missing feature.
