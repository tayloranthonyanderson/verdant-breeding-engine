# ADR-0008 — Data & validation strategy: three sources, G2F north star, tomato beachhead

**Status:** Accepted (2026-06-11)

## Context
There is **no proprietary phenotype trial data** and the founder's tomato genomic library is
**unpaired with phenotypes**, so it cannot validate genomic prediction on its own. "Validate the moat
on real data" therefore requires a deliberate sourcing strategy. (Genomics features are parked until
a later stage; see ROADMAP/MVP-PLAN.)

## Decision
**Three data sources, three distinct purposes — not one choice:**
1. **Simulator → correctness proof.** Its superpower is *known ground truth*: prove BLUPs recover true
   genetic values (real data never can). Bedrock of the validation suite. Extend it to generate mess on
   purpose (unbalanced, missing, spatial gradients, outliers) to test robustness too. **Keep it
   tomato-flavored** for the founder's gut-check intuition.
2. **Public real datasets → robustness + credibility + demo.** Harden ingestion/validation against real
   mess; power "load a real published trial" credibility. (`agridat`, `statgenSTA/GxE`, `BGLR` wheat.)
3. **Real genotypes + simulated phenotypes → the GS showcase (later).** Simulate a trait architecture over
   a real marker matrix for provable genomic-prediction accuracy; pair with public panels when available.

**Development north-star dataset: Genomes to Fields (G2F), maize.** Public, real, ~55k plots across 68
location-years, with phenotype + genotype + environment + plot/spatial layers. The engine is crop-agnostic,
so its job — stress-test the architecture/data model on real breeding-program complexity — is crop-independent.
- **Tomato remains the product beachhead / marketing story;** the tomato demo set (founder's genomes + a
  sourced/assembled phenotype set) is built later, with genomics.
- **The dataset is complete; the build *thread* stays incremental** (tracer bullet, ADR-0010): v0.1 ingests
  one G2F location-year (single real trial + spatial); the genomic columns being *present* forces the data
  model to accommodate markers from day one, but GS *features* come later.

## Consequences
- Correctness is provable (simulator) *and* robustness is real-world (G2F/public).
- Near-term moat is correctness + UX + AI, not data — consistent with PRODUCT.md.
- Cost: developing on maize while selling tomato loses some daily domain intuition — mitigated by the
  tomato-flavored simulator.

## Open detail
- Confirm G2F plot-spatial columns (range/pass/row/col) on first ingestion; pick a location-year with clean
  coordinates if some years are thin.
