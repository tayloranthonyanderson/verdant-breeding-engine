"use client";
// The DATA-CUT BUILDER (ADR-0023). The breeder defines a cut directly: start from a template (a
// purpose × market that auto-assembles by trial tags), then tick/untick the exact trials, choose the
// market to rank on, name it, and SAVE it as a re-runnable preset. No germplasm tagging, no guessing —
// the breeder's judgement is the relevance model. Saved presets persist and re-run on current data.
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Layers, Target, Microscope, FlaskConical, RefreshCw, Boxes, Save, Bookmark, Trash2, Check } from "lucide-react";
import { saveAndRunCut, deleteCut, analyzeCut } from "@/app/actions";

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
export interface SavedCutCard { id: string; name: string; market: string; market_label: string; trialIds: string[]; n_geno: number; stages: string[]; years: number[] }

const PURPOSES: Array<{ id: "prediction" | "advancement"; label: string; hint: string }> = [
  { id: "prediction", label: "Prediction", hint: "Broad — pool every relevant trial across stages & years" },
  { id: "advancement", label: "Hybrid advancement", hint: "Narrow — the latest-stage advance/drop set" },
];

export default function DataCutPicker({
  cuts, catalog, markets, savedCuts, selected, composition, currentTrialIds, currentMarket,
}: {
  cuts: CutCard[]; catalog: CatalogTrial[]; markets: Array<{ id: string; label: string }>;
  savedCuts: SavedCutCard[]; selected: string; composition: Composition | null;
  currentTrialIds: string[]; currentMarket: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // The DRAFT being built: which trials are in, the market to rank on, and the name. Seeded from the
  // cut currently loaded; a template chip reseeds it; the checkboxes edit it.
  const [included, setIncluded] = useState<Set<string>>(() => new Set(currentTrialIds));
  const [market, setMarket] = useState<string>(currentMarket || markets[0]?.id || "");
  const [name, setName] = useState<string>("");

  const byId = useMemo(() => new Map(catalog.map((t) => [t.trial_id, t])), [catalog]);
  const draftTrials = useMemo(() => catalog.filter((t) => included.has(t.trial_id)), [catalog, included]);
  const draft = useMemo(() => ({
    n_trials: draftTrials.length,
    n_env: draftTrials.reduce((a, t) => a + t.n_loc, 0),
    stages: [...new Set(draftTrials.map((t) => t.stage))].sort(),
    years: [...new Set(draftTrials.map((t) => t.year))].sort(),
    entries: draftTrials.reduce((a, t) => a + t.n_entries, 0),
  }), [draftTrials]);

  const seedFromTemplate = (purpose: string, mkt: string) => {
    const tpl = cuts.find((c) => c.purpose === purpose && c.market === mkt);
    if (!tpl) return;
    setIncluded(new Set(tpl.trial_ids));
    setMarket(tpl.market);
  };
  const toggle = (id: string) => setIncluded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = () => {
    setErr(null);
    start(async () => {
      const res = await saveAndRunCut({ name, market, trialIds: [...included] });
      if (res.status === "error") { setErr(res.error); return; }
      router.push(`/?cut=${res.cutId}`);
    });
  };
  const load = (id: string) => router.push(`/?cut=${id}`);
  const rerun = (id: string, isSaved: boolean, def?: SavedCutCard) => {
    setBusy(id);
    start(async () => {
      if (isSaved && def) await saveAndRunCut({ name: def.name, market: def.market, trialIds: def.trialIds });
      else await analyzeCut(id);
      setBusy(null); router.refresh();
    });
  };
  const remove = (id: string) => { setBusy(id); start(async () => { await deleteCut(id); setBusy(null); if (selected === id) router.push("/"); else router.refresh(); }); };

  return (
    <section className="space-y-4">
      {/* Saved presets + templates — load or re-run an existing cut */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-50 text-amber-600"><Bookmark size={15} /></span>
          <h3 className="text-sm font-semibold text-slate-800">Your data cuts</h3>
          <span className="text-[11px] text-slate-400">saved presets re-run on current data · templates are starting points</span>
        </div>
        {savedCuts.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Saved presets</div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {savedCuts.map((c) => (
                <li key={c.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${selected === c.id ? "border-emerald-400 bg-emerald-50/60" : "border-slate-200"}`}>
                  <button type="button" onClick={() => load(c.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium text-slate-800">{c.name}</div>
                    <div className="truncate text-[11px] text-slate-500">{c.market_label} · {c.trialIds.length} trials · {c.stages.join("+")} · {c.n_geno} geno</div>
                  </button>
                  <button type="button" title="Re-run on current data" onClick={() => rerun(c.id, true, c)} disabled={pending} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 disabled:opacity-50"><RefreshCw size={13} className={busy === c.id ? "animate-spin" : ""} /></button>
                  <button type="button" title="Delete preset" onClick={() => remove(c.id)} disabled={pending} className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Templates</div>
          <div className="flex flex-wrap gap-1.5">
            {cuts.map((c) => (
              <button key={c.id} type="button" onClick={() => load(c.id)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${selected === c.id ? "border-emerald-400 bg-emerald-600 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300"}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The BUILDER — define a cut directly */}
      <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Layers size={15} /></span>
          <h3 className="text-sm font-semibold text-slate-800">Build a data cut</h3>
          <span className="text-[11px] text-slate-400">start from a template, then tick the exact trials you want</span>
        </div>

        {/* seed from a template */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {PURPOSES.map((p) => (
            <button key={p.id} type="button" onClick={() => seedFromTemplate(p.id, market)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-emerald-300">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800"><Microscope size={12} className="text-slate-400" /> Seed: {p.label}</div>
              <div className="text-[11px] text-slate-500">{p.hint}</div>
            </button>
          ))}
        </div>

        {/* market to rank on */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Target size={12} /> Rank on market</span>
          {markets.map((mk) => (
            <button key={mk.id} type="button" onClick={() => setMarket(mk.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${market === mk.id ? "border-emerald-400 bg-emerald-600 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300"}`}>
              {mk.label}
            </button>
          ))}
        </div>

        {/* live draft composition */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[12px] text-slate-600">
          <Stat label="trials" value={draft.n_trials} />
          <Stat label="environments" value={draft.n_env} />
          <Stat label="stages" value={draft.stages.join("+") || "—"} />
          <Stat label="years" value={draft.years.join("/") || "—"} />
          <span className="text-[11px] text-slate-400">{draft.stages.length > 1 ? "spans the funnel → a broad, prediction-style cut" : draft.n_trials ? "single stage → a narrow, decision-style cut" : "pick some trials below"}</span>
        </div>

        {/* trial catalog with checkboxes — the actual selection */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-2 font-medium" />
                <th className="py-1.5 pr-3 font-medium">Trial</th>
                <th className="py-1.5 pr-3 font-medium">Stage</th>
                <th className="py-1.5 pr-3 font-medium">Year</th>
                <th className="py-1.5 pr-3 font-medium">TPE</th>
                <th className="py-1.5 pr-3 font-medium">Tag</th>
                <th className="py-1.5 pr-3 font-medium">Entries</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((t) => {
                const on = included.has(t.trial_id);
                return (
                  <tr key={t.trial_id} className={`cursor-pointer border-t border-slate-100 ${on ? "bg-emerald-50/50" : "hover:bg-slate-50"}`} onClick={() => toggle(t.trial_id)}>
                    <td className="py-1.5 pr-2">
                      <span className={`grid h-4 w-4 place-items-center rounded border ${on ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white"}`}>{on && <Check size={11} />}</span>
                    </td>
                    <td className="py-1.5 pr-3 font-medium text-slate-800"><FlaskConical size={11} className="mr-1 inline text-slate-400" />{t.trial_id}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{t.stage} · {t.stage_label}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{t.year}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{t.tpe}</td>
                    <td className="py-1.5 pr-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{t.market_tag}</span></td>
                    <td className="py-1.5 pr-3 text-slate-600">{t.n_entries} · {t.n_loc}loc×{t.n_rep}rep</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* name + save */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this cut, e.g. “CA processing training set 2024–25”"
            className="min-w-[260px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400" />
          <button type="button" onClick={save} disabled={pending || !included.size || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40">
            {pending ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} {pending ? "Building & saving…" : "Save & run"}
          </button>
        </div>
        {err && <p className="mt-2 text-[12px] text-rose-600">{err}</p>}
        <p className="mt-2 text-[11px] text-slate-400">
          A line&rsquo;s markets are derived from the trials it appears in — germplasm is never tagged. Saving fits the cut now and stores it as a
          preset you can re-run on current data later.
        </p>
      </div>

      {/* what's currently loaded */}
      {composition && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500"><Boxes size={15} /></span>
            <h3 className="text-sm font-semibold text-slate-800">Now viewing</h3>
            <span className="text-[11px] text-slate-400">the analysis below is computed on this cut</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
            <span className="font-medium text-slate-800">{savedCuts.find((c) => c.id === selected)?.name ?? cuts.find((c) => c.id === selected)?.label ?? selected}</span>
            <Stat label="trials" value={composition.n_trials} />
            <Stat label="stages" value={composition.stages.join("+")} />
            <Stat label="years" value={composition.years.join("/")} />
            <Stat label="genotypes" value={composition.n_geno} />
            <Stat label="environments" value={composition.n_env} />
            <Stat label="plots" value={composition.n_obs} />
            <Stat label="checks" value={composition.n_checks} />
          </div>
        </div>
      )}
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
