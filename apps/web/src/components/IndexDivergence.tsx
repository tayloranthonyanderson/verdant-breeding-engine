"use client";

// Transparent vs genetically-aware (desired-gains) index — their DIVERGENCE is the insight (ADR-0006):
// where accounting for how traits co-inherit (G) changes which genotypes you'd advance. The scatter
// plots each genotype's rank in each index; off-diagonal points are the disagreements.
import { useMemo } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import {
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { ResultBundle } from "@verdant/contracts";

export default function IndexDivergence({ bundle }: { bundle: ResultBundle }) {
  const transparent = bundle.indices?.find((i) => i.kind === "weighted");
  const genetic = bundle.indices?.find((i) => i.kind === "desired_gains" || i.kind === "smith_hazel");
  const div = bundle.divergence;
  const { points, movers, n } = useMemo(() => {
    if (!transparent || !genetic) return { points: [], movers: [], n: 0 };
    const tRank = new Map(transparent.ranking.map((r) => [r.germplasm_id, r.rank]));
    const gRank = new Map(genetic.ranking.map((r) => [r.germplasm_id, r.rank]));
    const ids = [...tRank.keys()].filter((id) => gRank.has(id));
    const points = ids.map((id) => ({ id, x: tRank.get(id)!, y: gRank.get(id)! }));
    const rawMovers = (div?.notable_movers ?? []).filter(
      (m): m is { germplasm_id: string; rank_delta: number } => m.germplasm_id != null && m.rank_delta != null,
    );
    const moverIds = new Set(rawMovers.map((m) => m.germplasm_id));
    const movers = rawMovers
      .map((m) => ({ id: m.germplasm_id, t: tRank.get(m.germplasm_id)!, g: gRank.get(m.germplasm_id)!, delta: m.rank_delta }))
      .filter((m) => Number.isFinite(m.t) && Number.isFinite(m.g));
    return {
      points: points.map((p) => ({ ...p, mover: moverIds.has(p.id) })),
      movers,
      n: ids.length,
    };
  }, [transparent, genetic, div]);

  if (!transparent || !genetic || !div) return null;
  const rho = div.rank_correlation ?? 0;
  const base = points.filter((p) => !p.mover);
  const hot = points.filter((p) => p.mover);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">
        Transparent vs genetically-aware ranking
      </h3>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
        The transparent index applies your weights to standardized BLUPs, blind to how traits
        co-inherit. The genetically-aware <span className="font-medium text-indigo-600">desired-gains</span>{" "}
        index targets the gains you want (here: yield ↑, moisture ↓) using the genetic covariance{" "}
        <span className="font-mono">G</span>. Where they disagree is where co-inheritance matters.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* rank correlation + scatter */}
        <div className="lg:col-span-3">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="tnum text-2xl font-bold text-slate-900">{rho.toFixed(2)}</span>
            <span className="text-xs text-slate-500">
              rank correlation · {rho > 0.95 ? "near-identical" : rho > 0.7 ? "broad agreement, real movers" : "substantial reshuffle"}
            </span>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 18 }}>
                <XAxis
                  type="number" dataKey="x" name="transparent rank" domain={[1, n]} reversed
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  label={{ value: "transparent rank →", position: "insideBottom", offset: -8, fontSize: 11, fill: "#64748b" }}
                />
                <YAxis
                  type="number" dataKey="y" name="genetically-aware rank" domain={[1, n]} reversed
                  tick={{ fontSize: 10, fill: "#94a3b8" }} width={36}
                  label={{ value: "genetic rank →", angle: -90, position: "insideLeft", fontSize: 11, fill: "#64748b" }}
                />
                <ZAxis range={[10, 10]} />
                <ReferenceLine segment={[{ x: 1, y: 1 }, { x: n, y: n }]} stroke="#cbd5e1" strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  formatter={(v, name) => [v, name]}
                  contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 11 }}
                />
                <Scatter data={base} fill="#cbd5e1" fillOpacity={0.5} />
                <Scatter data={hot} fill="#6366f1" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-slate-400">
            Each dot is a genotype; on the dashed line both indices agree. Indigo dots are the biggest
            movers.
          </p>
        </div>

        {/* notable movers */}
        <div className="lg:col-span-2">
          <h4 className="mb-2 text-xs font-semibold text-slate-600">Biggest movers</h4>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1.5 font-medium">Genotype</th>
                  <th className="px-2 py-1.5 text-right font-medium">Transp.</th>
                  <th className="px-2 py-1.5 text-right font-medium">Genetic</th>
                  <th className="px-2 py-1.5 text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {movers.map((m) => {
                  const up = m.delta > 0; // genetic index ranks it BETTER (smaller rank) than transparent
                  return (
                    <tr key={m.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-2 py-1.5 font-medium text-slate-700">{m.id}</td>
                      <td className="px-2 py-1.5 text-right tnum text-slate-500">#{m.t}</td>
                      <td className="px-2 py-1.5 text-right tnum text-slate-800">#{m.g}</td>
                      <td className={`px-2 py-1.5 text-right tnum font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
                        <span className="inline-flex items-center gap-0.5">
                          {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                          {Math.abs(m.delta)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            <span className="text-emerald-600">↑</span> = the genetically-aware index rates it higher
            than your stated weights do; <span className="text-rose-600">↓</span> = lower. These are
            the lines to look at twice.
          </p>
        </div>
      </div>
    </section>
  );
}
