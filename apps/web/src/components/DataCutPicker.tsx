"use client";
// The DATA-CUT picker (ADR-0023). The breeder chooses a PURPOSE (predict broad / advance narrow) and a
// MARKET; the system assembles the cut from trial tags — no per-trial checkboxes, no germplasm tagging.
// Shows what the cut is made of, lets you see ALL the data (the full trial catalog, in/out of the cut),
// and re-runs the analysis on the chosen cut. Selecting navigates ?cut=<id>; the page loads that
// cut's analysis.
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Layers, Target, Microscope, FlaskConical, RefreshCw, Boxes, ArrowRight } from "lucide-react";
import { analyzeCut } from "@/app/actions";

export interface CutCard {
  id: string; purpose: "prediction" | "advancement"; market: string; market_label: string;
  label: string; blurb: string; tpe: string; trial_ids: string[]; stages: string[]; years: number[]; n_trials: number;
}
export interface CatalogTrial {
  trial_id: string; stage: string; stage_label: string; year: number; tpe: string;
  market_tag: string; n_entries: number; n_loc: number; n_rep: number; design: string;
}
export interface Composition {
  n_geno: number; n_env: number; n_obs: number; n_checks: number; n_trials: number; stages: string[]; years: number[];
}

const PURPOSES: Array<{ id: "prediction" | "advancement"; label: string; hint: string }> = [
  { id: "prediction", label: "Prediction", hint: "Broad — pool every relevant trial across stages & years (training data)" },
  { id: "advancement", label: "Hybrid advancement", hint: "Narrow — the latest-stage advance/drop decision set" },
];

export default function DataCutPicker({
  cuts, catalog, selected, composition,
}: { cuts: CutCard[]; catalog: CatalogTrial[]; selected: string; composition: Composition | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = cuts.find((c) => c.id === selected) ?? cuts[0];
  const markets = Array.from(new Map(cuts.map((c) => [c.market, c.market_label])).entries());
  const inCut = new Set(active?.trial_ids ?? []);

  const go = (purpose: string, market: string) => {
    const next = cuts.find((c) => c.purpose === purpose && c.market === market);
    if (next && next.id !== selected) router.push(`/?cut=${next.id}`);
  };
  const rerun = () => start(async () => { await analyzeCut(active.id); router.refresh(); });

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Layers size={15} /></span>
          <h3 className="text-sm font-semibold text-slate-800">Choose a data cut</h3>
          <span className="text-[11px] text-slate-400">Trials are tagged by market; you pick the question, the cut assembles itself.</span>
        </div>

        {/* purpose */}
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Microscope size={12} /> Purpose</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {PURPOSES.map((p) => (
              <button key={p.id} type="button" onClick={() => go(p.id, active.market)}
                className={`rounded-xl border px-3 py-2 text-left transition ${active?.purpose === p.id ? "border-emerald-400 bg-emerald-50/60 ring-1 ring-emerald-200" : "border-slate-200 bg-white hover:border-emerald-300"}`}>
                <div className="text-sm font-medium text-slate-800">{p.label}</div>
                <div className="text-[11px] text-slate-500">{p.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* market */}
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Target size={12} /> Target market</div>
          <div className="inline-flex flex-wrap gap-1.5">
            {markets.map(([m, label]) => (
              <button key={m} type="button" onClick={() => go(active.purpose, m)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${active?.market === m ? "border-emerald-400 bg-emerald-600 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* composition of the chosen cut */}
        {composition && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
              <span className="font-medium text-slate-800">{active.label}</span>
              <Stat label="trials" value={composition.n_trials} />
              <Stat label="stages" value={composition.stages.join("+")} />
              <Stat label="years" value={composition.years.join("/")} />
              <Stat label="genotypes" value={composition.n_geno} />
              <Stat label="environments" value={composition.n_env} />
              <Stat label="plots" value={composition.n_obs} />
              <Stat label="checks" value={composition.n_checks} />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">{active.blurb}</p>
            <button type="button" onClick={rerun} disabled={pending}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50">
              <RefreshCw size={11} className={pending ? "animate-spin" : ""} /> {pending ? "Re-running the fit…" : "Re-run analysis on this cut"}
            </button>
          </div>
        )}
      </div>

      {/* see ALL the data — the full trial catalog, with the current cut highlighted */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500"><Boxes size={15} /></span>
          <h3 className="text-sm font-semibold text-slate-800">All trials in the program</h3>
          <span className="text-[11px] text-slate-400">{catalog.length} trials · highlighted = in the current cut</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-3 font-medium">Trial</th>
                <th className="py-1.5 pr-3 font-medium">Stage</th>
                <th className="py-1.5 pr-3 font-medium">Year</th>
                <th className="py-1.5 pr-3 font-medium">TPE</th>
                <th className="py-1.5 pr-3 font-medium">Market tag</th>
                <th className="py-1.5 pr-3 font-medium">Entries</th>
                <th className="py-1.5 pr-3 font-medium">Design</th>
                <th className="py-1.5 pr-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {catalog.map((t) => {
                const on = inCut.has(t.trial_id);
                return (
                  <tr key={t.trial_id} className={`border-t border-slate-100 ${on ? "bg-emerald-50/50" : "opacity-60"}`}>
                    <td className="py-1.5 pr-3 font-medium text-slate-800"><FlaskConical size={11} className="mr-1 inline text-slate-400" />{t.trial_id}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{t.stage} · {t.stage_label}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{t.year}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{t.tpe}</td>
                    <td className="py-1.5 pr-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{t.market_tag}</span></td>
                    <td className="py-1.5 pr-3 text-slate-600">{t.n_entries} · {t.n_loc}loc×{t.n_rep}rep</td>
                    <td className="py-1.5 pr-3 text-slate-500">{t.design}</td>
                    <td className="py-1.5 pr-3 text-right">{on && <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600">in cut <ArrowRight size={10} /></span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Early stages are tagged broadly (<b>All</b>) so they feed every market; advanced stages carry a TPE tag. A market&rsquo;s prediction
          cut pulls every trial tagged with it or an ancestor; its advancement cut takes only the latest stage. Germplasm is never tagged —
          a line&rsquo;s markets are derived from the trials it appears in.
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <b className="tnum text-slate-800">{value}</b>
      <span className="text-[11px] text-slate-400">{label}</span>
    </span>
  );
}
