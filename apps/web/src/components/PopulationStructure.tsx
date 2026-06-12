"use client";

// Population structure recovered from markers (M6): PC1 vs PC2 of the genomic relationship matrix,
// each point a genotype, colored by family/group (the kernel's grouping label, e.g. a shared parent).
// Clusters = related groups (families / sub-populations); a dominant PC1 means one axis of relatedness
// dominates (e.g. a shared parent or a major population split). Crop-agnostic — works for any program's
// germplasm. The contract types `genomic` loosely; we cast to the known runtime shape.
import { useMemo } from "react";
import { Network } from "lucide-react";
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { ResultBundle } from "@verdant/contracts";

type Coord = { id: string; pc1: number; pc2: number; pc3?: number; family: string };
type Pca = { var_explained?: number[]; coords?: Coord[] };
type Genomic = { pca?: Pca | null };

// Stable, distinguishable palette for the top families; everything else collapses to grey.
const FAMILY_COLORS = [
  "#10b981", // emerald-500
  "#6366f1", // indigo-500
  "#f59e0b", // amber-500
  "#ec4899", // pink-500
  "#06b6d4", // cyan-500
  "#8b5cf6", // violet-500
];
const OTHER_COLOR = "#cbd5e1"; // slate-300
const OTHER_KEY = "other";

const MAX_FAMILIES = 6;

export default function PopulationStructure({ bundle }: { bundle: ResultBundle }) {
  const genomic = bundle.genomic as Genomic | null | undefined;
  const pca = genomic?.pca;

  const { points, legend, varPc1, varPc2, dominant } = useMemo(() => {
    const coords = pca?.coords;
    if (!coords?.length) {
      return { points: [] as Array<Coord & { fill: string; familyGroup: string }>, legend: [], varPc1: null as number | null, varPc2: null as number | null, dominant: false };
    }

    // rank families by count, keep the top MAX_FAMILIES, collapse the rest
    const counts = new Map<string, number>();
    for (const c of coords) {
      const fam = c.family ?? "unknown";
      counts.set(fam, (counts.get(fam) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, MAX_FAMILIES).map(([fam]) => fam);
    const colorFor = new Map<string, string>();
    top.forEach((fam, i) => colorFor.set(fam, FAMILY_COLORS[i % FAMILY_COLORS.length]));
    const hasOther = ranked.length > top.length;

    const pts = coords
      .filter((c) => Number.isFinite(c.pc1) && Number.isFinite(c.pc2))
      .map((c) => {
        const fam = c.family ?? "unknown";
        const grouped = colorFor.has(fam) ? fam : OTHER_KEY;
        return {
          ...c,
          familyGroup: grouped,
          fill: grouped === OTHER_KEY ? OTHER_COLOR : colorFor.get(fam)!,
        };
      });

    const leg = [
      ...top.map((fam) => ({ key: fam, label: fam, color: colorFor.get(fam)!, count: counts.get(fam)! })),
      ...(hasOther
        ? [{ key: OTHER_KEY, label: "other", color: OTHER_COLOR, count: ranked.slice(MAX_FAMILIES).reduce((a, [, n]) => a + n, 0) }]
        : []),
    ];

    const ve = pca?.var_explained ?? [];
    const v1 = ve[0] != null ? ve[0] : null;
    const v2 = ve[1] != null ? ve[1] : null;
    // var_explained may be a fraction (0–1) or already a percent; normalize to fraction for the test.
    const v1frac = v1 != null && v1 > 1 ? v1 / 100 : v1;

    return { points: pts, legend: leg, varPc1: v1, varPc2: v2, dominant: v1frac != null && v1frac >= 0.35 };
  }, [pca]);

  if (!pca || points.length === 0) return null;

  const pctLabel = (v: number | null) => (v == null ? "" : ` (${Math.round(v > 1 ? v : v * 100)}%)`);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Network size={16} className="text-indigo-500" />
        <h3 className="text-sm font-semibold text-slate-700">Population structure</h3>
      </div>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
        The first two principal components of the genomic relationship matrix — the relatedness and
        population structure of your germplasm, recovered purely from markers. Tight clusters are
        related groups (families or sub-populations).{" "}
        {dominant
          ? "A dominant PC1 here means one axis of relatedness explains most of the structure — often a shared parent or a major population split."
          : "No single axis dominates, so relatedness is spread across several directions."}
      </p>

      <div className="mt-4 h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 18 }}>
            <CartesianGrid stroke="#f1f5f9" />
            <XAxis
              type="number"
              dataKey="pc1"
              name="PC1"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={{ stroke: "#e2e8f0" }}
              label={{ value: `PC1${pctLabel(varPc1)}`, position: "insideBottom", offset: -8, fontSize: 11, fill: "#64748b" }}
            />
            <YAxis
              type="number"
              dataKey="pc2"
              name="PC2"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              width={40}
              label={{ value: `PC2${pctLabel(varPc2)}`, angle: -90, position: "insideLeft", fontSize: 11, fill: "#64748b", style: { textAnchor: "middle" } }}
            />
            <ZAxis range={[26, 26]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as (Coord & { familyGroup: string }) | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-[10px] border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm">
                    <div className="font-medium text-slate-700">{p.id}</div>
                    <div className="text-slate-500">family: {p.family ?? "unknown"}</div>
                    <div className="tnum text-slate-400">
                      PC1 {p.pc1.toFixed(2)} · PC2 {p.pc2.toFixed(2)}
                    </div>
                  </div>
                );
              }}
            />
            <Scatter data={points} fillOpacity={0.8}>
              {points.map((p) => (
                <Cell key={p.id} fill={p.fill} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-400">
        {legend.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
            <span className="text-slate-500">{l.label}</span>
            <span className="tnum">({l.count})</span>
          </span>
        ))}
      </div>
    </section>
  );
}
