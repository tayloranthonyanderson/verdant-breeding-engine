"use client";

// Selection — one workspace, a LEVEL switch over shared machinery (the architecture's core primitive).
// Hybrids: the cross's own BLUP (the commercial product) — the full interactive index (stated /
// genetically-optimal / compare) plus observed-performance advancement. Parents · GCA: which inbreds to
// recycle — the same lenses pointed at parent GCA, within heterotic pool. Advancement state lives here
// (shared across both levels) so a parent and a hybrid advance through the same recorded decision.
import { useMemo, useState, useTransition } from "react";
import { FlaskConical, Sprout, SlidersHorizontal, TrendingUp, Lock } from "lucide-react";
import type { ResultBundle } from "@verdant/contracts";
import { getCombiningAbility, type AdvanceFn, type AdvancementRow } from "@/lib/ca";
import { recordAdvancement, withdrawAdvancement } from "@/app/actions";
import SelectionWorkspace from "./SelectionWorkspace";
import GcaParentsWorkspace from "./GcaParentsWorkspace";
import GcaHybrids from "./GcaHybrids";

type Level = "hybrids" | "parents";
type HybridView = "index" | "performance";

export default function SelectionSection({
  bundle, analysisRunId, advancements, ephemeral, onEphemeralAdvance, onEphemeralAdvanceMany,
}: { bundle: ResultBundle; analysisRunId: number; advancements: AdvancementRow[]; ephemeral?: boolean;
  onEphemeralAdvance?: AdvanceFn;
  onEphemeralAdvanceMany?: (rows: Array<{ candidate: string; unit: "inbred" | "hybrid"; pool: string | null; disposition: string }>) => void; }) {
  const ca = useMemo(() => getCombiningAbility(bundle), [bundle]);
  const [level, setLevel] = useState<Level>(ca ? "parents" : "hybrids");
  const [hybridView, setHybridView] = useState<HybridView>("index");
  const [, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const advancedKeys = useMemo(
    () => new Map(advancements.map((a) => [`${a.unit}:${a.candidate}`, a.disposition])),
    [advancements],
  );

  const advance: AdvanceFn = (candidate, unit, pool, disposition) => {
    if (ephemeral) { onEphemeralAdvance?.(candidate, unit, pool, disposition); return; } // in-memory until Save
    const key = `${unit}:${candidate}`;
    setBusyKey(key);
    start(async () => {
      if (advancedKeys.get(key) === disposition) await withdrawAdvancement({ analysisRunId, candidate, unit });
      else await recordAdvancement({ analysisRunId, candidates: [{ candidate, unit, pool, disposition }] });
      setBusyKey(null);
    });
  };
  const advanceMany = (rows: Array<{ candidate: string; unit: "inbred" | "hybrid"; pool: string | null; disposition: string }>) => {
    if (ephemeral) { onEphemeralAdvanceMany?.(rows); return; } // in-memory until Save
    setBusyKey("__batch__");
    start(async () => { await recordAdvancement({ analysisRunId, candidates: rows }); setBusyKey(null); });
  };

  return (
    <section className="space-y-4">
      {ephemeral && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <Lock size={14} /> Unsaved run — the lines you advance show in the Advance step but live only in memory; Save it (in the Model step) to persist them.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-700">Selection</h3>
        {ca && (
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <LevelTab active={level === "hybrids"} onClick={() => setLevel("hybrids")} icon={<FlaskConical size={13} />}>Hybrids</LevelTab>
            <LevelTab active={level === "parents"} onClick={() => setLevel("parents")} icon={<Sprout size={13} />}>Parents · GCA</LevelTab>
          </div>
        )}
        <span className="text-[11px] text-slate-400">
          {level === "hybrids" ? "Rank the crosses — the commercial product." : "Rank the inbreds by combining ability — what to recycle, within pool."}
        </span>
      </div>

      {level === "parents" && ca ? (
        <GcaParentsWorkspace bundle={bundle} advancedKeys={advancedKeys} onAdvance={advance} onAdvanceMany={advanceMany} busyKey={busyKey} />
      ) : (
        <div className="space-y-4">
          {ca && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <LevelTab active={hybridView === "index"} onClick={() => setHybridView("index")} icon={<SlidersHorizontal size={13} />}>Selection index</LevelTab>
              <LevelTab active={hybridView === "performance"} onClick={() => setHybridView("performance")} icon={<TrendingUp size={13} />}>Performance &amp; advance</LevelTab>
            </div>
          )}
          {hybridView === "index" || !ca ? (
            <SelectionWorkspace bundle={bundle} />
          ) : (
            <GcaHybrids ca={ca} advancedKeys={advancedKeys} onAdvance={advance} busyKey={busyKey} />
          )}
        </div>
      )}
    </section>
  );
}

function LevelTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${active ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
      {icon}{children}
    </button>
  );
}
