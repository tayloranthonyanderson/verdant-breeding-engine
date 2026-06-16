"use client";
// The DATA-CUT BUILDER (ADR-0023) — compose a cut from the MARKET-TARGET HIERARCHY. Trials are tagged
// to nodes in a tree (All > TPE > specific market) that narrows as material advances. The breeder
// multi-selects ANY set of nodes — a broad chain, a single leaf, or a cross-strategy mix — and the cut
// is the union of trials tagged to them. Then pick a market to rank by, name it, and save as a
// re-runnable preset. Germplasm is never tagged; a line's markets are derived from the trials it's in.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { FlaskConical, RefreshCw, Save, Trash2, Check, Minus, ChevronRight, ChevronDown, Eye, CornerDownRight, Trophy } from "lucide-react";
import { saveAndRunCut, deleteCut, analyzeCut } from "@/app/actions";

export interface CutCard {
  id: string; purpose: "prediction" | "advancement"; market: string; market_label: string;
  label: string; blurb: string; tags: string[]; trial_ids: string[]; stages: string[]; years: number[]; n_trials: number;
}
export interface CatalogTrial {
  trial_id: string; stage: string; stage_label: string; year: number; tpe: string;
  market_tag: string; n_entries: number; n_loc: number; n_rep: number; design: string;
}
export interface Composition { n_geno: number; n_env: number; n_obs: number; n_checks: number; n_trials: number; stages: string[]; years: number[] }
export interface SavedCutCard { id: string; name: string; market: string; market_label: string; trialIds: string[]; n_geno: number; stages: string[]; years: number[] }
export interface TaxNode { id: string; label: string; parent: string | null; tpe: string | null; depth: number; isMarket: boolean; trialCount: number }
export interface Taxonomy { nodes: TaxNode[]; markets: Array<{ id: string; label: string; tpe: string | null }> }

const sameSet = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));
const shortMarket = (s: string) => s.replace(/^Processing · |^Fresh-market · /, "");

export default function DataCutPicker({
  cuts, catalog, taxonomy, savedCuts, selected, composition, currentTrialIds, embedded, onComposition,
}: {
  cuts: CutCard[]; catalog: CatalogTrial[]; taxonomy: Taxonomy; savedCuts: SavedCutCard[];
  selected: string; composition: Composition | null; currentTrialIds: string[];
  /** Embedded in the analysis workbench: the picker is PURE composition (the workbench owns Run/Save). */
  embedded?: boolean;
  /** Fired (with the included trial ids) whenever the composition changes — for the workbench. */
  onComposition?: (trialIds: string[]) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [included, setIncluded] = useState<Set<string>>(() => new Set(currentTrialIds));
  const [name, setName] = useState<string>("");
  const [refineOpen, setRefineOpen] = useState(false);

  // In embedded mode, publish the composition to the workbench whenever it changes.
  useEffect(() => { if (embedded) onComposition?.([...included]); }, [included]); // eslint-disable-line react-hooks/exhaustive-deps

  const trialsByTag = useMemo(() => {
    const m = new Map<string, CatalogTrial[]>();
    for (const t of catalog) (m.get(t.market_tag) ?? m.set(t.market_tag, []).get(t.market_tag)!).push(t);
    return m;
  }, [catalog]);

  const nodeTrials = (id: string) => trialsByTag.get(id) ?? [];
  // A node + all its descendants (so clicking a parent cascades to the whole subtree).
  const subtree = useMemo(() => {
    const kids = new Map<string, string[]>();
    for (const n of taxonomy.nodes) if (n.parent) (kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)!).push(n.id);
    const walk = (id: string): string[] => [id, ...(kids.get(id) ?? []).flatMap(walk)];
    return new Map(taxonomy.nodes.map((n) => [n.id, walk(n.id)]));
  }, [taxonomy]);
  const subtreeTrials = (id: string) => (subtree.get(id) ?? [id]).flatMap(nodeTrials);
  const nodeState = (id: string) => {
    const tr = subtreeTrials(id);
    const inN = tr.filter((t) => included.has(t.trial_id)).length;
    return { total: tr.length, in: inN, all: tr.length > 0 && inN === tr.length, some: inN > 0 };
  };
  const toggleNode = (id: string) => setIncluded((s) => {
    const tr = subtreeTrials(id); const n = new Set(s);
    const allIn = tr.length > 0 && tr.every((t) => n.has(t.trial_id));
    for (const t of tr) allIn ? n.delete(t.trial_id) : n.add(t.trial_id);
    return n;
  });
  const toggleTrial = (id: string) => setIncluded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const draftTrials = useMemo(() => catalog.filter((t) => included.has(t.trial_id)), [catalog, included]);
  const draft = useMemo(() => ({
    n_trials: draftTrials.length,
    n_env: draftTrials.reduce((a, t) => a + t.n_loc, 0),
    stages: [...new Set(draftTrials.map((t) => t.stage))].sort(),
    years: [...new Set(draftTrials.map((t) => t.year))].sort(),
    markets: [...new Set(draftTrials.map((t) => t.market_tag))],
  }), [draftTrials]);

  // markets whose trials are in this composite — shown as info (the actual ranking lens is chosen at
  // the Select step, where the same fit is re-ranked per market).
  const cutMarkets = taxonomy.markets.filter((m) => nodeTrials(m.id).some((t) => included.has(t.trial_id)));

  const template = useMemo(() => cuts.find((c) => sameSet(included, c.trial_ids)), [cuts, included]);

  const seedTemplate = (id: string) => { const t = cuts.find((c) => c.id === id); if (t) setIncluded(new Set(t.trial_ids)); };
  const view = () => { if (template) router.push(`/?cut=${template.id}`); };
  const save = () => {
    setErr(null);
    start(async () => {
      const res = await saveAndRunCut({ name, trialIds: [...included] });
      if (res.status === "error") { setErr(res.error); return; }
      router.push(`/?cut=${res.cutId}`);
    });
  };
  const rerun = (id: string, def?: SavedCutCard) => { setBusy(id); start(async () => { if (def) await saveAndRunCut({ name: def.name, trialIds: def.trialIds }); else await analyzeCut(id); setBusy(null); router.refresh(); }); };
  const remove = (id: string) => { setBusy(id); start(async () => { await deleteCut(id); setBusy(null); if (selected === id) router.push("/"); else router.refresh(); }); };

  const activeSaved = savedCuts.find((c) => c.id === selected);
  const stageGroups = useMemo(() => {
    const order = ["S1", "S2", "S3", "S4"]; const by = new Map<string, CatalogTrial[]>();
    for (const t of catalog) (by.get(t.stage) ?? by.set(t.stage, []).get(t.stage)!).push(t);
    return [...by.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [catalog]);

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Compose your data cut</h3>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <label className="flex items-center gap-1.5">Start from
              {/* Reflects the matched template (the memo) so the box shows your pick; reverts to the
                  placeholder once you edit the selection into something custom — meaningful feedback. */}
              <select value={template?.id ?? ""} onChange={(e) => e.target.value && seedTemplate(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-emerald-400">
                <option value="">{included.size === 0 ? "a template…" : "custom (edited)…"}</option>
                {cuts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            {savedCuts.length > 0 && (
              <label className="flex items-center gap-1.5">Load saved
                <select value={savedCuts.some((c) => c.id === selected) ? selected : ""} onChange={(e) => e.target.value && router.push(`/?cut=${e.target.value}`)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-emerald-400">
                  <option value="">{savedCuts.length} saved…</option>
                  {savedCuts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Tick the market targets to include — a broad chain, a single market, or any mix. The cut is the union of their trials.</p>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {/* the market-target tree — the composer */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2">
            {taxonomy.nodes.map((n) => {
              const st = nodeState(n.id);
              return (
                <button key={n.id} type="button" onClick={() => toggleNode(n.id)} disabled={st.total === 0}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition disabled:opacity-40 ${st.all ? "bg-emerald-50" : st.some ? "bg-emerald-50/40" : "hover:bg-white"}`}
                  style={{ paddingLeft: 8 + n.depth * 18 }}>
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${st.all ? "border-emerald-500 bg-emerald-500 text-white" : st.some ? "border-emerald-500 bg-emerald-100 text-emerald-600" : "border-slate-300 bg-white"}`}>
                    {st.all ? <Check size={11} /> : st.some ? <Minus size={11} /> : null}
                  </span>
                  <span className={n.isMarket ? "font-medium text-slate-800" : "font-semibold text-slate-700"}>{n.isMarket ? shortMarket(n.label) : n.label}</span>
                  {n.isMarket && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">market</span>}
                  <span className="ml-auto text-[11px] text-slate-400">{st.total ? `${st.in}/${st.total} trials` : "—"}</span>
                </button>
              );
            })}
            <p className="px-2 pt-1.5 text-[11px] text-slate-400">Indent = how specific the target is. Inner nodes (All, the TPEs) carry the early/mid shared trials; leaves are the market-specific late trials.</p>
          </div>

          {/* markets in the cut (info) + composition */}
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Trophy size={12} /> Markets in this cut</div>
              <div className="flex flex-wrap gap-1.5">
                {cutMarkets.length ? cutMarkets.map((m) => (
                  <span key={m.id} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">{shortMarket(m.label)}</span>
                )) : <span className="text-[11px] text-slate-400">none — pick some trials</span>}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">You&rsquo;ll choose which of these ranks the candidates in the <b>Select</b> step (same fit, switch the lens).</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-[12px] text-slate-600">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">This cut</div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <Stat label="trials" value={draft.n_trials} />
                <Stat label="environments" value={draft.n_env} />
                <Stat label="stages" value={draft.stages.join("+") || "—"} />
                <Stat label="years" value={draft.years.join("/") || "—"} />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{draft.stages.length > 1 ? "Spans the funnel → a broad, prediction-style cut." : draft.n_trials ? "Single stage → a narrow, decision-style cut." : "No trials selected yet."}</p>
            </div>
          </div>
        </div>

        {/* per-trial refine */}
        <button type="button" onClick={() => setRefineOpen((o) => !o)} className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-slate-600 hover:text-emerald-700">
          {refineOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Fine-tune individual trials
        </button>
        {refineOpen && (
          <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-[12px]"><tbody>
              {stageGroups.map(([stage, trials]) => (
                <FragmentRows key={stage} stage={stage} label={trials[0]?.stage_label ?? stage} trials={trials} included={included} toggle={toggleTrial} />
              ))}
            </tbody></table>
          </div>
        )}

        {/* action (standalone mode only — the workbench owns Run/Save when embedded) */}
        {!embedded && <div className="mt-4 border-t border-slate-100 pt-3">
          {template ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={view} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"><Eye size={14} /> View analysis</button>
              <span className="text-[12px] text-slate-500">This matches the <b>{template.label}</b> template — edit the selection to make it your own &amp; save.</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this cut, e.g. “CA processing training set 24-25”"
                className="min-w-[260px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400" />
              <button type="button" onClick={save} disabled={pending || !included.size || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40">
                {pending ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} {pending ? "Building & saving…" : "Save & run"}
              </button>
            </div>
          )}
          {err && <p className="mt-2 text-[12px] text-rose-600">{err}</p>}
        </div>}
      </div>

      {/* Now viewing */}
      {!embedded && composition && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[12px] text-slate-600 shadow-sm">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><CornerDownRight size={12} /> Now viewing</span>
          <span className="font-medium text-slate-800">{activeSaved?.name ?? cuts.find((c) => c.id === selected)?.label ?? selected}</span>
          <Stat label="trials" value={composition.n_trials} />
          <Stat label="genotypes" value={composition.n_geno} />
          <Stat label="environments" value={composition.n_env} />
          <Stat label="stages" value={composition.stages.join("+")} />
          <span className="ml-auto flex items-center gap-1">
            <button type="button" title="Re-run on current data" onClick={() => rerun(selected, activeSaved)} disabled={pending} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 disabled:opacity-50"><RefreshCw size={13} className={busy === selected ? "animate-spin" : ""} /></button>
            {activeSaved && <button type="button" title="Delete preset" onClick={() => remove(selected)} disabled={pending} className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"><Trash2 size={13} /></button>}
          </span>
        </div>
      )}
    </section>
  );
}

function FragmentRows({ stage, label, trials, included, toggle }: { stage: string; label: string; trials: CatalogTrial[]; included: Set<string>; toggle: (id: string) => void }) {
  return (
    <>
      <tr className="bg-slate-50/80"><td colSpan={4} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{stage} · {label}</td></tr>
      {trials.map((t) => {
        const on = included.has(t.trial_id);
        return (
          <tr key={t.trial_id} className={`cursor-pointer border-t border-slate-100 ${on ? "bg-emerald-50/50" : "hover:bg-slate-50"}`} onClick={() => toggle(t.trial_id)}>
            <td className="w-8 py-1.5 pl-3 pr-2"><span className={`grid h-4 w-4 place-items-center rounded border ${on ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white"}`}>{on && <Check size={11} />}</span></td>
            <td className="py-1.5 pr-3"><span className="font-medium text-slate-800"><FlaskConical size={11} className="mr-1 inline text-slate-400" />{t.trial_id}</span><span className="ml-2 text-[11px] text-slate-400">{t.year} · {t.n_entries} entries · {t.n_loc}loc×{t.n_rep}rep</span></td>
            <td className="py-1.5 pr-3"><Tag>{t.market_tag}</Tag></td>
            <td className="py-1.5 pr-3 text-[11px] text-slate-400">{t.tpe}</td>
          </tr>
        );
      })}
    </>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{children}</span>;
}
function Stat({ label, value }: { label: string; value: string | number }) {
  return <span className="inline-flex items-baseline gap-1"><b className="tnum text-slate-800">{value}</b><span className="text-[11px] text-slate-400">{label}</span></span>;
}
