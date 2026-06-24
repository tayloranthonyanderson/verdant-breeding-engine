# ADR-0025 — The tomato corpus is HYBRID-ONLY: every trial is an F1 testcross; GCA comes off any cut

**Status:** Accepted (2026-06-20) — corrects a modelling error in the tomato corpus and supersedes the
"single testcross trial" shape from ADR-0019/0020/0024. Tomato is an F1 crop; the corpus now reflects
that everywhere, which is what makes the per-se→testcross→GCA→cross flow continuous instead of siloed.

## Context

The G2F (maize) corpus is **all hybrid**: every MET plot is an F1 with known `parent1`/`parent2`, so
GCA/SCA decompose straight off the trial. When the tomato corpus was built it diverged — the funnel
(`S1`–`S4`: Observation, PYT, the Brix/Firmness AYTs, Fresh) was modelled as **per-se line trials**
(`TOM-####` grown as themselves), and only a *single* trial (`S3-2024-TXH`, a `Proc-Hybrid` node) was a
hybrid testcross, on a **disjoint** germplasm set (the `PLA`/`PLB` heterotic pools, zero overlap with the
funnel lines).

That produced three problems the breeder caught:

1. **A node that wasn't like the others.** The market tree showed `Proc-Brix`, `Proc-Firmness`, and
   `Proc-Hybrid` side by side, but the first two were per-se line trials and the third was the only
   hybrid trial — conceptually incoherent in one picker.
2. **A broken hand-off.** "Select per-se → testcross winners → read GCA → plan crosses" is the real
   recurrent-hybrid flow, but the corpus had the line program and the hybrid program as **disconnected
   datasets** (disjoint germplasm), so a per-se cut could not feed combining-ability at all.
3. **Wrong crop biology.** Tomato (fresh especially) is sold as F1 hybrids; modelling the program as
   per-se inbred development was the wrong default.

## Decision

**1. Every trial is an F1 testcross.** The whole funnel — both TPEs (Processing arid-CA, Fresh-East
humid) — is now candidate inbreds (drawn from the two heterotic pools) **crossed to a small set of
common testers** and grown as F1 hybrids with known parentage. `sim_tc()` replaces the per-se
`sim_trial()`; there are no per-se line trials.

**2. No separate "testcross" entity.** The `Proc-Hybrid` market node and the standalone `S3-2024-TXH`
trial are **deleted**. Combining ability is no longer a special trial you compose *in* — it is a facet of
**whatever cut you compose**, because every cut is hybrid (`cutHasCrosses` is true everywhere). The
crossing module reads GCA off the current cut. Market tree is now just
`All > Processing > {Proc-Brix, Proc-Firmness}` and `All > Fresh-East > East`.

**3. Per-se merit becomes a PARENT ATTRIBUTE, per TPE.** A parent's own merit survives in `inbreds.csv`
as `per_se` (processing) + `per_se_fresh` (fresh) so the **per-se↔GCA divergence** stays teachable — it
just moves from "a trial" to "a fact about the parent," which is more honest (per-se merit ≠ combining
ability is the whole point). The CA build reads the column matching the cut's TPE.

**4. Sparse design on purpose → hybrid prediction has a target.** Each candidate sits in only ~3 crosses
(to the common testers), so the **elite×elite product hybrids stay UNMADE**. Those un-tested A×B cells
are exactly what GCA predicts forward: the product cross-planner (ADR-0024) ranks unmade A×B from
`gca(A)+gca(B)`. "Feed GCA to hybrid prediction" is now structural, not aspirational.

**5. Pool-balanced selection.** A hybrid program maintains *both* heterotic pools in parallel (you need
both to make A×B), so the funnel advances the best `n/2` candidates from **each** pool at every stage
(`select_top_bal`). Without this the stronger pool dominated the late cuts (an `A:15 B:1` advancement
cut) and across-pool product crosses became impossible from a narrow cut. Every cut now carries both
pools (predictions `A:36 B:36`, advancements `A:8 B:8` / `A:7 B:7`).

**6. Connectivity is the common testers, not check lines.** A staged hybrid MET is glued by the testers
(every cross shares them) plus the surviving candidates' testcrosses recurring across stages — so the
`CHK-` check lines are gone and the composition metric is `n_testers`, not `n_checks`.

## Considered options

- **Keep per-se early stages, hybrids only late — rejected.** Realistic for some programs, but the
  breeder's call was unambiguous ("all tomato is F1") and a uniform hybrid corpus is what dissolves the
  per-se↔hybrid silo. Per-se is preserved where it belongs: as a parent attribute.
- **Make the testcross germplasm a subset of a still-per-se line program — rejected.** Reconnects the
  hand-off but leaves the corpus half per-se, half hybrid — the same incoherent picker, just wired
  together. Going fully hybrid is simpler and correct.
- **Full A×B factorial instead of line×tester — deferred.** A reciprocal/factorial design makes GCA
  pool-specific and richer, but line×tester to common testers is the standard early-stage practice, the
  kernel already detects it, and it keeps GCA on one comparable scale. Recorded as a later upgrade
  (carried over from ADR-0024's fixture note).

## Consequences

- **The flagship flow is now one continuous story:** compose a cut (Brix, Firmness, or both) → the
  engine estimates GCA/SCA off that cut → the Cross step plans the next crosses. No node "isn't like the
  others."
- **Blast radius was small.** The cut assembler already threaded `parent1`/`parent2` generically; the
  CA driver already keyed off "does the cut carry crosses." The work was concentrated in
  `services/kernel/sim-corpus.R`; downstream changes were the `Proc-Hybrid` node removal, the
  `n_checks→n_testers` rename, `per_se_fresh`, and retiring the now-dead "add a testcross" affordance in
  `CrossPlanner`/`CutWorkbench` (every cut is hybrid, so the empty-state is only the genuinely-thin case).
- **The genomic forward path is the next increment:** train GCA on the testcrossed candidates and
  **predict GCA from markers** for un-testcrossed lines, so a per-se selection can feed hybrid prediction
  without field-crossing everything. The pieces exist (GBLUP, the marker panel); wiring it as that flow
  is deferred.
- **Persisted bundles must be re-fit** after this corpus change (the old per-se bundles are stale); the
  canonical cuts were re-run against the new data.
