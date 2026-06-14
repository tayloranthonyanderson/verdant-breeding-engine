// The selection ranking for a data cut: the market's transparent weighted index over the cut's BLUPs,
// the weights it used, and how far the genetically-aware (desired-gains) index disagrees — the same
// transparent-vs-genetic insight as the G2F path, here scoped to whatever cut the breeder chose.
import type { ResultBundle } from "@verdant/contracts";
import { Trophy, Scale } from "lucide-react";

const isCheck = (g: string) => g.startsWith("CHK-");

export default function CutRanking({ bundle }: { bundle: ResultBundle }) {
  const weighted = bundle.indices?.find((i) => i.kind === "weighted");
  const genetic = bundle.indices?.find((i) => i.kind === "desired_gains" || i.kind === "smith_hazel");
  if (!weighted) return null;
  const geneticRank = new Map((genetic?.ranking ?? []).map((r) => [r.germplasm_id, r.rank]));
  const top = weighted.ranking.slice(0, 12);
  const div = bundle.divergence;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Trophy size={15} /></span>
          <h3 className="text-sm font-semibold text-slate-800">Top candidates for this market</h3>
          <span className="text-[11px] text-slate-400">ranked on the cut&rsquo;s BLUPs by the market objective</span>
        </div>

        {weighted.weights_used && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {weighted.weights_used.map((w) => (
              <span key={w.variable_id} className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
                <Scale size={10} className="text-slate-400" />{w.variable_id} <b className={w.mode === "min" ? "text-rose-500" : "text-emerald-600"}>{w.mode === "min" ? "↓" : "↑"}{w.weight}</b>
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-3 font-medium">#</th>
                <th className="py-1.5 pr-3 font-medium">Genotype</th>
                <th className="py-1.5 pr-3 font-medium">Index score</th>
                <th className="py-1.5 pr-3 font-medium">Genetic-index rank</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => {
                const gr = geneticRank.get(r.germplasm_id);
                const delta = gr != null ? gr - r.rank : null;
                return (
                  <tr key={r.germplasm_id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 font-semibold text-slate-700">{r.rank}</td>
                    <td className="py-1.5 pr-3 font-medium text-slate-800">
                      {r.germplasm_id}{isCheck(r.germplasm_id) && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">check</span>}
                    </td>
                    <td className="tnum py-1.5 pr-3 text-slate-600">{r.score?.toFixed(3) ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-slate-600">
                      {gr != null ? (
                        <span>#{gr}{delta ? <span className={`ml-1 text-[11px] ${delta > 0 ? "text-rose-500" : "text-emerald-600"}`}>({delta > 0 ? "+" : ""}{delta})</span> : <span className="ml-1 text-[11px] text-slate-400">(=)</span>}</span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {div && (
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[12px] text-slate-600">
            Transparent vs genetically-aware index: rank correlation <b className="tnum">{div.rank_correlation?.toFixed(2) ?? "—"}</b>
            {(div.notable_movers ?? []).length > 0 && <> — biggest movers when accounting for how the traits co-inherit: {(div.notable_movers ?? []).slice(0, 4).map((m) => m?.germplasm_id).filter(Boolean).join(", ")}.</>}
          </p>
        )}
      </div>
    </section>
  );
}
