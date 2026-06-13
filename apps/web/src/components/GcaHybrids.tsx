"use client";

// Hybrids — the cross itself, ranked by observed performance, with the line's GCA shown alongside so
// the breeder sees how much of a hybrid's standing its parent's combining ability explains. Predicting
// UNMADE crosses (mid-parent / SCA) is the next bundle (ADR-0020); this is observed performance.
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { fmt, type CombiningAbility } from "@/lib/ca";
import type { AdvanceFn } from "@/lib/ca";

export default function GcaHybrids({
  ca, advancedKeys, onAdvance, busyKey,
}: { ca: CombiningAbility; advancedKeys: Map<string, string>; onAdvance: AdvanceFn; busyKey: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const yieldTrait = ca.index_traits[0];
  const moistTrait = ca.index_traits[1];
  const rows = useMemo(() => (showAll ? ca.hybrids : ca.hybrids.slice(0, 50)), [ca.hybrids, showAll]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-400">
        Hybrids ranked by <b className="text-slate-600">observed</b> trial performance. The line&rsquo;s GCA beside each
        cross shows how much its parent&rsquo;s combining ability carries it — high-GCA line + ordinary partner is the
        repeatable win.
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Hybrid</th>
                <th className="px-3 py-2 font-medium">Pool</th>
                <th className="px-3 py-2 text-right font-medium">{shortTrait(yieldTrait)} obs</th>
                {moistTrait && <th className="px-3 py-2 text-right font-medium">{shortTrait(moistTrait)} obs</th>}
                <th className="px-3 py-2 text-right font-medium">line GCA</th>
                <th className="px-3 py-2 text-center font-medium">plots</th>
                <th className="px-3 py-2 text-right font-medium">Advance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((h) => {
                const advanced = advancedKeys.get(`hybrid:${h.hybrid}`) === "advance";
                const busy = busyKey === `hybrid:${h.hybrid}`;
                const g = h.line_gca[yieldTrait];
                return (
                  <tr key={h.hybrid} className={advanced ? "bg-emerald-50/60" : "hover:bg-slate-50"}>
                    <td className="px-3 py-1.5 tabular-nums text-slate-400">{h.rank}</td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-slate-800">{h.line}</div>
                      <div className="text-[10px] text-slate-400">× {h.tester}</div>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                        <span className={`h-2 w-2 rounded-full ${h.pool === "A" ? "bg-sky-500" : h.pool === "B" ? "bg-violet-500" : "bg-slate-400"}`} />{h.pool}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-700">{fmt(h.observed[yieldTrait], 1)}</td>
                    {moistTrait && <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{fmt(h.observed[moistTrait], 1)}</td>}
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <span className={g == null ? "text-slate-300" : g > 0.02 ? "text-emerald-600" : g < -0.02 ? "text-orange-500" : "text-slate-400"}>
                        {g == null ? "–" : `${g >= 0 ? "+" : ""}${g.toFixed(3)}`}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums text-slate-400">{h.n_plots}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => onAdvance(h.hybrid, "hybrid", h.pool, "advance")}
                        disabled={busy}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
                          advanced ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {advanced ? <><Check size={11} /> Advanced</> : "Advance"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => setShowAll((s) => !s)} className="w-full border-t border-slate-100 bg-slate-50 py-2 text-xs font-medium text-slate-500 hover:text-slate-700">
          {showAll ? "Show top 50" : `Show all ${ca.hybrids.length} hybrids`}
        </button>
      </div>
    </div>
  );
}

function shortTrait(t: string | undefined) {
  if (!t) return "";
  return t.replace("_Mg_ha", "").replace("Grain_", "").replace(/_/g, " ");
}
