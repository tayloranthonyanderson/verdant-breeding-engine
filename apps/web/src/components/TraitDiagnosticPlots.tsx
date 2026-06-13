"use client";
// Per-trait residual diagnostic plots (ADR-0021) — "show me the data" behind one click. Three small,
// hand-rolled SVGs, each answering exactly ONE question with a reference for what good looks like:
//   • Residual vs fitted   → equal variance + outliers (influential points in rose, the same ones you exclude)
//   • Residual histogram    → normality / skew (a normal curve as the reference)
//   • Field residual map     → spatial trend the model didn't remove (only shown when flagged)
// Downsampled in the kernel; rendered with no charting dependency to stay light and on-palette.
import type { ResultBundle } from "@verdant/contracts";

type Diagnostics = NonNullable<ResultBundle["traits"][number]["diagnostics"]>;
type ScatterPt = { f: number; r: number; o?: number };
type QQPt = { t: number; s: number; o?: number };
type Viz = {
  scatter?: ScatterPt[] | null;
  qq?: { points?: QQPt[]; n?: number; n_outliers?: number } | null;
  spatial?: { environment?: string; moran?: number; cells?: { row: number; col: number; r: number }[] } | null;
};

// House diverging scale (matches GrmHeatmap): ~0 slate, positive emerald, negative rose.
function diverge(v: number, max: number): string {
  const a = Math.min(1, Math.abs(v) / (max || 1));
  if (v >= 0) return `rgb(${Math.round(241 + (5 - 241) * a)},${Math.round(245 + (150 - 245) * a)},${Math.round(249 + (105 - 249) * a)})`;
  return `rgb(${Math.round(241 + (225 - 241) * a)},${Math.round(245 + (29 - 245) * a)},${Math.round(249 + (72 - 249) * a)})`;
}

export default function TraitDiagnosticPlots({ diagnostics, spatialCorrected }: { diagnostics: Diagnostics; spatialCorrected?: boolean }) {
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
      {viz.spatial?.cells && viz.spatial.cells.length > 0 && (
        <Plot
          title={`Field residuals · ${viz.spatial.environment ?? ""}`}
          caption={spatialCorrected
            ? "Each cell is a plot in its field position. You want random speckle. Smooth bands or a colored patch = a fertile/poor zone — your spatial model (SpATS) removes it from the BLUPs."
            : "Each cell is a plot in its field position. You want random speckle. Smooth bands or a colored patch = a field zone biasing the BLUPs — consider turning on a spatial model in the Model step."}>
          <FieldHeatmap spatial={viz.spatial} />
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

function FieldHeatmap({ spatial }: { spatial: { moran?: number; cells?: { row: number; col: number; r: number }[] } }) {
  const cells = spatial.cells ?? [];
  const rows = cells.map((c) => c.row), cols = cells.map((c) => c.col);
  const rMin = Math.min(...rows), rMax = Math.max(...rows);
  const cMin = Math.min(...cols), cMax = Math.max(...cols);
  const nR = rMax - rMin + 1, nC = cMax - cMin + 1;
  const maxAbs = Math.max(1e-9, ...cells.map((c) => Math.abs(c.r)));
  const side = Math.min(150, Math.max(90, Math.max(nR, nC) * 6));
  const cw = side / nC, ch = side / nR;
  return (
    <div>
      <svg viewBox={`0 0 ${side} ${side}`} width={side} height={side} role="img" aria-label="Field residual heatmap">
        <rect x={0} y={0} width={side} height={side} fill="#f8fafc" />
        {cells.map((c, i) => (
          <rect key={i} x={(c.col - cMin) * cw} y={(c.row - rMin) * ch} width={Math.ceil(cw)} height={Math.ceil(ch)} fill={diverge(c.r, maxAbs)} />
        ))}
      </svg>
      {/* legend: what the colors mean */}
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[9px] text-slate-400">below</span>
        <div className="h-2 flex-1 rounded" style={{ background: `linear-gradient(to right, ${diverge(-maxAbs, maxAbs)}, ${diverge(0, maxAbs)}, ${diverge(maxAbs, maxAbs)})` }} />
        <span className="text-[9px] text-slate-400">above</span>
      </div>
      <div className="text-center text-[9px] text-slate-400">vs. expected for that genotype</div>
    </div>
  );
}
