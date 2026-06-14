"use client";

// One Selection workspace with a lens switcher, so only one panel is on screen at a time (less
// overload). Both indices stay mounted and live — their state persists across tabs and both keep
// reporting their ranking, so the Compare lens always has fresh data. For a single-trial bundle
// (no genetic correlations) there's only the transparent index, shown without the switcher chrome.
import { useCallback, useMemo, useState } from "react";
import { SlidersHorizontal, Dna, GitCompareArrows, Target } from "lucide-react";
import type { ResultBundle } from "@verdant/contracts";
import IndexExplorer from "./IndexExplorer";
import DesiredGainsExplorer from "./DesiredGainsExplorer";
import IndexDivergence from "./IndexDivergence";

type Lens = "stated" | "genetic" | "compare";
type Ranked = Array<{ germplasm_id: string; rank: number }>;

export default function SelectionWorkspace({ bundle }: { bundle: ResultBundle }) {
  const hasGenetic =
    !!bundle.genetic_correlations?.matrix?.length &&
    !!bundle.indices?.some((i) => i.kind === "desired_gains");

  // The Segments (target markets) the bundle carries — distinct segment_id on the weighted
  // indices, in bundle order. Each is a TPP applied to the same fit (ADR-0023): switching it re-ranks
  // the same data under that target's objective.
  const segments = useMemo(() => {
    const out: string[] = [];
    for (const i of bundle.indices ?? [])
      if (i.kind === "weighted" && i.segment_id && !out.includes(i.segment_id)) out.push(i.segment_id);
    return out;
  }, [bundle]);

  const [lens, setLens] = useState<Lens>("stated");
  const [segment, setSegment] = useState<string | null>(segments[0] ?? null);
  const [transRanking, setTransRanking] = useState<Ranked>([]);
  const [genRanking, setGenRanking] = useState<Ranked>([]);
  const onTrans = useCallback((r: Ranked) => setTransRanking(r), []);
  const onGen = useCallback((r: Ranked) => setGenRanking(r), []);

  const activeSegment = segment && segments.includes(segment) ? segment : segments[0] ?? null;

  // Single-trial bundle: just the transparent index, no workspace chrome.
  if (!hasGenetic) return <IndexExplorer bundle={bundle} segmentId={activeSegment} />;

  return (
    <section className="space-y-4">
      {/* Target market (Segment) switcher — the outermost scope: same data, different target →
          different ranking. Only shown when the bundle carries more than one Segment. */}
      {segments.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Target size={14} className="text-emerald-600" /> Target market
          </span>
          <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {segments.map((s) => (
              <Tab key={s} active={activeSegment === s} onClick={() => setSegment(s)}>
                {s}
              </Tab>
            ))}
          </div>
          <span className="text-[11px] text-slate-400">Same trial data, ranked for a different market objective.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-700">Selection</h3>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
          <Tab active={lens === "stated"} onClick={() => setLens("stated")} icon={<SlidersHorizontal size={13} />}>
            Stated priorities
          </Tab>
          <Tab active={lens === "genetic"} onClick={() => setLens("genetic")} icon={<Dna size={13} />}>
            Genetically optimal
          </Tab>
          <Tab active={lens === "compare"} onClick={() => setLens("compare")} icon={<GitCompareArrows size={13} />}>
            Compare
          </Tab>
        </div>
        <span className="text-[11px] text-slate-400">
          {lens === "stated" && "Your weights, ignoring how traits co-inherit."}
          {lens === "genetic" && "Desired gains, adjusted for co-inheritance (G)."}
          {lens === "compare" && "Where the two disagree — the insight."}
        </span>
      </div>

      {/* Both stay mounted (state + live ranking preserved); only the active lens is visible. The
          segment key remounts the explorers on a target switch, re-seeding their weights/gains. */}
      <div className={lens === "stated" ? "" : "hidden"}>
        <IndexExplorer key={activeSegment ?? "_"} bundle={bundle} segmentId={activeSegment} onRankingChange={onTrans} />
      </div>
      <div className={lens === "genetic" ? "" : "hidden"}>
        <DesiredGainsExplorer key={activeSegment ?? "_"} bundle={bundle} segmentId={activeSegment} onRankingChange={onGen} />
      </div>
      {lens === "compare" && (
        <IndexDivergence bundle={bundle} segmentId={activeSegment} transparentRanking={transRanking} geneticRanking={genRanking} />
      )}
    </section>
  );
}

function Tab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${
        active ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
