"use client";

// Per-se ↔ GCA divergence (ADR-0020). A line's own performance and its combining ability can disagree —
// a mediocre inbred that throws great hybrids (a hidden gem), or a star inbred that combines poorly (a
// false promise). That disagreement is the insight combining ability exists to surface.
import { useMemo } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { Gem, TriangleAlert } from "lucide-react";
import { fmt, type CombiningAbility } from "@/lib/ca";

export default function PerSeGcaDivergence({ ca }: { ca: CombiningAbility }) {
  const rho = ca.divergence.rank_correlation;
  const movers = ca.divergence.notable_movers;
  // hidden gems: GCA ranks them much BETTER than per-se (rank_delta > 0); false promises: the reverse.
  const gems = movers.filter((m) => m.rank_delta > 0).slice(0, 6);
  const falls = movers.filter((m) => m.rank_delta < 0).slice(0, 6);

  // The full cloud — every line's per-se vs its GCA index — so the weak correlation is visible at a
  // glance, with the notable movers emphasized on top.
  const { cloud, moverSet } = useMemo(() => {
    const score = new Map<string, number>();
    for (const pr of ca.pool_rankings) for (const r of pr.ranking) score.set(r.line, r.score);
    const moverSet = new Set(movers.map((m) => m.line));
    const cloud = ca.gca
      .filter((g) => g.per_se != null && score.has(g.line))
      .map((g) => ({ x: g.per_se as number, y: score.get(g.line)!, line: g.line, pool: g.pool, delta: 0 }));
    return { cloud, moverSet };
  }, [ca, movers]);
  const data = movers.map((m) => ({ x: m.per_se, y: m.gca_score, line: m.line, pool: m.pool, delta: m.rank_delta }));
  const base = cloud.filter((d) => !moverSet.has(d.line));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-700">Per-se vs combining ability</div>
            <div className="text-[11px] text-slate-500">
              rank correlation <b className={rankTone(rho)}>{rho == null ? "–" : rho.toFixed(2)}</b>
              <span className="ml-1 text-slate-400">{weak(rho) ? "— they disagree a lot" : "— broadly aligned"}</span>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">x = inbred per-se · y = GCA index. Off-diagonal lines are where the two disagree.</div>
          <div className="mt-2 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <ReferenceLine x={0} stroke="#cbd5e1" />
                <ReferenceLine y={0} stroke="#cbd5e1" />
                <XAxis type="number" dataKey="x" name="per-se" tick={{ fontSize: 10, fill: "#94a3b8" }}
                  label={{ value: "inbred per-se", position: "bottom", offset: 0, fontSize: 10, fill: "#64748b" }} />
                <YAxis type="number" dataKey="y" name="GCA" tick={{ fontSize: 10, fill: "#94a3b8" }} width={36}
                  label={{ value: "GCA index", angle: -90, position: "insideLeft", fontSize: 10, fill: "#64748b" }} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<Tip />} />
                <Scatter data={base} fill="#cbd5e1" fillOpacity={0.45} />
                <Scatter data={data} fill="#10b981" fillOpacity={0.95} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-3">
          <MoverCard
            title="Hidden gems" tone="emerald" icon={<Gem size={14} />}
            blurb="Modest per-se, strong combiner — you&rsquo;d cull these on looks alone."
            rows={gems}
          />
          <MoverCard
            title="False promises" tone="amber" icon={<TriangleAlert size={14} />}
            blurb="Impressive per-se, poor combiner — flattered by their own performance."
            rows={falls}
          />
        </div>
      </div>
    </div>
  );
}

function MoverCard({ title, tone, icon, blurb, rows }: {
  title: string; tone: "emerald" | "amber"; icon: React.ReactNode; blurb: string;
  rows: Array<{ line: string; pool: string; per_se: number; gca_score: number; rank_delta: number }>;
}) {
  const c = tone === "emerald" ? "text-emerald-700 bg-emerald-50 ring-emerald-200" : "text-amber-700 bg-amber-50 ring-amber-200";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${c}`}>{icon}{title}</div>
      <p className="mt-1.5 text-[11px] text-slate-400">{blurb}</p>
      <ul className="mt-2 space-y-1">
        {rows.map((m) => (
          <li key={m.line} className="flex items-center justify-between text-[12px]">
            <span className="truncate font-medium text-slate-700">{m.line}</span>
            <span className="ml-2 shrink-0 tabular-nums text-slate-400">
              per-se {m.per_se >= 0 ? "+" : ""}{fmt(m.per_se, 1)} · GCA {m.gca_score >= 0 ? "+" : ""}{fmt(m.gca_score, 1)}
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-[11px] text-slate-400">none in the top movers</li>}
      </ul>
    </div>
  );
}

function Tip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { line: string; x: number; y: number; delta: number } }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-md">
      <div className="font-semibold text-slate-800">{p.line}</div>
      <div className="text-slate-500">per-se {fmt(p.x, 2)} · GCA {fmt(p.y, 2)} · moved {p.delta > 0 ? "+" : ""}{p.delta} ranks</div>
    </div>
  );
}

const rankTone = (r: number | null) => (r == null ? "text-slate-400" : r < 0.5 ? "text-amber-600" : "text-slate-700");
const weak = (r: number | null) => r != null && r < 0.6;
