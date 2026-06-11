"use client";

import type { IndexRow } from "@/lib/types";

function prettyTrait(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SelectionTable({
  rows,
  traits,
  limit = 20,
}: {
  rows: IndexRow[];
  traits: string[];
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="max-h-[28rem] overflow-auto scroll-thin">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Genotype</th>
              <th className="px-3 py-2 text-right font-medium">Index</th>
              {traits.map((t) => (
                <th key={t} className="px-3 py-2 text-right font-medium">
                  {prettyTrait(t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.genotype}
                className="border-t border-slate-100 hover:bg-emerald-50/40"
              >
                <td className="px-3 py-2 tnum text-slate-400">{r.rank}</td>
                <td className="px-3 py-2 font-medium text-slate-800">
                  {r.genotype}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="tnum font-semibold text-emerald-700">
                    {Number(r.index).toFixed(3)}
                  </span>
                </td>
                {traits.map((t) => (
                  <td key={t} className="px-3 py-2 text-right tnum text-slate-600">
                    {Number(r[t]).toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
