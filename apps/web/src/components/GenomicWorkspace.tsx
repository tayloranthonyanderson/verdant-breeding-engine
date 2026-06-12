// Genomic prediction workspace — composes the genomic-block panels into one coherent story:
// (1) does it add value? (cross-validated G vs A vs identity), (2) what did markers change?
// (field BLUP vs genomic GEBV divergence), (3) the covariance structure (PCA + GRM heatmap),
// (4) deployment diagnostics (reliability, GRM quality, relationship distribution). Renders only
// when the bundle carries a genomic block.
import type { ResultBundle } from "@verdant/contracts";
import { Dna } from "lucide-react";
import GenomicComparison from "./GenomicComparison";
import GenomicDivergence from "./GenomicDivergence";
import PopulationStructure from "./PopulationStructure";
import GrmHeatmap from "./GrmHeatmap";
import GenomicDiagnostics from "./GenomicDiagnostics";

export default function GenomicWorkspace({ bundle }: { bundle: ResultBundle }) {
  if (!bundle.genomic) return null;
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
          <Dna size={15} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Genomic prediction</h2>
          <p className="text-[11px] text-slate-500">
            Breeding values from the marker relationship matrix — and how much the genotyping is worth.
          </p>
        </div>
      </div>

      <GenomicComparison bundle={bundle} />
      <GenomicDivergence bundle={bundle} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <PopulationStructure bundle={bundle} />
        <GrmHeatmap bundle={bundle} />
      </div>
      <GenomicDiagnostics bundle={bundle} />
    </section>
  );
}
