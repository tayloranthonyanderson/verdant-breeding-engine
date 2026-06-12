"use client";

// Transparent vs genetically-aware (desired-gains) index — their DIVERGENCE is the insight (ADR-0006):
// where accounting for how traits co-inherit (G) changes which genotypes you'd advance. The scatter
// plots each genotype's rank in each index; off-diagonal points are the disagreements.
//
// Used two ways: standalone (reads the persisted bundle) or, in the Compare lens, fed the LIVE
// rankings from both indices so it tracks the sliders.
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

type Ranked = Array<{ germplasm_id: string; rank: number }>;

export default function IndexDivergence({
  bundle,
  transparentRanking,
  geneticRanking,
}: {
  bundle: ResultBundle;
  transparentRanking?: Ranked;
  geneticRanking?: Ranked;
}) {
  const live = !!(transparentRanking?.length && geneticRanking?.length);
  const bundleT = bundle.indices?.find((i) => i.kind === "weighted")?.ranking;
  const bundleG = bundle.indices?.find((i) => i.kind === "desired_gains" || i.kind === "smith_hazel")?.ranking;

  const { points, movers, n, rho } = useMemo(() => {
    const tRanking = live ? transparentRanking! : bundleT;
    const gRanking = live ? geneticRanking! : bundleG;
    if (!tRanking?.length || !gRanking?.length) return { points: [], movers: [], n: 0, rho: 1 };
    const tRank = new Map(tRanking.map((r) => [r.germplasm_id, r.rank]));
    const gRank = new Map(gRanking.map((r) => [r.germplasm_id, r.rank]));
    const ids = [...tRank.keys()].filter((id) => gRank.has(id));
    const pts = ids.map((id) => ({ id, x: tRank.get(id)!, y: gRank.get(id)! }));

    let moverList: Array<{ id: string; t: number; g: number; delta: number }>;
    if (live) {
      moverList = ids
        .map((id) => ({ id, t: tRank.get(id)!, g: gRank.get(id)!, delta: tRank.get(id)! - gRank.get(id)! }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 10);
    } else {
      moverList = (bundle.divergence?.notable_movers ?? [])
        .filter((m): m is { germplasm_id: string; rank_delta: number } => m.germplasm_id != null && m.rank_delta != null)
        .map((m) => ({ id: m.germplasm_id, t: tRank.get(m.germplasm_id)!, g: gRank.get(m.germplasm_id)!, delta: m.rank_delta }))
        .filter((m) => Number.isFinite(m.t) && Number.isFinite(m.g));
    }
    const moverIds = new Set(moverList.map((m) => m.id));
    const r = live ? pearson(ids.map((id) => tRank.get(id)!), ids.map((id) => gRank.get(id)!)) : (bundle.divergence?.rank_correlation ?? 0);
    return { points: pts.map((p) => ({ ...p, mover: moverIds.has(p.id) })), movers: moverList, n: ids.length, rho: r };
  }, [live, transparentRanking, geneticRanking, bundleT, bundleG, bundle.divergence]);

  if (points.length === 0) return null;
  const base = points.filter((p) => !p.mover);
  const hot = points.filter((p) => p.mover);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">Transparent vs genetically-aware ranking</h3>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
        The transparent index applies your weights to standardized BLUPs, blind to how traits
        co-inherit. The genetically-aware <span className="font-medium text-indigo-600">desired-gains</span>{" "}
        index targets the gains you want using the genetic covariance <span className="font-mono">G</span>.
        Where they disagree is where co-inheritance matters.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-5">
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
                <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v, name) => [v, name]} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 11 }} />
                <Scatter data={base} fill="#cbd5e1" fillOpacity={0.5} />
                <Scatter data={hot} fill="#6366f1" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-slate-400">
            Each dot is a genotype; on the dashed line both indices agree. Indigo dots are the biggest movers.
          </p>
        </div>

        <div className="lg:col-span-2">
          <h4 className="mb-2 text-xs font-semibold text-slate-600">Biggest movers</h4>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1.5 font-medium">Genotype</th>
                  <th className="w-12 px-2 py-1.5 text-right font-medium">Transp.</th>
                  <th className="w-12 px-2 py-1.5 text-right font-medium">Genetic</th>
                  <th className="w-12 px-2 py-1.5 text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {movers.map((m) => {
                  const up = m.delta > 0; // genetic index ranks it BETTER (smaller rank) than transparent
                  return (
                    <tr key={m.id} className="border-b border-slate-50 last:border-0">
                      <td className="truncate px-2 py-1.5 font-medium text-slate-700">{m.id}</td>
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

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 1;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 1;
}
