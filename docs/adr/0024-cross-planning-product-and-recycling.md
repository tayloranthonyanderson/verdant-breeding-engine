# ADR-0024 — Cross planning: two modes (product cross + pool recycling); product cross first

**Status:** Accepted (2026-06-18) — extends ADR-0019/0020 (combining ability) into the FORWARD half of
the breeding cycle. The cross plan is the payoff of the GCA/SCA work: those metrics stop being
*displayed* and become a *generated decision*.

## Context

The pipeline ended at **advancement** — *which of the things I already have do I keep*. That is value
**harvesting**, the tail of one cycle. The decision that *creates* value and *starts the next cycle* is
**crossing**: which matings to make. It is the harder, more expert-dense decision (it compounds — each
cycle's crosses set the ceiling on the next cycle's selection), and it is where "automate the expert"
is worth the most. A demo that stops at advancement shows half a cycle; one that ends in a **cross
plan** closes the loop (trials → analysis → selection → advancement → **crossing** → next nursery) and
moves Verdant from an *analyzer* (a tool the breeder consults) to an *engine* (a tool that drives the
program).

Designing it surfaced that "crossing" is **two different decisions**, and conflating them is the trap:

1. **Product cross** — pool-A inbred × pool-B inbred → the **F1 you sell**. Terminal: you do not select
   within it and it is not a parent. The question is purely *"which cross is most likely to succeed?"*
2. **Recycling cross** — within-pool line × line → the **next generation of inbreds**. Recurrent
   selection in a (semi-)closed population; the question is *"what do I recombine to keep the pool
   productive for the next decade?"*

## Decision

**1. Two crossing modules on the roadmap; build the product cross first.** They share the
combining-ability foundation but optimize different things and must not be merged into one "cross" tool.

**2. The product cross is GCA-based, with NO coancestry / OCS / diversity penalty.** Three reasons,
each decisive on its own:
- The F1 is a **terminal product** — there is no within-cross selection (so the usefulness criterion
  `μ + i·σ` has nothing to act on) and no inbreeding of the product to manage (an across-pool F1 is
  maximally heterozygous by construction).
- The diversity that OCS exists to protect is **already enforced by the heterotic-pool split** —
  crossing A×B *is* the diversity control. A coancestry penalty would re-solve a solved problem and
  muddy the (teaching) narrative.
- For **unmade** crosses, GCA is the *definitionally correct* predictor: SCA is only knowable after a
  specific combination is tested. "GCA-based" is not a shortcut — it is the right forward predictor.

The only product-level "diversity" concern is **portfolio**, not population: don't field many near-
identical hybrids sharing a parent. Handled by an operational **max-uses-per-parent** cap, not a
coancestry optimizer.

**3. OCS / coancestry control belongs to the recycling module (deferred).** There it is the right tool
(Meuwissen/Kinghorn optimal contributions — maximize merit subject to a cap on group coancestry /
inbreeding rate), because over-using elite lines erodes the pool's variance and the very between-pool
divergence that drives heterosis. This maps onto the existing Selection level split: **Hybrids** (the
product cross) vs **Parents · GCA** (the recycling cross).

**4. v1 product cross-planner = a client-side derivation over `combining_ability`.** Like the GCA
lenses (`lib/ca.ts`), the plan is computed live in the browser so the breeder's gates and portfolio
limits recompute instantly — no kernel/pipeline/contract/fixture change.
- Enumerate every **across-pool A×B** from `ca.gca` (per-line per-trait GCA + heterotic pool already
  in the bundle).
- Rank by a **market-weighted, standardized index of combined GCA** (`gca(P1)+gca(P2)` per objective
  trait, the cut's signed weights) — the same transparent index the kernel uses, applied at cross level.
- **Cross-level gates**: a cross *delivers* a required allele if **either** parent carries it (dominant
  resistance fixes in the F1) — the gate semantics shift from *possession* (advancement) to
  *transmission* (crossing).
- **Greedy portfolio** under a per-parent use cap → the recommended plan; the breeder tunes the cap /
  count / gates and can exclude a cross. Deterministic per-cross rationale ("strong Yield", "B covers
  A's Firmness gap", "carries Pto").
- Files: `apps/web/src/lib/cross-plan.ts` (derivation), `apps/web/src/components/CrossPlanner.tsx`
  (the surface), wired as the **Cross** step after Advance in `CutWorkbench` (shown when the cut carries
  a testcross trial, i.e. `combining_ability` is present).

## Considered options

- **OCS / coancestry constraint at the product level — rejected.** See Decision §2: pool structure
  supplies the diversity, the F1 is terminal. It would add cost and opacity for zero product benefit.
- **Usefulness criterion (`μ + i·σ`) at the product level — rejected.** It values within-cross
  variance because you select among progeny; you don't, for a terminal hybrid. It belongs to the
  recycling module (you *do* select among inbred progeny).
- **Absolute predicted trait values (μ + gca + gca) — deferred.** Tangible, but the testcross-trial
  mean bakes in the average tester effect, so the baseline is impure. v1 shows **combined GCA in trait
  units** (an honest deviation above the cross-population mean) + the standardized index. A proper
  reference mean is a later refinement.
- **Compute the plan in the R kernel — rejected for v1.** The plan is deterministic arithmetic over
  already-estimated GCA; doing it client-side makes the gates/portfolio interactive with no round-trip
  and keeps the kernel focused on *estimation*. The kernel is reserved for the future **OCS optimizer**
  (recycling), mirroring the genomic-prediction pattern (explainable engine now, rigorous engine behind
  the same seam later).

## Consequences

- **The Cross step is the cycle-closing surface** and the terminal act of the flagship teaching demo:
  "from last season's trials to next season's cross plan." Verified end-to-end on `advance-proc-hybrid`
  (12 across-pool crosses ranked on the processing index; requiring Pto reshapes the plan so every kept
  cross carries it).
- **Recycling / OCS is the next crossing increment** (a within-pool planner with a gain-vs-coancestry
  optimizer, genomic coancestry from the GRM since tomato has no pedigree).
- **Persisting cross decisions is deferred.** v1 is decision *support* (the plan is advisory, recomputed
  from the bundle, works on saved and ephemeral runs alike). Recording "make these crosses" as a
  first-class decision (a `cross` unit alongside `inbred`/`hybrid` in the advancement log) is a
  follow-up.
- **Fixture refinement noted:** the testcross estimates GCA against a common tester panel, so the two
  pools' GCAs are on one comparable scale (good enough — and a real early-stage practice). A reciprocal
  design (Pool-A lines × Pool-B testers and vice versa) would make GCA pool-specific; recorded as a
  later sim-corpus upgrade, not needed for the product-cross surface.

## Amendment (2026-06-19) — mode 2 BUILT: within-pool recycling (usefulness vs OCS), taught by contrast

The recycling module is now built, as **both methods side by side** — the comparison *is* the teaching
content (the breeder sees OCS trade gain for diversity where greedy usefulness would burn the pool).

- **Kernel** `services/kernel/cross-recycling.R` (target-agnostic: takes breeding values + marker
  dosages). Per pool it computes (1) **usefulness** `U = μ + i·σ`, where the inbred-progeny variance has
  the closed form `σ²ᵢⱼ = ¼ Σₖ aₖ²(Mᵢₖ−Mⱼₖ)²` (marker-effect-weighted parental divergence), greedily
  selected; (2) **OCS** — maximise gain `g'c` s.t. group coancestry `c'Gc` (VanRaden G), swept into a
  gain-vs-coancestry **frontier**; (3) the **contrast**, read off each discrete plan's realized
  contributions: gain, group coancestry, effective parents `1/Σcᵢ²`. Marker effects are trained on the
  **full pool germplasm** (both pools) so the 200 effects — hence σ — are identifiable.
- **Pipeline** `packages/pipeline/src/tomato-recycling.ts` runs the kernel per pool from inbreds.csv +
  markers.csv and attaches `combining_ability.recycling`. **UI**: the Cross step gains a **Product |
  Recycle** mode toggle; Recycle shows the two summary cards, the frontier chart, the divergence
  sentence, and both mating lists (`CrossPlanner.tsx` → `RecyclePlanner`).
- **Corpus prerequisite (built):** the demo contrast only exists if gain and diversity are in tension —
  which needs germplasm where the elite lines are *related*. `sim-corpus.R` now builds each pool from
  **16 founders → 60 line descendants** via within-pool crossing (full/half-sib families) with
  pool-specific allele freqs (heterotic divergence). The funnel (S1–S4) is preserved byte-for-byte (the
  BV machinery was refactored to score appended germplasm on the same architecture without disturbing
  the RNG). Result on a structured pool: usefulness 5.8 effective parents / coancestry 0.21 vs OCS 15.0 /
  0.03 — OCS trades ~24% gain to nearly triple diversity. The product cross still builds (18 lines/pool).
- **σ is modest in a narrow pool (by design):** 16 founders → limited segregating variance, so the
  variance term is a tiebreaker, not the driver — the OCS-vs-usefulness contrast carries the lesson.
- **Still deferred:** interactive operating-point (slide along the frontier — needs per-point
  contributions emitted); the usefulness criterion's transgressive-segregation story is muted here and
  would sharpen on a broader pool; persisting a chosen recycling plan as decisions.
