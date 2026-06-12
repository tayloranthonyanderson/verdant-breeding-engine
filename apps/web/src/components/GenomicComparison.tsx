"use client";

// The headline "is genomic prediction worth it?" panel (M6). Cross-validated predictive ability per
// trait under three relationship models: identity (no borrowing), pedigree A (borrow from relatives),
// genomic G (markers). G beating A is the proof that markers capture within-family Mendelian sampling
// — the variation pedigree can't see — so we can rank un-phenotyped lines. The contract types
// `genomic` loosely (additionalProperties); we cast to the known runtime shape here.
import { useMemo } from "react";
import { Dna } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ResultBundle } from "@verdant/contracts";

type ModelRow = {
  trait: string;
  model: "identity" | "pedigree_A" | "genomic_G";
  predictive_ability: number;
  dispersion: number;
  n_test: number;
};
type Genomic = {
  cohort_n?: number;
  n_markers?: number;
  model_comparison?: ModelRow[];
};

const MODEL_META = [
  { key: "identity", label: "Identity", color: "#cbd5e1" }, // slate-300
  { key: "pedigree_A", label: "Pedigree (A)", color: "#818cf8" }, // indigo-400
  { key: "genomic_G", label: "Genomic (G)", color: "#10b981" }, // emerald-500
] as const;

function traitLabel(id: string) {
  return id.replace(/_Mg_ha$/i, "").replace(/_cm$/i, "").replace(/_/g, " ");
}

export default function GenomicComparison({ bundle }: { bundle: ResultBundle }) {
  const genomic = bundle.genomic as Genomic | null | undefined;
  const rows = genomic?.model_comparison;

  const { data, avgGain, dispersionG } = useMemo(() => {
    if (!rows?.length) return { data: [], avgGain: null as number | null, dispersionG: null as number | null };
    // pivot to one row per trait, columns per model
    const byTrait = new Map<string, Record<string, ModelRow>>();
    for (const r of rows) {
      if (!r?.trait || !r?.model) continue;
      const m = byTrait.get(r.trait) ?? {};
      m[r.model] = r;
      byTrait.set(r.trait, m);
    }
    const pivoted = [...byTrait.entries()].map(([trait, m]) => ({
      trait,
      label: traitLabel(trait),
      identity: m.identity?.predictive_ability ?? null,
      pedigree_A: m.pedigree_A?.predictive_ability ?? null,
      genomic_G: m.genomic_G?.predictive_ability ?? null,
    }));

    const gains = pivoted
      .filter((p) => p.genomic_G != null && p.pedigree_A != null)
      .map((p) => (p.genomic_G as number) - (p.pedigree_A as number));
    const gain = gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : null;

    const gDisp = rows.filter((r) => r.model === "genomic_G").map((r) => r.dispersion).filter((d) => Number.isFinite(d));
    const disp = gDisp.length ? gDisp.reduce((a, b) => a + b, 0) / gDisp.length : null;

    return { data: pivoted, avgGain: gain, dispersionG: disp };
  }, [rows]);

  if (!rows?.length || data.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Dna size={16} className="text-emerald-600" />
        <h3 className="text-sm font-semibold text-slate-700">Does genomic prediction add value?</h3>
      </div>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
        Cross-validated predictive ability (correlation between predicted and observed in held-out
        lines) under three relationship models. <span className="font-medium text-slate-400">Identity</span>{" "}
        can't predict an un-phenotyped line at all. <span className="font-medium text-indigo-500">Pedigree (A)</span>{" "}
        borrows from relatives. <span className="font-medium text-emerald-600">Genomic (G)</span> beats
        pedigree because markers capture within-family Mendelian sampling — which sibs inherited the
        good alleles — that the pedigree treats as identical.
      </p>

      {avgGain != null && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="tnum text-2xl font-bold text-emerald-600">
            {avgGain >= 0 ? "+" : ""}
            {avgGain.toFixed(3)}
          </span>
          <span className="text-xs text-slate-500">
            average gain in predictive ability, genomic over pedigree (G − A){" "}
            {avgGain > 0 ? "— markers are pulling their weight" : "— markers add little here"}
          </span>
        </div>
      )}

      <div className="mt-4 h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 18 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={{ stroke: "#e2e8f0" }}
            />
            <YAxis
              domain={[0, 0.8]}
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              width={40}
              label={{
                value: "predictive ability (CV r)",
                angle: -90,
                position: "insideLeft",
                fontSize: 11,
                fill: "#64748b",
                style: { textAnchor: "middle" },
              }}
            />
            <Tooltip
              cursor={{ fill: "#f8fafc" }}
              formatter={(v) => (typeof v === "number" ? v.toFixed(3) : v)}
              contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
            {MODEL_META.map((m) => (
              <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        {genomic?.cohort_n != null && genomic?.n_markers != null && (
          <span>
            <span className="tnum text-slate-500">{genomic.cohort_n.toLocaleString()}</span> hybrids ×{" "}
            <span className="tnum text-slate-500">{genomic.n_markers.toLocaleString()}</span> markers
          </span>
        )}
        {dispersionG != null && (
          <span>
            genomic dispersion <span className="tnum text-slate-500">{dispersionG.toFixed(2)}</span>{" "}
            {Math.abs(dispersionG - 1) < 0.15 ? "≈ 1 (well-calibrated)" : "(off 1 = mis-scaled)"}
          </span>
        )}
      </div>
    </section>
  );
}
