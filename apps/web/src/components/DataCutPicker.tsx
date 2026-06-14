"use client";
// The DATA-CUT BUILDER (ADR-0023) — a guided, scalable workflow for everyday breeding. The breeder
// answers two questions as a sentence ("Build a cut to [predict|advance] for the [market]"), sees the
// MARKET HIERARCHY that explains why early 'All' trials feed every market, then (optionally) refines the
// exact trials and saves the result as a re-runnable preset. Dropdowns (not chip-walls) so it scales to
// many markets. Germplasm is never tagged; a line's markets are derived from the trials it appears in.
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Target, FlaskConical, RefreshCw, Save, Trash2, Check, ChevronRight, ChevronDown, Eye, CornerDownRight } from "lucide-react";
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
export interface Taxonomy {
  root: { tag: string; label: string };
  tpes: Array<{ id: string; label: string; tag: string }>;
  markets: Array<{ id: string; label: string; tpe: string; tag: string }>;
}

const PURPOSES = [
  { id: "prediction" as const, verb: "predict", label: "Prediction", hint: "Broad — pool every relevant trial across stages & years (a training set)" },
  { id: "advancement" as const, verb: "decide advancement", label: "Hybrid advancement", hint: "Narrow — only the latest-stage advance/drop decision set" },
];

const sameSet = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));

export default function DataCutPicker({
  cuts, catalog, taxonomy, savedCuts, selected, composition, currentTrialIds, currentMarket, currentPurpose,
}: {
  cuts: CutCard[]; catalog: CatalogTrial[]; taxonomy: Taxonomy; savedCuts: SavedCutCard[];
  selected: string; composition: Composition | null; currentTrialIds: string[]; currentMarket: string;
  currentPurpose: "prediction" | "advancement";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [purpose, setPurpose] = useState<"prediction" | "advancement">(currentPurpose);
  const [market, setMarket] = useState<string>(currentMarket || taxonomy.markets[0]?.id || "");
  const [included, setIncluded] = useState<Set<string>>(() => new Set(currentTrialIds));
  const [name, setName] = useState<string>("");
  const [refineOpen, setRefineOpen] = useState(false);

  const template = useMemo(() => cuts.find((c) => c.purpose === purpose && c.market === market), [cuts, purpose, market]);
  const isTemplate = !!template && sameSet(included, template.trial_ids);
  const mkt = taxonomy.markets.find((m) => m.id === market);
  const mktTpe = taxonomy.tpes.find((t) => t.id === mkt?.tpe);

  // markets a trial tag feeds: same-TPE markets, or ALL markets if it's the broad 'root' (All) tag.
  const feeds = (tag: string) => (tag === taxonomy.root.tag ? taxonomy.markets : taxonomy.markets.filter((m) => m.tag === tag));

  const draftTrials = useMemo(() => catalog.filter((t) => included.has(t.trial_id)), [catalog, included]);
  const draft = useMemo(() => ({
    n_trials: draftTrials.length,
    n_env: draftTrials.reduce((a, t) => a + t.n_loc, 0),
    entries: draftTrials.reduce((a, t) => a + t.n_entries, 0),
    stages: [...new Set(draftTrials.map((t) => t.stage))].sort(),
    years: [...new Set(draftTrials.map((t) => t.year))].sort(),
  }), [draftTrials]);

  // changing purpose/market reseeds the selection to that template (the smart default to refine from).
  const reseed = (p: "prediction" | "advancement", mk: string) => {
    const tpl = cuts.find((c) => c.purpose === p && c.market === mk);
    setIncluded(new Set(tpl?.trial_ids ?? []));
  };
  const onPurpose = (p: "prediction" | "advancement") => { setPurpose(p); reseed(p, market); };
  const onMarket = (mk: string) => { setMarket(mk); reseed(purpose, mk); };
  const toggle = (id: string) => setIncluded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const view = () => { if (template) router.push(`/?cut=${template.id}`); };
  const save = () => {
    setErr(null);
    start(async () => {
      const res = await saveAndRunCut({ name, market, trialIds: [...included] });
      if (res.status === "error") { setErr(res.error); return; }
      router.push(`/?cut=${res.cutId}`);
    });
  };
  const rerun = (id: string, def?: SavedCutCard) => { setBusy(id); start(async () => { if (def) await saveAndRunCut({ name: def.name, market: def.market, trialIds: def.trialIds }); else await analyzeCut(id); setBusy(null); router.refresh(); }); };
  const remove = (id: string) => { setBusy(id); start(async () => { await deleteCut(id); setBusy(null); if (selected === id) router.push("/"); else router.refresh(); }); };

  const activeSaved = savedCuts.find((c) => c.id === selected);
  const stageGroups = useMemo(() => {
    const order = ["S1", "S2", "S3", "S4"];
    const by = new Map<string, CatalogTrial[]>();
    for (const t of catalog) { (by.get(t.stage) ?? by.set(t.stage, []).get(t.stage)!).push(t); }
    return [...by.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [catalog]);

  return (
    <section className="space-y-4">
      {/* ── Builder ─────────────────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Define your data cut</h3>
          {savedCuts.length > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
              Load a saved cut
              <select value={savedCuts.some((c) => c.id === selected) ? selected : ""} onChange={(e) => e.target.value && router.push(`/?cut=${e.target.value}`)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-emerald-400">
                <option value="">{savedCuts.length} saved…</option>
                {savedCuts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>

        {/* the sentence: two dropdowns carry the two decisions that matter */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <span>Build a cut to</span>
          <Dropdown value={purpose} onChange={(v) => onPurpose(v as "prediction" | "advancement")}
            options={PURPOSES.map((p) => ({ value: p.id, label: p.label }))} accent />
          <span>for the</span>
          <select value={market} onChange={(e) => onMarket(e.target.value)}
            className="rounded-lg border border-emerald-300 bg-emerald-50/60 px-2.5 py-1.5 text-sm font-medium text-emerald-800 outline-none focus:border-emerald-500">
            {taxonomy.tpes.map((tpe) => (
              <optgroup key={tpe.id} label={tpe.label}>
                {taxonomy.markets.filter((m) => m.tpe === tpe.id).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </optgroup>
            ))}
          </select>
          <span>market.</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{PURPOSES.find((p) => p.id === purpose)?.hint}</p>

        {/* market hierarchy — the teaching surface: how early 'All' trials feed every market */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Target size={12} /> Market hierarchy</div>
            <Hierarchy taxonomy={taxonomy} selectedMarket={market} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-[12px] text-slate-600">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">What this assembles</div>
            <p>
              Ranks on <b className="text-slate-800">{mkt?.label}</b>. Pulls every trial tagged{" "}
              <Tag>{mktTpe?.tag}</Tag>{purpose === "prediction" && <> or <Tag>{taxonomy.root.tag}</Tag></>}
              {purpose === "prediction"
                ? <> across all stages &amp; years — so the early <Tag>{taxonomy.root.tag}</Tag> screens feed it.</>
                : <> at the latest stage only — the focused advance/drop set.</>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Stat label="trials" value={draft.n_trials} />
              <Stat label="environments" value={draft.n_env} />
              <Stat label="stages" value={draft.stages.join("+") || "—"} />
              <Stat label="years" value={draft.years.join("/") || "—"} />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{draft.stages.length > 1 ? "Spans the funnel → a broad, prediction-style cut." : draft.n_trials ? "Single stage → a narrow, decision-style cut." : "No trials selected."}</p>
          </div>
        </div>

        {/* refine — collapsed by default; most breeders accept the auto-assembly */}
        <button type="button" onClick={() => setRefineOpen((o) => !o)} className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-slate-600 hover:text-emerald-700">
          {refineOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Refine trials {isTemplate ? "(auto-selected)" : <span className="text-emerald-600">(edited)</span>}
        </button>
        {refineOpen && (
          <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {stageGroups.map(([stage, trials]) => (
                  <FragmentRows key={stage} stage={stage} label={trials[0]?.stage_label ?? stage} trials={trials} included={included} toggle={toggle} feeds={feeds} rootTag={taxonomy.root.tag} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* action — instant View for an unedited template; Save & run for a custom selection */}
        <div className="mt-4 border-t border-slate-100 pt-3">
          {isTemplate ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={view} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-emerald-700">
                <Eye size={14} /> View analysis
              </button>
              <span className="text-[12px] text-slate-500">Standard {PURPOSES.find((p) => p.id === purpose)?.label.toLowerCase()} cut — tick trials below to customize &amp; save.</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this custom cut, e.g. “CA processing training set 24-25”"
                className="min-w-[260px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400" />
              <button type="button" onClick={save} disabled={pending || !included.size || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40">
                {pending ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} {pending ? "Building & saving…" : "Save & run"}
              </button>
            </div>
          )}
          {err && <p className="mt-2 text-[12px] text-rose-600">{err}</p>}
        </div>
      </div>

      {/* ── Now viewing ─────────────────────────────────────────────────────────────────────── */}
      {composition && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[12px] text-slate-600 shadow-sm">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><CornerDownRight size={12} /> Now viewing</span>
          <span className="font-medium text-slate-800">{activeSaved?.name ?? cuts.find((c) => c.id === selected)?.label ?? selected}</span>
          <Stat label="trials" value={composition.n_trials} />
          <Stat label="genotypes" value={composition.n_geno} />
          <Stat label="environments" value={composition.n_env} />
          <Stat label="stages" value={composition.stages.join("+")} />
          <Stat label="plots" value={composition.n_obs} />
          <span className="ml-auto flex items-center gap-1">
            <button type="button" title="Re-run on current data" onClick={() => rerun(selected, activeSaved)} disabled={pending} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 disabled:opacity-50"><RefreshCw size={13} className={busy === selected ? "animate-spin" : ""} /></button>
            {activeSaved && <button type="button" title="Delete preset" onClick={() => remove(selected)} disabled={pending} className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"><Trash2 size={13} /></button>}
          </span>
        </div>
      )}
    </section>
  );
}

// A stage group of trial rows in the refine table.
function FragmentRows({ stage, label, trials, included, toggle, feeds, rootTag }: {
  stage: string; label: string; trials: CatalogTrial[]; included: Set<string>;
  toggle: (id: string) => void; feeds: (tag: string) => Array<{ id: string; label: string }>; rootTag: string;
}) {
  return (
    <>
      <tr className="bg-slate-50/80">
        <td colSpan={4} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{stage} · {label}</td>
      </tr>
      {trials.map((t) => {
        const on = included.has(t.trial_id);
        const f = feeds(t.market_tag);
        return (
          <tr key={t.trial_id} className={`cursor-pointer border-t border-slate-100 ${on ? "bg-emerald-50/50" : "hover:bg-slate-50"}`} onClick={() => toggle(t.trial_id)}>
            <td className="w-8 py-1.5 pl-3 pr-2">
              <span className={`grid h-4 w-4 place-items-center rounded border ${on ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white"}`}>{on && <Check size={11} />}</span>
            </td>
            <td className="py-1.5 pr-3">
              <span className="font-medium text-slate-800"><FlaskConical size={11} className="mr-1 inline text-slate-400" />{t.trial_id}</span>
              <span className="ml-2 text-[11px] text-slate-400">{t.year} · {t.n_entries} entries · {t.n_loc}loc×{t.n_rep}rep</span>
            </td>
            <td className="py-1.5 pr-3"><Tag>{t.market_tag}</Tag></td>
            <td className="py-1.5 pr-3">
              <span className="text-[10px] text-slate-400">feeds </span>
              {f.map((m) => <span key={m.id} className="mr-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{m.label.replace(/^Processing · |^Fresh-market · /, "")}</span>)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// A compact market hierarchy tree: All → TPE → market, with the selected path highlighted.
function Hierarchy({ taxonomy, selectedMarket }: { taxonomy: Taxonomy; selectedMarket: string }) {
  const sel = taxonomy.markets.find((m) => m.id === selectedMarket);
  return (
    <div className="text-[12px] leading-relaxed">
      <div className="font-medium text-emerald-700">◆ {taxonomy.root.label}</div>
      {taxonomy.tpes.map((tpe) => {
        const onPath = sel?.tpe === tpe.id;
        const markets = taxonomy.markets.filter((m) => m.tpe === tpe.id);
        return (
          <div key={tpe.id} className="ml-2">
            <div className={onPath ? "font-medium text-emerald-700" : "text-slate-500"}>├─ {tpe.label}</div>
            {markets.map((m, i) => {
              const isSel = m.id === selectedMarket;
              return (
                <div key={m.id} className={`ml-4 ${isSel ? "font-semibold text-emerald-700" : onPath ? "text-slate-600" : "text-slate-400"}`}>
                  {i === markets.length - 1 ? "└" : "├"}─ {m.label.replace(/^Processing · |^Fresh-market · /, "")}{isSel && " ◄"}
                </div>
              );
            })}
          </div>
        );
      })}
      <p className="mt-1.5 text-[11px] text-slate-400">Early <Tag>{taxonomy.root.tag}</Tag> trials feed every market; markets sharing a TPE share one fit (different index lens).</p>
    </div>
  );
}

function Dropdown({ value, onChange, options, accent }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; accent?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border px-2.5 py-1.5 text-sm font-medium outline-none ${accent ? "border-emerald-300 bg-emerald-50/60 text-emerald-800 focus:border-emerald-500" : "border-slate-200 bg-white text-slate-700 focus:border-emerald-400"}`}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{children}</span>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <span className="inline-flex items-baseline gap-1"><b className="tnum text-slate-800">{value}</b><span className="text-[11px] text-slate-400">{label}</span></span>;
}
