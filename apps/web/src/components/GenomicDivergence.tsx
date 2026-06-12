"use client";

// What the markers TAUGHT us: phenotypic BLUP (from the field trial) vs genomic GEBV (borrowing from
// genotyped relatives) for a trait. Where they disagree is where genomics changed the call — a line
// with a modest own-trial record but strong relatives gets lifted, and vice versa. Same rank-rank
// divergence idiom as the transparent-vs-genetic index (IndexDivergence): the disagreement IS the
// insight, and here it teaches the value of the marker data per genotype.
import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import {
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { ResultBundle } from "@verdant/contracts";

type Genomic = {
  cohort?: string[];
  traits?: string[];
  gebv?: Record<string, { values?: number[]; reliability?: number[] }>;
};

function rank(pairs: Array<{ id: string; v: number }>) {
  const sorted = [...pairs].sort((a, b) => b.v - a.v);
  const r = new Map<string, number>();
  sorted.forEach((p, i) => r.set(p.id, i + 1));
  return r;
}

export default function GenomicDivergence({ bundle }: { bundle: ResultBundle }) {
  const g = bundle.genomic as Genomic | undefined;
  const traits = g?.traits ?? Object.keys(g?.gebv ?? {});
  const [trait, setTrait] = useState(() => (traits.includes("Yield_Mg_ha") ? "Yield_Mg_ha" : traits[0]));

  const data = useMemo(() => {
    if (!g?.cohort || !g.gebv?.[trait]?.values) return null;
    const cohort = g.cohort;
    const gv = g.gebv[trait].values!;
    const genomicVals = cohort.map((id, i) => ({ id, v: gv[i] })).filter((x) => Number.isFinite(x.v));
    // phenotypic BLUP from the field-trial model
    const pt = bundle.traits?.find((t) => t.variable_id === trait);
    const phenoVals = (pt?.effects ?? [])
      .filter((e) => e.value != null)
      .map((e) => ({ id: e.germplasm_id, v: e.value as number }));
    const phenoSet = new Set(phenoVals.map((p) => p.id));
    const common = genomicVals.filter((x) => phenoSet.has(x.id));
    if (common.length < 5) return null;
    const phenoCommon = phenoVals.filter((p) => new Set(common.map((c) => c.id)).has(p.id));
    const gRank = rank(common);
    const pRank = rank(phenoCommon);
    const ids = common.map((c) => c.id);
    const points = ids.map((id) => ({ id, x: pRank.get(id)!, y: gRank.get(id)! }));
    const movers = ids
      .map((id) => ({ id, p: pRank.get(id)!, g: gRank.get(id)!, delta: pRank.get(id)! - gRank.get(id)! }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 10);
    const moverIds = new Set(movers.map((m) => m.id));
    const n = ids.length;
    const rho = pearson(ids.map((id) => pRank.get(id)!), ids.map((id) => gRank.get(id)!));
    return { points: points.map((p) => ({ ...p, mover: moverIds.has(p.id) })), movers, n, rho };
  }, [g, trait, bundle.traits]);

  if (!data) return null;
  const base = data.points.filter((p) => !p.mover);
  const hot = data.points.filter((p) => p.mover);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">What the markers taught us — field BLUP vs genomic GEBV</h3>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
          {traits.map((t) => (
            <button key={t} type="button" onClick={() => setTrait(t)}
              className={`rounded-md px-2 py-1 font-medium transition ${t === trait ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {t.replace(/_Mg_ha$/, "").replace(/_cm$/, "").replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
        Each genotype's rank from its own field trial (phenotypic BLUP) vs its genomic prediction
        (GEBV, which borrows from genotyped relatives). On the dashed line the two agree; the{" "}
        <span className="font-medium text-indigo-600">movers</span> are where the marker data changed
        the call — typically a line with a noisy own-record but informative relatives.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="tnum text-2xl font-bold text-slate-900">{data.rho.toFixed(2)}</span>
            <span className="text-xs text-slate-500">rank correlation · {data.rho > 0.9 ? "small reshuffle" : data.rho > 0.7 ? "real movers" : "substantial reshuffle"}</span>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 18 }}>
                <XAxis type="number" dataKey="x" name="field rank" domain={[1, data.n]} reversed tick={{ fontSize: 10, fill: "#94a3b8" }}
                  label={{ value: "field-trial rank →", position: "insideBottom", offset: -8, fontSize: 11, fill: "#64748b" }} />
                <YAxis type="number" dataKey="y" name="genomic rank" domain={[1, data.n]} reversed width={36} tick={{ fontSize: 10, fill: "#94a3b8" }}
                  label={{ value: "genomic rank →", angle: -90, position: "insideLeft", fontSize: 11, fill: "#64748b" }} />
                <ZAxis range={[10, 10]} />
                <ReferenceLine segment={[{ x: 1, y: 1 }, { x: data.n, y: data.n }]} stroke="#cbd5e1" strokeDasharray="4 4" />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 11 }} />
                <Scatter data={base} fill="#cbd5e1" fillOpacity={0.5} />
                <Scatter data={hot} fill="#6366f1" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="lg:col-span-2">
          <h4 className="mb-2 text-xs font-semibold text-slate-600">Biggest movers</h4>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1.5 font-medium">Genotype</th>
                  <th className="w-12 px-2 py-1.5 text-right font-medium">Field</th>
                  <th className="w-12 px-2 py-1.5 text-right font-medium">Genomic</th>
                  <th className="w-12 px-2 py-1.5 text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {data.movers.map((m) => {
                  const up = m.delta > 0;
                  return (
                    <tr key={m.id} className="border-b border-slate-50 last:border-0">
                      <td className="truncate px-2 py-1.5 font-medium text-slate-700">{m.id}</td>
                      <td className="px-2 py-1.5 text-right tnum text-slate-500">#{m.p}</td>
                      <td className="px-2 py-1.5 text-right tnum text-slate-800">#{m.g}</td>
                      <td className={`px-2 py-1.5 text-right tnum font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
                        <span className="inline-flex items-center gap-0.5">{up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{Math.abs(m.delta)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            <span className="text-emerald-600">↑</span> genomics ranks it higher than its own field
            record; <span className="text-rose-600">↓</span> lower. These are the calls genotyping changed.
          </p>
        </div>
      </div>
    </section>
  );
}

function pearson(x: number[], y: number[]): number {
  const n = x.length; if (n === 0) return 1;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 1;
}
