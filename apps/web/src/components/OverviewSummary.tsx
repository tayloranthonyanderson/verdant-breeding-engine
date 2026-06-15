// At-a-glance summary of a cut/trial: the shape of the data + the headline calls. Works pre-fit (the
// preview bundle has no traits yet) by falling back to data_readiness.scale for the counts.
import type { ResultBundle } from "@verdant/contracts";
import { getCombiningAbility } from "@/lib/ca";

function relLabel(r: string) {
  return ({ identity: "Identity", A: "Pedigree (A)", G: "Genomic (G)", H: "Single-step (H)" } as Record<string, string>)[r] ?? r;
}

export default function OverviewSummary({ bundle, studyName }: { bundle: ResultBundle; studyName: string | null }) {
  const ca = getCombiningAbility(bundle);
  const scale = (bundle.data_readiness?.scale ?? {}) as { n_env?: number; n_geno?: number };
  const nGeno = bundle.traits[0]?.effects.length || scale.n_geno || 0;
  const nEnv = scale.n_env ?? null;
  const nTraits = bundle.traits.length || ((bundle.data_readiness?.scale as { n_traits?: number } | undefined)?.n_traits ?? 0);
  const nFindings = bundle.data_quality?.summary?.n_findings ?? null;
  const stats: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Trial", value: studyName ?? "—", sub: `${nTraits} traits${nEnv ? ` · ${nEnv} environments` : ""}` },
    { label: "Genotypes", value: nGeno.toLocaleString(), sub: "in this cut" },
    { label: "Data quality", value: nFindings == null ? "—" : nFindings === 0 ? "Clean" : `${nFindings} finding${nFindings === 1 ? "" : "s"}`, sub: nFindings ? "review below" : "no issues flagged" },
    { label: "Relationship", value: relLabel(bundle.chosen_model.relationship), sub: "breeding-value model" },
  ];
  if (ca) stats.push({ label: "Combining ability", value: ca.topology.kind.replace("_", " × "), sub: `${ca.topology.n_lines} lines` });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{s.label}</div>
          <div className="mt-1 truncate text-lg font-semibold capitalize text-slate-900" title={s.value}>{s.value}</div>
          {s.sub && <div className="text-[11px] text-slate-400">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}
