"use client";

// Parents · GCA — the headline combining-ability view (ADR-0020). Within-POOL ranking of inbreds by an
// INTERACTIVE multi-trait GCA index: the breeder sets each trait's mode + weight and the ranking, the
// per-trait contribution chart, and the scatter recompute live in the browser from the GCA BLUPs in the
// bundle — exactly like the hybrid IndexExplorer, but standardized WITHIN each pool (so a stronger pool
// can't crowd the other) and gateable on the directly-observed native trait. The displayed GCA is the
// shrunken BLUP (shrinkage baked in); cross-degree (times tested) is a separate visual signal.
import { useMemo, useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
  BarChart, Bar, Legend,
} from "recharts";
import { Check, ArrowUp, ArrowDown, Crosshair } from "lucide-react";
import { fmt, type CombiningAbility, type CaGca, type CaLocus, type AdvanceFn } from "@/lib/ca";

const POOL_COLOR: Record<string, string> = { A: "#0ea5e9", B: "#8b5cf6" };
const TRAIT_COLORS = ["#10b981", "#6366f1", "#f59e0b", "#0ea5e9", "#f43f5e"];
type Mode = "max" | "min" | "target";

export default function GcaParents({
  ca, pool, gatedLines, advancedKeys, onAdvance, onAdvanceMany, busyKey,
}: {
  ca: CombiningAbility;
  pool: string;
  gatedLines: Set<string>;
  advancedKeys: Map<string, string>;
  onAdvance: AdvanceFn;
  onAdvanceMany: (rows: Array<{ candidate: string; unit: "inbred" | "hybrid"; pool: string | null; disposition: string }>) => void;
  busyKey: string | null;
}) {
  const traits = ca.index_traits;
  const catalog = ca.loci_catalog ?? [];
  const [showAll, setShowAll] = useState(false);

  // --- interactive index controls (weights to 100%, mode per trait) -------------------------------
  const seed = useMemo(() => {
    // seed from the bundle's first index weights_used, else yield-max / moisture-min.
    const w: Record<string, number> = {}; const m: Record<string, Mode> = {};
    traits.forEach((t, i) => { w[t] = i === 0 ? 70 : 30; m[t] = /moist/i.test(t) ? "min" : "max"; });
    return { w, m };
  }, [traits]);
  const [weights, setWeights] = useState<Record<string, number>>(seed.w);
  const [modes, setModes] = useState<Record<string, Mode>>(seed.m);

  function reweight(id: string, value: number) {
    setWeights((prev) => {
      const v = Math.max(0, Math.min(100, value));
      const others = traits.filter((t) => t !== id);
      if (!others.length) return { [id]: 100 };
      const otherSum = others.reduce((a, t) => a + (prev[t] ?? 0), 0);
      const next: Record<string, number> = { [id]: v };
      for (const t of others) next[t] = otherSum > 0 ? ((prev[t] ?? 0) / otherSum) * (100 - v) : (100 - v) / others.length;
      return next;
    });
  }
  const cycleMode = (id: string) => setModes((m) => ({ ...m, [id]: m[id] === "max" ? "min" : m[id] === "min" ? "target" : "max" }));
  const totalW = traits.reduce((a, t) => a + (weights[t] ?? 0), 0) || 1;
  const displayPct = useMemo(() => roundTo100(weights, traits), [weights, traits]);

  // --- live within-pool ranking from GCA BLUPs ----------------------------------------------------
  const members = useMemo(() => ca.gca.filter((g) => g.pool === pool), [ca.gca, pool]);
  const ranking = useMemo(() => {
    // per-trait stats WITHIN this pool (empirical sd, n-1) → unit-variance z, matching the kernel.
    const stat: Record<string, { mean: number; sd: number }> = {};
    for (const t of traits) {
      const vals = members.map((g) => g.values[t]).filter((v): v is number => v != null);
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / ((vals.length - 1) || 1)) || 1;
      stat[t] = { mean, sd };
    }
    // merit per trait → normalize the merit column → weighted contribution (parts sum to score).
    const meritNorm: Record<string, { mean: number; sd: number }> = {};
    const merit: Record<string, Map<string, number>> = {};
    for (const t of traits) {
      const mm = new Map<string, number>(); const vals: number[] = [];
      for (const g of members) {
        const z = ((g.values[t] ?? stat[t].mean) - stat[t].mean) / stat[t].sd;
        const me = modes[t] === "min" ? -z : modes[t] === "target" ? -(z * z) : z;
        mm.set(g.line, me); vals.push(me);
      }
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / ((vals.length - 1) || 1)) || 1;
      merit[t] = mm; meritNorm[t] = { mean, sd };
    }
    return members
      .map((g) => {
        const parts: Record<string, number> = {}; let s = 0;
        for (const t of traits) {
          const mn = ((merit[t].get(g.line) ?? 0) - meritNorm[t].mean) / meritNorm[t].sd;
          const c = (mn * (weights[t] ?? 0)) / totalW; parts[t] = c; s += c;
        }
        const gated = gatedLines.has(g.line);
        return { g, score: s, parts, gated };
      })
      .sort((a, b) => a.score - b.score === 0 ? 0 : b.score - a.score)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [members, traits, modes, weights, totalW, gatedLines]);

  const survivors = ranking.filter((r) => !r.gated);
  const maxAbs = Math.max(0.01, ...ranking.map((r) => Math.abs(r.score)));
  const shown = showAll ? ranking : ranking.slice(0, 60);
  const yieldTrait = traits[0]; const moistTrait = traits[1];

  const scatterData = ranking.map((r) => ({
    x: r.g.values[yieldTrait] ?? 0, y: moistTrait ? r.g.values[moistTrait] ?? 0 : 0,
    z: r.g.cross_degree.n_plots, line: r.g.line, gated: r.gated,
    advanced: advancedKeys.get(`inbred:${r.g.line}`) === "advance",
  }));
  const chartData = ranking.filter((r) => !r.gated).slice(0, 14).map((r) => ({ name: r.g.line, ...r.parts }));

  const advanceTop10 = () =>
    onAdvanceMany(survivors.slice(0, 10).map((r) => ({ candidate: r.g.line, unit: "inbred" as const, pool, disposition: "advance" })));

  return (
    <div className="space-y-4">
      {/* controls row */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] text-slate-400">Ranked within pool — pools scored independently. Gated lines (struck through) fail the marker gates above.</span>
        <button type="button" onClick={advanceTop10} disabled={busyKey === "__batch__"}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50">
          <Check size={13} /> Advance top 10 (passing gate)
        </button>
      </div>

      {/* index weights — interactive */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">GCA index weights</h3>
          <span className="text-[11px] text-slate-400">click the icon to change goal · drag to re-rank · live</span>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {traits.map((t) => (
            <div key={t}>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <ModeButton mode={modes[t]} onClick={() => cycleMode(t)} />
                  <span className="font-medium text-slate-700">{shortTrait(t)}</span>
                </div>
                <span className="font-semibold tabular-nums text-slate-900">{displayPct[t] ?? 0}%</span>
              </div>
              <input type="range" min={0} max={100} value={weights[t] ?? 0} onChange={(e) => reweight(t, Number(e.target.value))}
                className="mt-1.5 w-full accent-emerald-600" />
            </div>
          ))}
        </div>
        <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-400">
          Weights normalize to 100% — an alignment device. GCA BLUPs are fixed by the model; only the weighting and
          the per-trait goal (higher / lower / target) are yours. Standardized <b>within pool</b> so the score is
          comparable across the lines you&rsquo;re actually choosing between.
        </p>
      </div>

      {/* contribution chart — visualizes the effect of the weights */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Top of the GCA index · pool {pool}</h3>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" stackOffset="sign" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10, fill: "#64748b" }} interval={0} />
              <ReferenceLine x={0} stroke="#cbd5e1" />
              <Tooltip cursor={{ fill: "#f1f5f9" }} content={<ContribTip />} />
              <Legend verticalAlign="top" height={22} iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              {traits.map((t, i) => <Bar key={t} dataKey={t} stackId="idx" fill={TRAIT_COLORS[i % TRAIT_COLORS.length]} name={shortTrait(t)} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Each bar splits a line&rsquo;s GCA index into per-trait contributions — drag a weight above and watch the bars (and the ranking) move.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* ranking table (live) */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Line</th>
                  <th className="px-3 py-2 font-medium">GCA index</th>
                  <th className="px-3 py-2 text-right font-medium">{shortTrait(yieldTrait)}</th>
                  {moistTrait && <th className="px-3 py-2 text-right font-medium">{shortTrait(moistTrait)}</th>}
                  <th className="px-3 py-2 text-center font-medium">Tested</th>
                  <th className="px-3 py-2 text-center font-medium">Markers</th>
                  <th className="px-3 py-2 text-right font-medium">Advance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => {
                  const advanced = advancedKeys.get(`inbred:${r.g.line}`) === "advance";
                  const busy = busyKey === `inbred:${r.g.line}`;
                  return (
                    <tr key={r.g.line} className={`${r.gated ? "bg-slate-50/60 text-slate-400" : advanced ? "bg-emerald-50/60" : "hover:bg-slate-50"}`}>
                      <td className="px-3 py-1.5 tabular-nums text-slate-400">{r.rank}</td>
                      <td className="px-3 py-1.5">
                        <span className={`font-medium ${r.gated ? "text-slate-400 line-through decoration-slate-300" : "text-slate-800"}`}>{r.g.line}</span>
                        {r.gated && <span className="ml-1.5 rounded bg-rose-100 px-1 py-0.5 text-[9px] font-medium text-rose-600">gate</span>}
                      </td>
                      <td className="px-3 py-1.5"><ScoreBar score={r.score} maxAbs={maxAbs} dim={r.gated} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{gcaCell(r.g.values[yieldTrait])}</td>
                      {moistTrait && <td className="px-3 py-1.5 text-right tabular-nums">{gcaCell(r.g.values[moistTrait])}</td>}
                      <td className="px-3 py-1.5"><div className="flex justify-center"><DegreeDot g={r.g} /></div></td>
                      <td className="px-3 py-1.5 text-center"><MarkerProfile loci={r.g.loci} catalog={catalog} /></td>
                      <td className="px-3 py-1.5 text-right">
                        <button type="button" onClick={() => onAdvance(r.g.line, "inbred", pool, "advance")} disabled={busy}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition disabled:opacity-40 ${advanced ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                          {advanced ? <><Check size={11} /> Advanced</> : "Advance"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ranking.length > 60 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="w-full border-t border-slate-100 bg-slate-50 py-2 text-xs font-medium text-slate-500 hover:text-slate-700">
              {showAll ? "Show top 60" : `Show all ${ranking.length} lines in pool ${pool}`}
            </button>
          )}
        </div>

        {/* scatter + legend */}
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-1 text-xs font-semibold text-slate-700">GCA landscape · pool {pool}</div>
            <div className="text-[11px] text-slate-400">Each dot a line. Size = plots tested. Dimmed = gated out.</div>
            <div className="mt-2 h-[230px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <ReferenceLine x={0} stroke="#cbd5e1" />
                  <ReferenceLine y={0} stroke="#cbd5e1" />
                  <XAxis type="number" dataKey="x" name="GCA yield" tick={{ fontSize: 10, fill: "#94a3b8" }}
                    label={{ value: `GCA ${shortTrait(yieldTrait)}`, position: "bottom", offset: 0, fontSize: 10, fill: "#64748b" }} />
                  <YAxis type="number" dataKey="y" name="GCA moisture" tick={{ fontSize: 10, fill: "#94a3b8" }} width={36} />
                  <ZAxis type="number" dataKey="z" range={[20, 220]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<DotTip />} />
                  <Scatter data={scatterData.filter((d) => !d.gated && !d.advanced)} fill={POOL_COLOR[pool] ?? "#10b981"} fillOpacity={0.5} />
                  <Scatter data={scatterData.filter((d) => d.gated)} fill="#cbd5e1" fillOpacity={0.4} />
                  <Scatter data={scatterData.filter((d) => d.advanced)} fill="#059669" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-500">
            <div className="mb-1.5 font-semibold text-slate-700">Reading this</div>
            <p><b className="text-slate-700">GCA</b> is each line&rsquo;s shrunken BLUP — the value already discounts thinly-tested lines toward the mean. The <b className="text-slate-700">Tested</b> dot shows how much data backs it: bigger / darker = more crosses & plots.</p>
            <p className="mt-1.5">The <b className="text-rose-600">gate</b> culls lines that don&rsquo;t carry the marker alleles you required above. The <b className="text-slate-700">Markers</b> dots show each line&rsquo;s favourable-allele profile (hover for the calls).</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ score, maxAbs, dim }: { score: number; maxAbs: number; dim: boolean }) {
  const pct = Math.min(100, (Math.abs(score) / maxAbs) * 100);
  const pos = score >= 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`absolute top-0 h-full rounded-full ${dim ? "bg-slate-300" : pos ? "bg-emerald-500" : "bg-orange-400"}`}
          style={{ width: `${pct / 2}%`, left: pos ? "50%" : `${50 - pct / 2}%` }} />
        <div className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
      </div>
      <span className={`w-10 text-right text-[11px] tabular-nums ${dim ? "text-slate-300" : "text-slate-500"}`}>{score >= 0 ? "+" : ""}{score.toFixed(2)}</span>
    </div>
  );
}

function gcaCell(v: number | null | undefined) {
  if (v == null) return <span className="text-slate-300">–</span>;
  const c = v > 0.02 ? "text-emerald-600" : v < -0.02 ? "text-orange-500" : "text-slate-400";
  return <span className={c}>{v >= 0 ? "+" : ""}{v.toFixed(3)}</span>;
}

function DegreeDot({ g }: { g: CaGca }) {
  const d = g.cross_degree.n_testers; const plots = g.cross_degree.n_plots;
  const size = 7 + Math.min(d, 4) * 2.5; const opacity = 0.35 + Math.min(plots / 16, 1) * 0.55; const weak = d <= 1;
  return (
    <span title={`crossed to ${d} tester${d === 1 ? "" : "s"}, ${plots} plots${weak ? " — thinly tested, GCA heavily shrunk" : ""}`}
      className="inline-block rounded-full align-middle"
      style={{ width: size, height: size, background: weak ? "#f59e0b" : "#10b981", opacity }} />
  );
}

function DotTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { line: string; x: number; z: number; gated: boolean } }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-md">
      <div className="font-semibold text-slate-800">{p.line}</div>
      <div className="text-slate-500">GCA yield {p.x >= 0 ? "+" : ""}{fmt(p.x, 3)} · {p.z} plots{p.gated ? " · gated" : ""}</div>
    </div>
  );
}

function ContribTip({ active, payload, label }: { active?: boolean; label?: string | number; payload?: Array<{ dataKey?: string | number; name?: string; value?: number; color?: string }> }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((a, p) => a + (p.value ?? 0), 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-slate-800">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-600"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.name}</span>
          <span className="tabular-nums text-slate-700">{(p.value ?? 0) >= 0 ? "+" : ""}{Number(p.value ?? 0).toFixed(3)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t border-slate-100 pt-1 font-semibold text-slate-900"><span>GCA index</span><span className="tabular-nums">{total.toFixed(3)}</span></div>
    </div>
  );
}

function ModeButton({ mode, onClick }: { mode: Mode; onClick: () => void }) {
  const cfg = {
    max: { cls: "bg-emerald-100 text-emerald-700", icon: <ArrowUp size={12} />, title: "higher GCA is better — click for lower" },
    min: { cls: "bg-amber-100 text-amber-700", icon: <ArrowDown size={12} />, title: "lower GCA is better — click for target" },
    target: { cls: "bg-indigo-100 text-indigo-700", icon: <Crosshair size={12} />, title: "target GCA (penalize deviation) — click for higher" },
  }[mode];
  return <button type="button" onClick={onClick} className={`grid h-5 w-5 place-items-center rounded ${cfg.cls}`} title={cfg.title}>{cfg.icon}</button>;
}

function roundTo100(weights: Record<string, number>, ids: string[]): Record<string, number> {
  const total = ids.reduce((a, id) => a + Math.max(0, weights[id] ?? 0), 0) || 1;
  const parts = ids.map((id) => { const exact = (Math.max(0, weights[id] ?? 0) / total) * 100; const floor = Math.floor(exact); return { id, floor, rem: exact - floor }; });
  let leftover = 100 - parts.reduce((a, p) => a + p.floor, 0);
  const byRem = [...parts].sort((a, b) => b.rem - a.rem);
  const out: Record<string, number> = {}; for (const p of parts) out[p.id] = p.floor;
  for (let i = 0; i < byRem.length && leftover > 0; i++, leftover--) out[byRem[i].id] += 1;
  return out;
}

function MarkerProfile({ loci, catalog }: { loci?: Record<string, string> | null; catalog: CaLocus[] }) {
  if (!loci || catalog.length === 0) return <span className="text-[11px] text-slate-300">—</span>;
  return (
    <div className="flex justify-center gap-0.5" title={catalog.map((L) => `${L.locus}: ${loci[L.locus] ?? "?"}`).join("   ")}>
      {catalog.map((L) => {
        const fav = loci[L.locus] === L.favorable;
        return <span key={L.locus} className={`h-2 w-2 rounded-full ${fav ? "bg-emerald-500" : "bg-slate-200"}`} />;
      })}
    </div>
  );
}

function shortTrait(t: string | undefined) {
  if (!t) return "";
  return t.replace("_Mg_ha", "").replace("Grain_", "").replace(/_/g, " ");
}
