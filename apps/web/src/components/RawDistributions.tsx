"use client";
// Raw-measurement distributions (ADR-0021) — box-and-whisker by environment, per trait. The "see the
// spread + outliers of the ACTUAL data" view: a pre-fit data-sanity check (distinct from the post-fit
// residual Q-Q). One box per site shows the quartiles + 1.5·IQR whiskers; points beyond the whiskers
// are drawn as rose dots, so a fat-fingered value or a weird site jumps out. Collapsed by default.
import { useState } from "react";
import { ChevronDown, ChevronRight, BarChart3 } from "lucide-react";
import type { ResultBundle } from "@verdant/contracts";

type EnvBox = {
  environment: string; n: number; min: number; q1: number; median: number; q3: number; max: number;
  whisker_lo: number; whisker_hi: number; n_outliers: number; outliers: number[];
};
type Distributions = Record<string, EnvBox[]>;

export default function RawDistributions({ bundle }: { bundle: ResultBundle }) {
  const dq = bundle.data_quality as { distributions?: Distributions } | null | undefined;
  const dist = dq?.distributions;
  const [open, setOpen] = useState(false);
  if (!dist || Object.keys(dist).length === 0) return null;
  const traits = Object.keys(dist);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-5 py-3.5 text-left">
        {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
        <BarChart3 size={14} className="text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Raw measurement distributions</h3>
        <span className="text-[11px] text-slate-400">the spread of your data, by site — where do the outliers sit?</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 p-5 pt-4">
          <p className="text-[11px] leading-snug text-slate-400">
            One box per environment: the box spans the middle 50% of plots, the line is the median, the whiskers
            reach the furthest non-outlier, and rose dots are values beyond 1.5×IQR — likely the data points to inspect.
          </p>
          {traits.map((tr) => (
            <TraitBoxPlot key={tr} trait={tr} envs={dist[tr]} />
          ))}
        </div>
      )}
    </section>
  );
}

function TraitBoxPlot({ trait, envs }: { trait: string; envs: EnvBox[] }) {
  if (!envs || envs.length === 0) return null;
  const H = 150, padT = 8, padB = 34, padL = 38, slot = 46;
  const W = padL + envs.length * slot + 8;
  // global y-range over boxes + outliers
  const lo = Math.min(...envs.map((e) => Math.min(e.min, ...(e.outliers ?? []))));
  const hi = Math.max(...envs.map((e) => Math.max(e.max, ...(e.outliers ?? []))));
  const pad = (hi - lo) * 0.06 || 1;
  const yMin = lo - pad, yMax = hi + pad;
  const Y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  const ticks = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <figure className="overflow-x-auto">
      <figcaption className="mb-1 text-xs font-semibold text-slate-700">{trait}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Box-and-whisker of ${trait} by environment`}>
        {/* y axis ticks */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL - 4} y1={Y(t)} x2={W - 4} y2={Y(t)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={padL - 6} y={Y(t) + 3} textAnchor="end" fontSize={8} fill="#94a3b8">{fmt(t)}</text>
          </g>
        ))}
        {envs.map((e, i) => {
          const cx = padL + i * slot + slot / 2;
          const bw = 18;
          return (
            <g key={e.environment}>
              {/* whiskers */}
              <line x1={cx} y1={Y(e.whisker_lo)} x2={cx} y2={Y(e.whisker_hi)} stroke="#cbd5e1" strokeWidth={1} />
              <line x1={cx - 5} y1={Y(e.whisker_lo)} x2={cx + 5} y2={Y(e.whisker_lo)} stroke="#cbd5e1" strokeWidth={1} />
              <line x1={cx - 5} y1={Y(e.whisker_hi)} x2={cx + 5} y2={Y(e.whisker_hi)} stroke="#cbd5e1" strokeWidth={1} />
              {/* box */}
              <rect x={cx - bw / 2} y={Y(e.q3)} width={bw} height={Math.max(1, Y(e.q1) - Y(e.q3))} fill="#d1fae5" stroke="#10b981" strokeWidth={1} rx={1.5} />
              <line x1={cx - bw / 2} y1={Y(e.median)} x2={cx + bw / 2} y2={Y(e.median)} stroke="#047857" strokeWidth={1.5} />
              {/* outliers */}
              {(e.outliers ?? []).map((o, k) => (
                <circle key={k} cx={cx} cy={Y(o)} r={1.8} fill="#e11d48" fillOpacity={0.85} />
              ))}
              {/* env label */}
              <text x={cx} y={H - padB + 12} textAnchor="end" fontSize={8} fill="#64748b"
                transform={`rotate(-40 ${cx} ${H - padB + 12})`}>{shortEnv(e.environment)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function fmt(v: number) { return Math.abs(v) >= 1000 ? v.toExponential(1) : Number(v.toFixed(Math.abs(v) < 10 ? 1 : 0)).toString(); }
function shortEnv(e: string) { return e.replace(/_20\d\d$/, ""); }
