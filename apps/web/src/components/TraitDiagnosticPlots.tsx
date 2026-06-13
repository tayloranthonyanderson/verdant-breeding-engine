"use client";
// Per-trait residual diagnostic plots (ADR-0021) — "show me the data" behind one click. Two small,
// hand-rolled SVGs, each answering exactly ONE question with a reference for what good looks like:
//   • Residual vs fitted → equal variance + outliers (influential points in rose, the same you exclude)
//   • Normal Q-Q          → normality (the y=x line as the reference; tails curving away = heavy tails)
// The field-residual map lives in the Data Quality "Field trends" triptych (raw → trend → residual).
import type { ResultBundle } from "@verdant/contracts";

type Diagnostics = NonNullable<ResultBundle["traits"][number]["diagnostics"]>;
type ScatterPt = { f: number; r: number; o?: number };
type QQPt = { t: number; s: number; o?: number };
type Viz = {
  scatter?: ScatterPt[] | null;
  qq?: { points?: QQPt[]; n?: number; n_outliers?: number } | null;
};

export default function TraitDiagnosticPlots({ diagnostics }: { diagnostics: Diagnostics }) {
  const viz = diagnostics.viz as Viz | null | undefined;
  if (!viz) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {viz.scatter && viz.scatter.length > 0 && (
        <Plot title="Residual vs fitted" caption="Each dot is a plot. You want an even band around the 0 line. A funnel (widening) = unequal variance; the rose dots are the flagged outliers.">
          <ResidualScatter pts={viz.scatter} />
        </Plot>
      )}
      {viz.qq?.points && viz.qq.points.length > 0 && (
        <Plot title="Normal Q-Q" caption="Each dot is a residual vs. where it 'should' fall if perfectly normal. On the dashed line = normal. Ends curving away from the line = heavy tails; the rose dots are the flagged outliers.">
          <QQPlot points={viz.qq.points} />
        </Plot>
      )}
    </div>
  );
}

function Plot({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <figure className="rounded-xl border border-slate-200 bg-slate-50/40 p-2.5">
      <figcaption className="mb-1 text-[11px] font-semibold text-slate-600">{title}</figcaption>
      {children}
      <p className="mt-1 max-w-[230px] text-[10px] leading-snug text-slate-400">{caption}</p>
    </figure>
  );
}

const W = 230, H = 150, PAD = 26;

function ResidualScatter({ pts }: { pts: ScatterPt[] }) {
  const fs = pts.map((p) => p.f), rs = pts.map((p) => p.r);
  const fMin = Math.min(...fs), fMax = Math.max(...fs);
  const m = Math.max(1e-9, ...rs.map((v) => Math.abs(v))); // symmetric y so 0 is centered
  const x = (f: number) => PAD + ((f - fMin) / (fMax - fMin || 1)) * (W - PAD - 8);
  const y = (r: number) => PAD / 2 + (1 - (r + m) / (2 * m)) * (H - PAD - 8);
  const y0 = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Residual versus fitted scatter">
      {/* zero reference line */}
      <line x1={PAD} y1={y0} x2={W - 8} y2={y0} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" />
      <text x={PAD - 4} y={y0 + 3} textAnchor="end" fontSize={8} fill="#94a3b8">0</text>
      {/* non-outliers first, then outliers on top */}
      {pts.filter((p) => !p.o).map((p, i) => (
        <circle key={`a${i}`} cx={x(p.f)} cy={y(p.r)} r={1.6} fill="#94a3b8" fillOpacity={0.5} />
      ))}
      {pts.filter((p) => p.o).map((p, i) => (
        <circle key={`o${i}`} cx={x(p.f)} cy={y(p.r)} r={2.6} fill="#e11d48" fillOpacity={0.9} />
      ))}
      <text x={W / 2} y={H - 2} textAnchor="middle" fontSize={8} fill="#94a3b8">fitted value →</text>
    </svg>
  );
}

// Normal Q-Q plot. Square, shared symmetric scale so the y=x reference is a true 45° diagonal: the bulk
// of residuals tracks the line; the ends bowing away = heavy tails, and the rose points are the flagged
// outliers. No binning, no window — the extremes are shown, just compressed into the corner.
function QQPlot({ points }: { points: QQPt[] }) {
  const S = 150, pad = 18;
  const M = Math.max(1, ...points.map((p) => Math.max(Math.abs(p.t), Math.abs(p.s))));
  const X = (v: number) => pad + ((v + M) / (2 * M)) * (S - pad - 6);
  const Y = (v: number) => (S - pad) - ((v + M) / (2 * M)) * (S - pad - pad / 2);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="img" aria-label="Normal quantile-quantile plot of residuals">
      {/* y = x reference (perfect normality) */}
      <line x1={X(-M)} y1={Y(-M)} x2={X(M)} y2={Y(M)} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" />
      {points.filter((p) => !p.o).map((p, i) => (
        <circle key={`a${i}`} cx={X(p.t)} cy={Y(p.s)} r={1.5} fill="#64748b" fillOpacity={0.55} />
      ))}
      {points.filter((p) => p.o).map((p, i) => (
        <circle key={`o${i}`} cx={X(p.t)} cy={Y(p.s)} r={2.4} fill="#e11d48" fillOpacity={0.9} />
      ))}
      <text x={S / 2} y={S - 4} textAnchor="middle" fontSize={8} fill="#94a3b8">theoretical normal →</text>
    </svg>
  );
}
