"use client";

import type { Bundle } from "@/lib/types";

function prettyTrait(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function band(h: number) {
  if (h >= 0.7) return { label: "high", color: "text-emerald-700", bar: "bg-emerald-500" };
  if (h >= 0.4) return { label: "moderate", color: "text-amber-700", bar: "bg-amber-500" };
  return { label: "low", color: "text-rose-700", bar: "bg-rose-500" };
}

export default function HeritabilityCards({ bundle }: { bundle: Bundle }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {bundle.traits.map((t) => {
        const h = bundle.heritability[t];
        const valid = typeof h === "number" && !Number.isNaN(h);
        const b = band(valid ? h : 0);
        return (
          <div
            key={t}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {prettyTrait(t)}
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="tnum text-2xl font-semibold text-slate-900">
                {valid ? h.toFixed(2) : "—"}
              </span>
              <span className={`text-xs font-medium ${b.color}`}>
                h² {valid ? b.label : ""}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${b.bar} transition-all`}
                style={{ width: `${Math.max(0, Math.min(1, valid ? h : 0)) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
