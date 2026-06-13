"use client";
// Field trends — the "spot the trend, then see the correction" triptych (ADR-0021). For each trait, the
// most spatially-structured environment shown three ways, by field position and SAME env throughout:
//   RAW measurement  →  fitted SpATS spatial trend (what the model removed)  →  RESIDUAL (what's left).
// You SEE a gradient/patch in the raw field, see SpATS isolate it as a smooth surface, and see the
// residual come out as clean speckle. Collapsed by default; pre-fit "look at your field" placement.
import { useState } from "react";
import { ChevronDown, ChevronRight, Map as MapIcon, ArrowRight } from "lucide-react";
import type { ResultBundle } from "@verdant/contracts";

type Cell = { row: number; col: number; raw: number; trend: number; resid: number };
type FieldTrend = { environment: string; n?: number; cells: Cell[] };
type FieldTrends = Record<string, FieldTrend>;

// House diverging scale: ~0 slate, positive emerald, negative rose.
function diverge(v: number, max: number): string {
  const a = Math.min(1, Math.abs(v) / (max || 1));
  if (v >= 0) return `rgb(${Math.round(241 + (5 - 241) * a)},${Math.round(245 + (150 - 245) * a)},${Math.round(249 + (105 - 249) * a)})`;
  return `rgb(${Math.round(241 + (225 - 241) * a)},${Math.round(245 + (29 - 245) * a)},${Math.round(249 + (72 - 249) * a)})`;
}

export default function FieldTrends({ bundle }: { bundle: ResultBundle }) {
  const ft = (bundle.data_quality as { field_trends?: FieldTrends } | null | undefined)?.field_trends;
  const [open, setOpen] = useState(false);
  if (!ft || Object.keys(ft).length === 0) return null;
  const traits = Object.keys(ft);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-5 py-3.5 text-left">
        {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
        <MapIcon size={14} className="text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Field trends</h3>
        <span className="text-[11px] text-slate-400">spot the trend in the field, then watch the model correct it</span>
      </button>
      {open && (
        <div className="space-y-5 border-t border-slate-100 p-5 pt-4">
          <p className="text-[11px] leading-snug text-slate-400">
            For the most spatially-structured site of each trait: your <b>raw</b> measurements by field position →
            the smooth <b>field trend</b> the spatial model (SpATS) found and removed → the <b>residual</b> left over.
            A gradient or patch in the raw field that becomes a clean surface and then random speckle means the
            model handled the field — and the trend panel is the correction it applied.
          </p>
          {traits.map((tr) => (
            <Triptych key={tr} trait={tr} data={ft[tr]} />
          ))}
        </div>
      )}
    </section>
  );
}

function Triptych({ trait, data }: { trait: string; data: FieldTrend }) {
  const cells = data.cells ?? [];
  if (cells.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-semibold text-slate-700">{trait}</span>
        <span className="text-[10px] text-slate-400">{data.environment}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Panel cells={cells} get={(c) => c.raw} center="median" title="Raw" sub="what you measured" />
        <ArrowRight size={16} className="shrink-0 text-slate-300" />
        <Panel cells={cells} get={(c) => c.trend} center={0} title="Field trend" sub="SpATS removed this" />
        <ArrowRight size={16} className="shrink-0 text-slate-300" />
        <Panel cells={cells} get={(c) => c.resid} center={0} title="Residual" sub="what's left (want speckle)" />
      </div>
    </div>
  );
}

function Panel({ cells, get, center, title, sub }: {
  cells: Cell[]; get: (c: Cell) => number; center: number | "median"; title: string; sub: string;
}) {
  const vals = cells.map(get).filter((v) => Number.isFinite(v));
  const mid = center === "median" ? median(vals) : center;
  const maxAbs = Math.max(1e-9, ...vals.map((v) => Math.abs(v - mid)));
  const rows = cells.map((c) => c.row), cols = cells.map((c) => c.col);
  const rMin = Math.min(...rows), rMax = Math.max(...rows), cMin = Math.min(...cols), cMax = Math.max(...cols);
  const nR = rMax - rMin + 1, nC = cMax - cMin + 1;
  const side = 120, cw = side / nC, ch = side / nR;
  return (
    <figure className="rounded-lg border border-slate-200 bg-slate-50/40 p-1.5">
      <figcaption className="mb-0.5 text-[10px] font-semibold text-slate-600">{title}</figcaption>
      <svg viewBox={`0 0 ${side} ${side}`} width={side} height={side} role="img" aria-label={`${title} field map`}>
        <rect x={0} y={0} width={side} height={side} fill="#f8fafc" />
        {cells.map((c, i) => (
          <rect key={i} x={(c.col - cMin) * cw} y={(c.row - rMin) * ch} width={Math.ceil(cw)} height={Math.ceil(ch)}
            fill={diverge(get(c) - mid, maxAbs)} />
        ))}
      </svg>
      <figcaption className="mt-0.5 max-w-[120px] text-[9px] leading-tight text-slate-400">{sub}</figcaption>
    </figure>
  );
}

function median(a: number[]) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
