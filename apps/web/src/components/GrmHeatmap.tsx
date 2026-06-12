"use client";

// Genomic relationship matrix (GRM) heatmap — the realized covariance structure markers reveal.
// Clustered so family / heterotic-group blocks light up on the diagonal. Rendered to a <canvas>
// (one pixel-block per cell) because a ~100×100 grid of divs is too heavy. Diverging scale:
// ~0 → slate/white, related (+) → emerald, unrelated/negative (−) → rose.
import { useEffect, useRef } from "react";
import type { ResultBundle } from "@verdant/contracts";

type Heatmap = { ids?: string[]; values?: number[][] };
type Genomic = { heatmap?: Heatmap };

const SIZE = 420; // canvas square in px

// Map a relationship value to an [r,g,b]. Positive = emerald, negative = rose, ~0 = slate.
// Intensity ∝ |value|, clamped: relatedness saturates around 1.5, negatives around 0.5.
function color(v: number): [number, number, number] {
  if (v >= 0) {
    const a = Math.min(1, v / 1.5);
    // slate-100 (241,245,249) → emerald-600 (5,150,105)
    return [
      Math.round(241 + (5 - 241) * a),
      Math.round(245 + (150 - 245) * a),
      Math.round(249 + (105 - 249) * a),
    ];
  }
  const a = Math.min(1, -v / 0.5);
  // slate-100 → rose-600 (225,29,72)
  return [
    Math.round(241 + (225 - 241) * a),
    Math.round(245 + (29 - 245) * a),
    Math.round(249 + (72 - 249) * a),
  ];
}

export default function GrmHeatmap({ bundle }: { bundle: ResultBundle }) {
  const genomic = bundle.genomic as Genomic | undefined;
  const values = genomic?.heatmap?.values;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !values?.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const n = values.length;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const cell = SIZE / n;
    for (let i = 0; i < n; i++) {
      const row = values[i] ?? [];
      for (let j = 0; j < n; j++) {
        const v = row[j] ?? 0;
        const [r, g, b] = color(v);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        // ceil avoids hairline gaps between blocks
        ctx.fillRect(j * cell, i * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }, [values]);

  if (!values?.length) return null;
  const n = values.length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">Genomic relationship matrix</h3>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
        The realized relatedness the markers reveal — not the pedigree you assumed. Clustered so
        bright blocks on the diagonal are families / heterotic groups: lines that share a lot of
        their genome. This covariance structure is what genomic BLUP borrows strength across.
      </p>

      <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-end">
        <canvas
          ref={canvasRef}
          style={{ width: SIZE, height: SIZE, maxWidth: "100%" }}
          className="rounded-lg border border-slate-200"
          aria-label={`Genomic relationship matrix, ${n}×${n}`}
        />
        <div className="text-[11px] text-slate-400">
          <div className="mb-1 font-medium text-slate-500">relatedness</div>
          <div
            className="h-3 w-40 rounded-sm"
            style={{
              background:
                "linear-gradient(to right, rgb(225,29,72), rgb(241,245,249), rgb(5,150,105))",
            }}
          />
          <div className="mt-1 flex w-40 justify-between tnum">
            <span>−0.5</span>
            <span>0</span>
            <span>1.5</span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        Clustered genomic relationship matrix; the diagonal is each line with itself (~1–2, the
        hybrid/testcross heterozygosity signal). Down-sampled to ~{n} representative lines for
        display.
      </p>
    </section>
  );
}
