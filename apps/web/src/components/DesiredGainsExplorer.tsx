"use client";

// Genetically-aware desired-gains index (ADR-0006), made interactive. The breeder sets the desired
// genetic gain per trait (in genetic-SD units); the engine derives the selection weights
// b = G⁻¹(d·σ) — accounting for how the traits co-inherit (G) — and ranks genotypes by b·BLUP.
//
// Like the transparent index, this recomputes LIVE in the browser: b = G⁻¹(d·σ) is a tiny solve, so
// dragging a desired-gain slider instantly re-derives the weights, re-ranks, and updates the
// divergence from the transparent index — the first-class insight ("your stated priorities rank X;
// achieving those gains given co-inheritance ranks Y"). G is reconstructed from the bundle's genetic
// correlation matrix + per-trait genetic_sd, so this stays numerically identical to the R seed.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowDown, GitCompareArrows } from "lucide-react";
import type { ResultBundle } from "@verdant/contracts";

const TABLE_N = 20;

function label(id: string) {
  return id.replace(/_Mg_ha$/i, "").replace(/_cm$/i, "").replace(/_/g, " ");
}

// Solve A x = rhs for small symmetric A (Gaussian elimination, partial pivoting).
function solve(A: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const M = A.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

export default function DesiredGainsExplorer({
  bundle,
  segmentId,
  onRankingChange,
}: {
  bundle: ResultBundle;
  segmentId?: string | null;
  onRankingChange?: (ranking: Array<{ germplasm_id: string; rank: number }>) => void;
}) {
  const gc = bundle.genetic_correlations;
  // The desired-gains + transparent indices for the active Segment (advancement target); fall back to
  // the first of each kind for single-segment bundles.
  const inSeg = (k: string) => (i: NonNullable<ResultBundle["indices"]>[number]) =>
    i.kind === k && (!segmentId || i.segment_id === segmentId);
  const seed = bundle.indices?.find(inSeg("desired_gains")) ?? bundle.indices?.find((i) => i.kind === "desired_gains");
  const transparent = bundle.indices?.find(inSeg("weighted")) ?? bundle.indices?.find((i) => i.kind === "weighted");

  // Only renders for a multi-trait bundle that carries G + a desired-gains seed.
  const pre = useMemo(() => {
    const traitIds = gc?.variable_ids;
    const C = gc?.matrix as number[][] | undefined;
    if (!traitIds?.length || !C?.length || !seed || !transparent) return null;
    const n = traitIds.length;
    const sigma = traitIds.map((id) => bundle.traits.find((t) => t.variable_id === id)?.genetic_sd ?? 1);
    // G = diag(σ) · Corr · diag(σ)
    const G = C.map((row, i) => row.map((c, j) => (c ?? 0) * (sigma[i] ?? 1) * (sigma[j] ?? 1)));
    // BLUPs aligned to traitIds
    const blup: Record<string, number[]> = {};
    const genoSet = new Set<string>();
    traitIds.forEach((id, j) => {
      const eff = bundle.traits.find((t) => t.variable_id === id)?.effects ?? [];
      for (const e of eff) {
        if (!blup[e.germplasm_id]) blup[e.germplasm_id] = Array(n).fill(0);
        if (e.value != null) blup[e.germplasm_id][j] = e.value;
        genoSet.add(e.germplasm_id);
      }
    });
    const genos = [...genoSet];
    const transRank = new Map((transparent.ranking ?? []).map((r) => [r.germplasm_id, r.rank]));
    const seedD = traitIds.map((id) => (seed.weights_used?.find((w) => w.variable_id === id)?.weight ?? 0));
    return { traitIds, n, sigma: sigma as number[], G, blup, genos, transRank, seedD };
  }, [bundle, gc, seed, transparent]);

  const [gains, setGains] = useState<number[]>(() => pre?.seedD ?? []);

  const result = useMemo(() => {
    if (!pre) return null;
    const { traitIds, G, blup, genos, transRank, sigma } = pre;
    const rhs = gains.map((g, j) => g * sigma[j]); // d (SD units) → raw-unit gains
    const b = solve(G, rhs); // b = G⁻¹(d·σ)
    const scored = genos.map((g) => {
      const v = blup[g];
      let s = 0;
      for (let j = 0; j < b.length; j++) s += b[j] * (v[j] ?? 0);
      return { g, score: s };
    });
    scored.sort((a, z) => z.score - a.score);
    const ranking = scored.map((r, i) => ({ ...r, rank: i + 1 }));
    const genRank = new Map(ranking.map((r) => [r.g, r.rank]));

    // divergence vs the transparent ranking: Spearman (Pearson on ranks) + biggest movers
    const common = ranking.filter((r) => transRank.has(r.g));
    const xs = common.map((r) => transRank.get(r.g)!);
    const ys = common.map((r) => r.rank);
    const rho = pearson(xs, ys);
    const movers = common
      .map((r) => ({ g: r.g, from: transRank.get(r.g)!, to: r.rank, delta: transRank.get(r.g)! - r.rank }))
      .sort((a, z) => Math.abs(z.delta) - Math.abs(a.delta))
      .slice(0, 8);
    return { traitIds, ranking, b, rho, movers, blup, genRank };
  }, [pre, gains]);

  // report the live ranking up for the Compare lens (ref keeps the callback out of effect deps)
  const cbRef = useRef(onRankingChange);
  cbRef.current = onRankingChange;
  useEffect(() => {
    if (result) cbRef.current?.(result.ranking.map((r) => ({ germplasm_id: r.g, rank: r.rank })));
  }, [result]);

  if (!pre || !result) return null;
  const { traitIds, ranking, b } = result;

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
          <GitCompareArrows size={18} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Genetically-aware index — desired gains</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
            Set the genetic gain you want per trait (in genetic-SD units). The engine derives the
            selection weights <span className="font-mono">b = G⁻¹(d·σ)</span> — accounting for how the
            traits co-inherit — and ranks on <span className="font-mono">b·BLUP</span>. Where this
            disagrees with the transparent index is the insight. Index is centered (0 = trial average).
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-5">
        {/* controls + derived weights + divergence */}
        <div className="space-y-4 xl:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-xs font-semibold text-slate-700">Desired gains (genetic-SD)</div>
            <div className="space-y-3">
              {traitIds.map((id, j) => {
                const up = gains[j] >= 0;
                return (
                  <div key={id}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-slate-700">
                        {up ? <ArrowUp size={12} className="text-emerald-600" /> : <ArrowDown size={12} className="text-rose-600" />}
                        {label(id)}
                      </span>
                      <span className="tnum font-semibold text-slate-900">{gains[j].toFixed(1)}</span>
                    </div>
                    <input
                      type="range" min={-2} max={2} step={0.1} value={gains[j]}
                      onChange={(e) => { const v = [...gains]; v[j] = Number(e.target.value); setGains(v); }}
                      className="mt-1 w-full accent-indigo-600"
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-3 border-t border-slate-100 pt-2">
              <div className="text-[11px] text-slate-400">Derived selection weights (b = G⁻¹(d·σ)):</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {traitIds.map((id, j) => (
                  <span key={id} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] tnum text-indigo-700">
                    {label(id)} {b[j] >= 0 ? "+" : ""}{b[j].toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* divergence lives in the Compare lens now (keeps this lens focused) */}
        </div>

        {/* ranking */}
        <div className="xl:col-span-3">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Genotype</th>
                  <th className="px-3 py-2 text-right font-medium">Index</th>
                  <th className="px-3 py-2 text-right font-medium">Transparent #</th>
                </tr>
              </thead>
              <tbody>
                {ranking.slice(0, TABLE_N).map((r) => {
                  const tr = pre.transRank.get(r.g);
                  const moved = tr != null ? tr - r.rank : 0;
                  return (
                    <tr key={r.g} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2 tnum text-slate-400">{r.rank}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{r.g}</td>
                      <td className="px-3 py-2 text-right tnum font-semibold text-slate-900">{r.score.toFixed(3)}</td>
                      <td className="px-3 py-2 text-right tnum text-slate-500">
                        {tr ?? "—"}
                        {moved !== 0 && (
                          <span className={`ml-1 ${moved > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                            {moved > 0 ? `▲${moved}` : `▼${-moved}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
              Top {Math.min(TABLE_N, ranking.length)} of {ranking.length} · genetically-aware desired-gains index
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 1;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 1;
}
