"use client";

// Specific combining ability — the line×tester deviations from the additive (GCA+GCA) expectation.
// Shown only where the data support SCA; positive = the specific cross beats its parents' GCAs. Most
// of combining ability is additive (see Baker's ratio) — SCA is the exception worth chasing.
import { useMemo } from "react";
import { fmt, type CombiningAbility } from "@/lib/ca";

export default function ScaHeatmap({ ca }: { ca: CombiningAbility }) {
  const leadTrait = ca.index_traits[0];
  const baker = ca.traits.find((t) => t.variable_id === leadTrait)?.baker_ratio ?? null;

  const { lines, testers, cell, maxAbs } = useMemo(() => {
    // keep only testers that actually carry crosses (a line×tester panel is dominated by 2 testers;
    // the rare ones would be empty columns), then the top lines by |SCA| among those testers.
    const testerCount = new Map<string, number>();
    for (const s of ca.sca) testerCount.set(s.tester, (testerCount.get(s.tester) ?? 0) + 1);
    const testers = [...testerCount.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const testerOk = new Set(testers);
    const byLineMax = new Map<string, number>();
    const cell = new Map<string, number>();
    for (const s of ca.sca) {
      if (!testerOk.has(s.tester)) continue;
      cell.set(`${s.line}|${s.tester}`, s.value);
      byLineMax.set(s.line, Math.max(byLineMax.get(s.line) ?? 0, Math.abs(s.value)));
    }
    const lines = [...byLineMax.entries()].sort((a, b) => b[1] - a[1]).slice(0, 26).map((e) => e[0]);
    const maxAbs = Math.max(0.01, ...ca.sca.filter((s) => testerOk.has(s.tester)).map((s) => Math.abs(s.value)));
    return { lines, testers, cell, maxAbs };
  }, [ca.sca]);

  if (!ca.topology.sca_included || ca.sca.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        SCA was folded into the residual for this trial — too little cross-replication to separate a specific-cross
        effect from plot error. This is the GCA-only / mid-parent regime (ADR-0020).
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] text-slate-400">
          Top {lines.length} lines by |SCA| on {shortTrait(leadTrait)} × the testers. Green = the cross over-performs its
          parents&rsquo; GCAs; orange = under-performs.
        </p>
        {baker != null && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            Baker&rsquo;s ratio {baker.toFixed(2)} <span className="text-slate-400">· {(baker * 100).toFixed(0)}% of combining ability is additive</span>
          </span>
        )}
      </div>

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white p-3">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th className="sticky left-0 bg-white" />
              {testers.map((t) => (
                <th key={t} className="px-1 pb-1 text-[10px] font-medium text-slate-400" style={{ writingMode: "vertical-rl" }}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l}>
                <td className="sticky left-0 bg-white pr-2 text-right text-[11px] font-medium text-slate-600 whitespace-nowrap">{l}</td>
                {testers.map((t) => {
                  const v = cell.get(`${l}|${t}`);
                  return (
                    <td key={t}>
                      <div
                        title={v == null ? `${l} × ${t}: not crossed` : `${l} × ${t}: SCA ${v >= 0 ? "+" : ""}${fmt(v, 3)}`}
                        className="grid h-6 w-6 place-items-center rounded text-[9px] font-medium"
                        style={cellStyle(v, maxAbs)}
                      >
                        {v == null ? "" : v >= 0 ? "+" : "−"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function cellStyle(v: number | undefined, maxAbs: number): React.CSSProperties {
  if (v == null) return { background: "#f8fafc", color: "transparent" };
  const a = Math.min(1, Math.abs(v) / maxAbs);
  const color = v >= 0 ? `rgba(16,185,129,${0.15 + a * 0.7})` : `rgba(249,115,22,${0.15 + a * 0.7})`;
  return { background: color, color: a > 0.55 ? "white" : "#475569" };
}

function shortTrait(t: string | undefined) {
  if (!t) return "";
  return t.replace("_Mg_ha", "").replace("Grain_", "").replace(/_/g, " ");
}
