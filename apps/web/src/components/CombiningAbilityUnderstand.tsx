"use client";

// Combining ability in the "Understand the trial" section: the topology the kernel detected + how it
// was modeled (decisions, variance components, Baker's ratio, cross-graph readiness). The selection
// itself (ranking + advancement) lives in the Selection section's Parents level — this is the science
// behind it.
import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import type { ResultBundle } from "@verdant/contracts";
import { getCombiningAbility } from "@/lib/ca";
import CaModelCard from "./CaModelCard";

export default function CombiningAbilityUnderstand({ bundle }: { bundle: ResultBundle }) {
  const ca = useMemo(() => getCombiningAbility(bundle), [bundle]);
  if (!ca) return null;
  const t = ca.topology;
  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/70 to-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-600 text-white"><Sparkles size={15} /></div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Combining ability</h3>
              <p className="text-[11px] text-slate-500">The trial decomposed into parental GCA + SCA — the basis of the Parents selection level.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip>{t.kind.replace("_", " × ")}</Chip>
            <span className="text-[11px] text-slate-500">{t.n_lines} lines × {t.n_testers} testers <span className="text-slate-400">(≈{t.eff_testers} eff.)</span></span>
            {t.pools.map((p) => (
              <span key={p.pool} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                <span className={`h-1.5 w-1.5 rounded-full ${p.pool === "A" ? "bg-sky-500" : "bg-violet-500"}`} /> {p.pool}·{p.n}
              </span>
            ))}
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">synthetic inbred data</span>
          </div>
        </div>
      </div>
      <CaModelCard ca={ca} />
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold capitalize text-white">{children}</span>;
}
