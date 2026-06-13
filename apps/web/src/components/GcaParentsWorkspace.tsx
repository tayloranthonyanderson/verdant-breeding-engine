"use client";

// Parents · GCA — the "Parents" selection LEVEL (ADR-0020). One pool selector + a LENS switch mirroring
// the hybrid Selection workspace: Stated priorities (interactive within-pool GCA index), Genetically
// optimal (desired-gains on the GCA genetic covariance — the existing DesiredGainsExplorer fed a
// per-pool GCA bundle), and Compare (where the two disagree, plus the per-se↔GCA divergence). Same
// machinery as hybrids, pointed at parent GCA.
import { useMemo, useState } from "react";
import { SlidersHorizontal, Dna, GitCompareArrows, Grid3x3 } from "lucide-react";
import { getCombiningAbility, gcaBundleForPool, statedRankingForPool, geneticRankingForPool, gatedSet, type CombiningAbility, type MarkerGates, type AdvanceFn } from "@/lib/ca";
import type { ResultBundle } from "@verdant/contracts";
import GcaParents from "./GcaParents";
import GcaGates from "./GcaGates";
import DesiredGainsExplorer from "./DesiredGainsExplorer";
import IndexDivergence from "./IndexDivergence";
import PerSeGcaDivergence from "./PerSeGcaDivergence";
import ScaHeatmap from "./ScaHeatmap";

const POOL_COLOR: Record<string, string> = { A: "#0ea5e9", B: "#8b5cf6" };
type Lens = "stated" | "genetic" | "compare" | "sca";

export default function GcaParentsWorkspace({
  bundle, advancedKeys, onAdvance, onAdvanceMany, busyKey,
}: {
  bundle: ResultBundle;
  advancedKeys: Map<string, string>;
  onAdvance: AdvanceFn;
  onAdvanceMany: (rows: Array<{ candidate: string; unit: "inbred" | "hybrid"; pool: string | null; disposition: string }>) => void;
  busyKey: string | null;
}) {
  const ca = useMemo(() => getCombiningAbility(bundle), [bundle]);
  const pools = ca?.topology.pools.map((p) => p.pool) ?? [];
  const [pool, setPool] = useState(pools[0] ?? "A");
  const [lens, setLens] = useState<Lens>("stated");
  const [gates, setGates] = useState<MarkerGates>({});
  const gated = useMemo(() => (ca ? gatedSet(ca, gates) : new Set<string>()), [ca, gates]);
  if (!ca) return null;

  const lenses: Array<{ id: Lens; label: string; icon: React.ReactNode; hint: string }> = [
    { id: "stated", label: "Stated priorities", icon: <SlidersHorizontal size={13} />, hint: "Your weights on standardized GCA, within pool." },
    { id: "genetic", label: "Genetically optimal", icon: <Dna size={13} />, hint: "Desired gains, adjusted for how GCA co-inherits (G)." },
    { id: "compare", label: "Compare", icon: <GitCompareArrows size={13} />, hint: "Where the two disagree — and per-se vs GCA." },
    { id: "sca", label: "Specific combinations", icon: <Grid3x3 size={13} />, hint: "Line×tester SCA, where estimable." },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* pool selector (shared across lenses) */}
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
          {pools.map((p) => (
            <button key={p} type="button" onClick={() => setPool(p)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${pool === p ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: POOL_COLOR[p] ?? "#64748b" }} /> Pool {p}
            </button>
          ))}
        </div>
        {/* lens switch */}
        <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
          {lenses.map((l) => (
            <button key={l.id} type="button" onClick={() => setLens(l.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${lens === l.id ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {l.icon}{l.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-400">{lenses.find((l) => l.id === lens)?.hint}</span>
      </div>

      {/* marker gates — shared across lenses (cull first, then rank survivors) */}
      {lens !== "sca" && <GcaGates ca={ca} pool={pool} gates={gates} onChange={setGates} />}

      {lens === "stated" && <GcaParents ca={ca} pool={pool} gatedLines={gated} advancedKeys={advancedKeys} onAdvance={onAdvance} onAdvanceMany={onAdvanceMany} busyKey={busyKey} />}
      {lens === "genetic" && <DesiredGainsExplorer bundle={gcaBundleForPool(ca, pool, gated)} />}
      {lens === "compare" && <CompareLens ca={ca} pool={pool} gated={gated} />}
      {lens === "sca" && <ScaHeatmap ca={ca} />}
    </div>
  );
}

function CompareLens({ ca, pool, gated }: { ca: CombiningAbility; pool: string; gated: Set<string> }) {
  const stated = useMemo(() => statedRankingForPool(ca, pool, gated), [ca, pool, gated]);
  const genetic = useMemo(() => geneticRankingForPool(ca, pool, undefined, gated), [ca, pool, gated]);
  return (
    <div className="space-y-4">
      <IndexDivergence bundle={gcaBundleForPool(ca, pool, gated)} transparentRanking={stated} geneticRanking={genetic} />
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-700">Per-se vs combining ability</h4>
        <PerSeGcaDivergence ca={ca} />
      </div>
    </div>
  );
}
