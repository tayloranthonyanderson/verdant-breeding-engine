"use client";

// The transparent weighted selection index, made interactive (ADR-0006): the breeder sets each
// trait's selection mode + relative weight, the weights are shown normalized to 100% (the
// alignment device), and the ranking + chart recompute instantly in the browser from the BLUPs
// already in the bundle. No round-trip — the science (BLUPs, h²) is fixed; only the weighting and
// the selection intent are the user's.
//
// Selection modes per trait:
//   max     — higher is better (merit = +z)
//   min     — lower is better  (merit = −z)
//   target  — an optimum: penalize deviation from a target value, quadratically
//             (merit = −(z − z_target)²). Far-from-target genotypes are increasingly penalized.
// All merits are in z-units (sample sd, n−1) so the live recompute is numerically identical to the
// R kernel, which now also resolves max/min/target from the contract's index-weight `mode`.
//
// The "Top of the index" chart stacks each trait's weighted CONTRIBUTION (merit × weight ÷ ΣW) so
// the bar segments sum to the index score — the breeder sees which trait is driving each genotype.
import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, Crosshair } from "lucide-react";
import {
  Bar,
  BarChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ResultBundle } from "@verdant/contracts";

// Distinct hue per trait, reused by the chart bars, legend, and tooltip swatches.
const TRAIT_COLORS = ["#10b981", "#6366f1", "#f59e0b", "#0ea5e9", "#f43f5e", "#a855f7"];

const TABLE_N = 25;
const CHART_N = 15;

type Mode = "max" | "min" | "target";

export default function IndexExplorer({ bundle }: { bundle: ResultBundle }) {
  // Precompute, once per bundle: per-trait mean/sd, genotype z-scores, raw BLUPs, and gate flags
  // (gates are independent of weights, so we keep the kernel's gate decisions).
  const { traitIds, genos, z, blup, stats, gated } = useMemo(() => {
    const traitIds = bundle.traits.map((t) => t.variable_id);
    const genoSet = new Set<string>();
    const blup: Record<string, Map<string, number>> = {};
    for (const t of bundle.traits) {
      const m = new Map<string, number>();
      for (const e of t.effects) {
        if (e.value != null) {
          m.set(e.germplasm_id, e.value);
          genoSet.add(e.germplasm_id);
        }
      }
      blup[t.variable_id] = m;
    }
    const genos = [...genoSet];
    const z: Record<string, Map<string, number>> = {};
    const stats: Record<string, { mean: number; sd: number; min: number; max: number }> = {};
    for (const id of traitIds) {
      const m = blup[id];
      const vals = genos.map((g) => m.get(g)).filter((v): v is number => v != null);
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      // empirical sample sd (n-1) → unit-variance z. This keeps the weight slider honest (30% weight
      // = 30% of the influence) and matches the kernel exactly. Genetic √Vg is reserved for the
      // Smith–Hazel index, not this transparent one.
      const sd =
        Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / ((vals.length - 1) || 1)) || 1;
      const min = vals.length ? Math.min(...vals) : 0;
      const max = vals.length ? Math.max(...vals) : 1;
      stats[id] = { mean, sd, min, max };
      const zm = new Map<string, number>();
      for (const g of genos) {
        const v = m.get(g);
        zm.set(g, v == null ? 0 : (v - mean) / sd);
      }
      z[id] = zm;
    }
    const gated = new Map<string, { gated: boolean; fails: string[] }>();
    for (const r of bundle.indices?.[0]?.ranking ?? []) {
      gated.set(r.germplasm_id, { gated: !!r.gated_out, fails: r.gate_failures ?? [] });
    }
    return { traitIds, genos, z, blup, stats, gated };
  }, [bundle]);

  const initial = bundle.indices?.[0]?.weights_used ?? [];
  // Weights are stored as PERCENTAGES that always sum to 100. The sliders are coupled: moving one
  // trait redistributes the remaining share across the others in proportion to their current
  // weights, so every thumb stays in sync and the panel always visibly sums to 100%.
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const raw = Object.fromEntries(
      traitIds.map((id) => [id, Math.abs(initial.find((w) => w.variable_id === id)?.weight ?? 1)]),
    );
    const sum = traitIds.reduce((a, id) => a + raw[id], 0) || 1;
    return Object.fromEntries(traitIds.map((id) => [id, (raw[id] / sum) * 100]));
  });
  // Selection mode per trait. Seed from the kernel's echoed `mode` (the contract now carries it);
  // fall back to the legacy signed `direction` (− → min, else max) for older bundles.
  const [modes, setModes] = useState<Record<string, Mode>>(() =>
    Object.fromEntries(
      traitIds.map((id) => {
        const w = initial.find((x) => x.variable_id === id);
        const mode: Mode = w?.mode ?? ((w?.direction ?? 1) < 0 ? "min" : "max");
        return [id, mode] as [string, Mode];
      }),
    ),
  );
  // Target values: seed from the kernel's echoed target when present, else the trait mean.
  const [targets, setTargets] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      traitIds.map((id) => {
        const t = initial.find((x) => x.variable_id === id)?.target;
        return [id, typeof t === "number" ? t : Number((stats[id]?.mean ?? 0).toFixed(2))];
      }),
    ),
  );

  // Coupled re-weight: pin trait `id` to `value`%, then share the remaining (100 - value)% across
  // the other traits in proportion to their current weights (equal split if they're all at zero).
  function reweight(id: string, value: number) {
    setWeights((prev) => {
      const v = Math.max(0, Math.min(100, value));
      const others = traitIds.filter((t) => t !== id);
      if (others.length === 0) return { [id]: 100 };
      const remaining = 100 - v;
      const otherSum = others.reduce((a, t) => a + (prev[t] ?? 0), 0);
      const next: Record<string, number> = { [id]: v };
      for (const t of others) {
        next[t] = otherSum > 0 ? ((prev[t] ?? 0) / otherSum) * remaining : remaining / others.length;
      }
      return next;
    });
  }

  function cycleMode(id: string) {
    setModes((m) => ({ ...m, [id]: m[id] === "max" ? "min" : m[id] === "min" ? "target" : "max" }));
  }

  // Weights already sum to 100 by construction; keep a guarded total against float drift.
  const totalW = traitIds.reduce((a, id) => a + Math.abs(weights[id] ?? 0), 0) || 1;
  const hasTarget = traitIds.some((id) => modes[id] === "target");

  const ranking = useMemo(() => {
    // Pass 1: raw merit per trait (max → +z, min → −z, target → −(z−z_target)²), then each trait's
    // merit-column mean/sd. Merit depends on mode + target only (not weights), and normalizing the
    // column puts the quadratic target term on the same footing as the linear ones while keeping the
    // weights honest. Mirrors the kernel exactly (empirical sample sd, n−1).
    const meritByTrait: Record<string, Map<string, number>> = {};
    const norm: Record<string, { mean: number; sd: number }> = {};
    for (const id of traitIds) {
      const mode = modes[id];
      const st = stats[id];
      const zT = st && st.sd ? (targets[id] - st.mean) / st.sd : 0;
      const mm = new Map<string, number>();
      const vals: number[] = [];
      for (const g of genos) {
        const zg = z[id].get(g) ?? 0;
        const merit = mode === "min" ? -zg : mode === "target" ? -((zg - zT) ** 2) : zg;
        mm.set(g, merit);
        vals.push(merit);
      }
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      const sd =
        Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / ((vals.length - 1) || 1)) || 1;
      meritByTrait[id] = mm;
      norm[id] = { mean, sd };
    }
    // Pass 2: normalized per-trait CONTRIBUTION (merit standardized × weight ÷ ΣW); the parts sum to
    // the score, which is what lets the chart stack them.
    return genos
      .map((g) => {
        let s = 0;
        const parts: Record<string, number> = {};
        for (const id of traitIds) {
          const n = norm[id];
          const meritN = ((meritByTrait[id].get(g) ?? 0) - n.mean) / n.sd;
          const contrib = (meritN * (weights[id] ?? 0)) / totalW;
          parts[id] = contrib;
          s += contrib;
        }
        const info = gated.get(g);
        return { g, score: s, parts, gated: info?.gated ?? false, fails: info?.fails ?? [] };
      })
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [genos, traitIds, z, modes, targets, weights, gated, totalW, stats]);

  const chartData = ranking
    .filter((r) => !r.gated)
    .slice(0, CHART_N)
    .map((r) => ({ name: r.g, score: r.score, ...r.parts }));

  return (
    <section className="space-y-5">
      {/* 1 — Top of the index (chart first) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Top of the index</h3>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              // 'sign' keeps each sign on its own side of zero: positive contributions stack to the
              // right, negative ones (e.g. a target penalty) to the left — instead of painting the
              // negative over the positive (recharts' default 'none' offset).
              stackOffset="sign"
              margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
            >
              <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={{ fontSize: 10, fill: "#64748b" }}
                interval={0}
              />
              <ReferenceLine x={0} stroke="#cbd5e1" />
              <Tooltip cursor={{ fill: "#f1f5f9" }} content={<ContributionTooltip />} />
              <Legend
                verticalAlign="top"
                height={24}
                iconType="square"
                iconSize={9}
                wrapperStyle={{ fontSize: 11 }}
              />
              {traitIds.map((id, i) => (
                <Bar
                  key={id}
                  dataKey={id}
                  stackId="idx"
                  fill={TRAIT_COLORS[i % TRAIT_COLORS.length]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          Each bar splits a genotype&apos;s index into per-trait contributions, each standardized to a
          common scale. Right of zero = better than the trial average for that trait&apos;s goal
          (higher, lower, or nearer the target); left of zero = worse. Hover for the exact breakdown.
        </p>
      </div>

      {/* 2 — Index weights (controls) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Index weights</h3>
          <span className="text-[11px] text-slate-400">click the icon to change mode · drag to re-rank · live</span>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {traitIds.map((id) => {
            const pct = Math.round((Math.abs(weights[id] ?? 0) / totalW) * 100);
            const mode = modes[id];
            return (
              <div key={id} className={mode === "target" ? "sm:col-span-2" : ""}>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <ModeButton mode={mode} onClick={() => cycleMode(id)} />
                    <span className="font-medium text-slate-700">{id}</span>
                    {mode === "target" && (
                      <span className="ml-1 text-[11px] font-medium text-indigo-600">target</span>
                    )}
                  </div>
                  <span className="tnum font-semibold text-slate-900">{pct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={weights[id] ?? 0}
                  onChange={(e) => reweight(id, Number(e.target.value))}
                  className="mt-1.5 w-full accent-emerald-600"
                />
                {mode === "target" && (
                  <TargetControl
                    values={[...blup[id].values()]}
                    min={stats[id].min}
                    max={stats[id].max}
                    mean={stats[id].mean}
                    target={targets[id] ?? stats[id].mean}
                    onChange={(v) => setTargets((t) => ({ ...t, [id]: v }))}
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-400">
          Weights normalize to 100% — a deliberate alignment device. The BLUPs and heritability are
          fixed by the model; only the weighting and selection mode are yours.
          {hasTarget && (
            <>
              {" "}
              <span className="text-indigo-500">
                Target traits penalize deviation from the chosen value quadratically — genotypes
                farther from target are increasingly discounted.
              </span>
            </>
          )}
        </p>
      </div>

      {/* 3 — Detailed results table */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Selection ranking</h3>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Genotype</th>
                <th className="px-3 py-2 text-right font-medium">Index</th>
                {traitIds.map((id) => (
                  <th key={id} className="px-3 py-2 text-right font-medium">{id}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranking.slice(0, TABLE_N).map((r) => (
                <tr
                  key={r.g}
                  className={`border-b border-slate-50 last:border-0 ${r.gated ? "opacity-45" : ""}`}
                >
                  <td className="px-3 py-2 tnum text-slate-400">{r.rank}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {r.g}
                    {r.gated && (
                      <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                        gated{r.fails.length ? `: ${r.fails.join(", ")}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tnum font-semibold text-slate-900">
                    {r.score.toFixed(3)}
                  </td>
                  {traitIds.map((id) => {
                    const v = blup[id].get(r.g);
                    return (
                      <td key={id} className="px-3 py-2 text-right tnum text-slate-600">
                        {v != null ? v.toFixed(2) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
            Top {Math.min(TABLE_N, ranking.length)} of {ranking.length} · transparent weighted index
            {bundle.indices?.[0]?.segment_id ? ` · ${bundle.indices[0].segment_id}` : ""}
          </div>
        </div>
      </div>
    </section>
  );
}

// Target control: shows WHERE the trait's genotype values actually fall (a mini histogram of the
// BLUPs) so the breeder can place the optimum on the real distribution instead of guessing a number
// into a void. Drag the slider or type a value; the marker and the index recompute live.
function TargetControl({
  values,
  min,
  max,
  mean,
  target,
  onChange,
}: {
  values: number[];
  min: number;
  max: number;
  mean: number;
  target: number;
  onChange: (v: number) => void;
}) {
  const BINS = 32;
  const span = max - min || 1;
  const bins = new Array(BINS).fill(0);
  for (const v of values) {
    let k = Math.floor(((v - min) / span) * BINS);
    if (k < 0) k = 0;
    else if (k >= BINS) k = BINS - 1;
    bins[k] += 1;
  }
  const peak = Math.max(...bins, 1);
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - min) / span) * 100));
  // a "nice" 1/2/5 step near span/200, so dragging lands on tidy values rather than 21.19559535
  const raw = span / 200;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  // snap slider output to the step grid so the value reads 21.40, not 21.396 (min isn't round)
  const dec = Math.max(0, -Math.floor(Math.log10(step)));
  const snap = (v: number) => Number((Math.round(v / step) * step).toFixed(dec));
  return (
    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/30 p-2">
      {/* distribution with mean (dashed) + target (solid) markers */}
      <div className="relative h-12">
        <div className="absolute inset-0 flex items-end gap-px">
          {bins.map((c, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-indigo-200"
              style={{ height: `${(c / peak) * 100}%` }}
            />
          ))}
        </div>
        <div
          className="absolute inset-y-0 border-l border-dashed border-slate-400/70"
          style={{ left: `${pct(mean)}%` }}
          title={`mean ${mean.toFixed(2)}`}
        />
        <div
          className="absolute inset-y-0 w-[2px] bg-indigo-600"
          style={{ left: `${pct(target)}%` }}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, target))}
        onChange={(e) => onChange(snap(Number(e.target.value)))}
        className="mt-1 w-full accent-indigo-600"
      />
      <div className="flex items-center justify-between text-[10px] tnum text-slate-400">
        <span title="lowest genotype value">{min.toFixed(2)}</span>
        <span className="flex items-center gap-1 text-indigo-600">
          target
          <input
            type="number"
            step={step}
            value={target}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-16 rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-right font-semibold text-indigo-700 outline-none focus:border-indigo-400"
          />
        </span>
        <span title="highest genotype value">{max.toFixed(2)}</span>
      </div>
      <div className="mt-1 text-[10px] text-slate-400">
        {values.length} genotype BLUPs · dashed line = mean
      </div>
    </div>
  );
}

// Stacked-bar tooltip: lists each trait's contribution to the hovered genotype's index, then the
// total — the "why is this genotype here?" breakdown.
function ContributionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  label?: string | number;
  payload?: { dataKey?: string | number; value?: number; color?: string }[];
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((a, p) => a + (p.value ?? 0), 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-slate-800">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-600">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {String(p.dataKey)}
          </span>
          <span className="tnum text-slate-700">
            {(p.value ?? 0) >= 0 ? "+" : ""}
            {Number(p.value ?? 0).toFixed(3)}
          </span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t border-slate-100 pt-1 font-semibold text-slate-900">
        <span>index</span>
        <span className="tnum">{total.toFixed(3)}</span>
      </div>
    </div>
  );
}

// Mode toggle: cycles max → min → target. Icon + color encode the current selection intent.
function ModeButton({ mode, onClick }: { mode: Mode; onClick: () => void }) {
  const cfg = {
    max: { cls: "bg-emerald-100 text-emerald-700", icon: <ArrowUp size={12} />, title: "higher is better — click for lower" },
    min: { cls: "bg-amber-100 text-amber-700", icon: <ArrowDown size={12} />, title: "lower is better — click for target" },
    target: { cls: "bg-indigo-100 text-indigo-700", icon: <Crosshair size={12} />, title: "target value (penalize deviation) — click for higher" },
  }[mode];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid h-5 w-5 place-items-center rounded ${cfg.cls}`}
      title={cfg.title}
    >
      {cfg.icon}
    </button>
  );
}
