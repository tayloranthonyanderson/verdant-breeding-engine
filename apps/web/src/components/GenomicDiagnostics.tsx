"use client";

// Genomic diagnostics panel — "can I trust the GRM and the GEBVs?" Three sub-sections:
//   1. GRM quality — sanity stats (is it positive-definite, what's the diagonal telling me).
//   2. Per-genotype reliability — which GEBVs to trust (reliability = 1 − PEV/Vg).
//   3. Relationship distribution — off-diagonal relatedness + diagonal genomic inbreeding.
// All small recharts; card style matches the rest of the genomic UI.
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ResultBundle } from "@verdant/contracts";

type Sanity = {
  raw_diag_mean?: number;
  diag_mean?: number;
  offdiag_mean?: number;
  offdiag_sd?: number;
  min_eigenvalue?: number;
  is_pd?: boolean;
  rank?: number;
};
type Gebv = { values?: number[]; reliability?: number[]; Vg?: number; Ve?: number };
type Hist = { breaks?: number[]; counts?: number[] };
type Genomic = {
  n_markers?: number;
  traits?: string[];
  sanity?: Sanity;
  gebv?: Record<string, Gebv>;
  distribution?: { offdiag?: Hist; diag?: Hist };
};

function fmt(v: number | undefined, d = 2): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";
}

// Build {midpoint,count} pairs from a {breaks,counts} histogram (breaks has counts.length+1 edges).
function histPoints(h: Hist | undefined): Array<{ mid: number; count: number; label: string }> {
  const breaks = h?.breaks ?? [];
  const counts = h?.counts ?? [];
  if (counts.length === 0 || breaks.length < 2) return [];
  return counts.map((count, i) => {
    const lo = breaks[i] ?? 0;
    const hi = breaks[i + 1] ?? lo;
    const mid = (lo + hi) / 2;
    return { mid, count, label: mid.toFixed(2) };
  });
}

export default function GenomicDiagnostics({ bundle }: { bundle: ResultBundle }) {
  const genomic = bundle.genomic as Genomic | undefined;

  const { relBins, meanRel } = useMemo(() => {
    const gebv = genomic?.gebv ?? {};
    const trait = gebv["Yield_Mg_ha"] ? "Yield_Mg_ha" : Object.keys(gebv)[0];
    const rel = (trait ? gebv[trait]?.reliability : undefined) ?? [];
    const clean = rel.filter((r) => Number.isFinite(r));
    const NB = 10;
    const bins = Array.from({ length: NB }, (_, i) => ({
      label: `${(i / NB).toFixed(1)}`,
      lo: i / NB,
      count: 0,
    }));
    for (const r of clean) {
      const idx = Math.min(NB - 1, Math.max(0, Math.floor(r * NB)));
      bins[idx].count += 1;
    }
    const mean = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
    return { relBins: bins, meanRel: mean };
  }, [genomic]);

  if (!genomic) return null;
  const s = genomic.sanity ?? {};

  const offdiag = histPoints(genomic.distribution?.offdiag);
  const diag = histPoints(genomic.distribution?.diag);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">Genomic diagnostics</h3>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
        Is the relationship matrix well-formed, and which genomic breeding values are worth trusting?
      </p>

      {/* 1. GRM quality */}
      <div className="mt-4">
        <h4 className="mb-2 text-xs font-semibold text-slate-600">GRM quality</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Chip label="markers" value={typeof genomic.n_markers === "number" ? genomic.n_markers.toLocaleString() : "—"} />
          <Chip
            label="positive-definite"
            value={s.is_pd ? "✓" : "✗"}
            tone={s.is_pd ? "good" : "bad"}
          />
          <Chip label="rank" value={typeof s.rank === "number" ? s.rank.toLocaleString() : "—"} />
          <Chip label="scaled diagonal" value={fmt(s.diag_mean)} hint="mean Gii after scaling (≈1)" />
          <Chip
            label="raw diagonal"
            value={fmt(s.raw_diag_mean)}
            hint="hybrid/testcross heterozygosity signal"
          />
          <Chip label="off-diag spread" value={fmt(s.offdiag_sd)} hint="SD of off-diagonal relatedness" />
        </div>
      </div>

      {/* 2. Per-genotype reliability */}
      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h4 className="text-xs font-semibold text-slate-600">Per-genotype reliability</h4>
          {meanRel != null && (
            <span className="text-[11px] text-slate-500">
              mean <span className="tnum font-semibold text-slate-800">{meanRel.toFixed(2)}</span>
            </span>
          )}
        </div>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={relBins} margin={{ left: 0, right: 8, top: 4, bottom: 16 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                interval={0}
                label={{ value: "reliability →", position: "insideBottom", offset: -8, fontSize: 11, fill: "#64748b" }}
              />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={28} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 11 }}
                formatter={(v) => [v as number, "genotypes"]}
                labelFormatter={(l) => `reliability ≥ ${l}`}
              />
              <Bar dataKey="count" fill="#059669" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          Which GEBVs to trust — reliability = 1 − PEV/Vg; lines with many genotyped relatives predict
          more reliably. Low-reliability lines are rankings to take with a grain of salt.
        </p>
      </div>

      {/* 3. Relationship distribution */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <DistChart
          title="Off-diagonal relatedness"
          data={offdiag}
          fill="#0ea5e9"
          xLabel="relationship →"
          caption="How related pairs of lines are. A spike near 0 = mostly unrelated; a fat right tail = lots of close relatives (family structure)."
        />
        <DistChart
          title="Diagonal (genomic inbreeding)"
          data={diag}
          fill="#6366f1"
          xLabel="Gii →"
          caption="Each line with itself. Values above 1 indicate inbreeding / reduced heterozygosity relative to the base population."
        />
      </div>
    </section>
  );
}

function Chip({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const valueClass =
    tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5" title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 tnum text-lg font-semibold ${valueClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] leading-tight text-slate-400">{hint}</div>}
    </div>
  );
}

function DistChart({
  title,
  data,
  fill,
  xLabel,
  caption,
}: {
  title: string;
  data: Array<{ mid: number; count: number; label: string }>;
  fill: string;
  xLabel: string;
  caption: string;
}) {
  if (data.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold text-slate-600">{title}</h4>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 16 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              interval="preserveStartEnd"
              label={{ value: xLabel, position: "insideBottom", offset: -8, fontSize: 11, fill: "#64748b" }}
            />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={28} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "#f1f5f9" }}
              contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 11 }}
              formatter={(v) => [v as number, "pairs"]}
              labelFormatter={(l) => `≈ ${l}`}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{caption}</p>
    </div>
  );
}
