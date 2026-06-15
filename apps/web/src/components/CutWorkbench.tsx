"use client";
// The analysis as a DELIBERATE PIPELINE (not "compose → view a baked result"). The breeder composes a
// data cut, REVIEWS the data + outliers and the model the planner recommends (both computed live, pre-fit,
// in ~0.5s — no BLUP), then presses RUN to fit it. Results (Understand / Select / Advance) are the OUTPUT
// of that run, gated until it happens. Editing the composition invalidates the results → you Run again.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ResultBundle } from "@verdant/contracts";
import { Layers, ShieldCheck, SlidersHorizontal, Microscope, ListChecks, ClipboardCheck, Dna, Play, RefreshCw, Lock, ArrowRight } from "lucide-react";
import { previewAnalysis, runAnalysis } from "@/app/actions";
import DataCutPicker, { type CutCard, type CatalogTrial, type Taxonomy, type SavedCutCard } from "./DataCutPicker";
import StepShell, { type Step } from "./StepShell";
import OverviewSummary from "./OverviewSummary";
import DataQuality from "./DataQuality";
import InsightBanner from "./InsightBanner";
import ModelReadiness from "./ModelReadiness";
import HeritabilityCards from "./HeritabilityCards";
import GeneticCorrelations from "./GeneticCorrelations";
import CombiningAbilityUnderstand from "./CombiningAbilityUnderstand";
import AskPanel from "./AskPanel";
import SelectionSection from "./SelectionSection";
import AdvanceStep, { type AdvanceRow } from "./AdvanceStep";
import GenomicWorkspace from "./GenomicWorkspace";

export interface WorkbenchInitial { cutId: string; bundle: ResultBundle; runId: number; advancements: AdvanceRow[]; trialIds: string[] }

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const cutLabel = (b: ResultBundle | null) => (b?.data_readiness as { cut?: { label?: string } } | undefined)?.cut?.label ?? null;

export default function CutWorkbench({ cuts, catalog, taxonomy, savedCuts, initial }: {
  cuts: CutCard[]; catalog: CatalogTrial[]; taxonomy: Taxonomy; savedCuts: SavedCutCard[]; initial: WorkbenchInitial | null;
}) {
  const router = useRouter();
  const [trialIds, setTrialIds] = useState<string[]>(initial?.trialIds ?? cuts[0]?.trial_ids ?? []);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewAnalysis>> | null>(null);
  const [active, setActive] = useState(initial ? 1 : 0);
  const [, startPreview] = useTransition();
  const [running, startRun] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Results are fresh only if the current composition matches what was fit.
  const resultFresh = !!initial && sameSet(trialIds, initial.trialIds);
  const matchedTemplate = useMemo(() => cuts.find((c) => sameSet(trialIds, c.trial_ids)), [cuts, trialIds]);

  // Live pre-fit preview (data quality + planner) whenever the composition changes.
  const sig = trialIds.slice().sort().join(",");
  useEffect(() => {
    if (!trialIds.length) { setPreview(null); return; }
    let cancelled = false;
    startPreview(async () => {
      const res = await previewAnalysis({ trialIds });
      if (!cancelled) setPreview(res);
    });
    return () => { cancelled = true; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = preview?.status === "ok" ? preview.preview : null;
  // The partial bundle the Data + Model steps render from the preview (no traits/indices yet).
  const previewBundle = useMemo<ResultBundle | null>(() => p ? ({
    contract_version: "v0", status: "ok", intent: "selection",
    chosen_model: p.chosen_model, traits: [], genetic_correlations: null, gxe: null,
    data_readiness: p.data_readiness, data_quality: p.data_quality, indices: [], divergence: null,
    warnings: [], provenance: { contract_version: "v0" },
  } as unknown as ResultBundle) : null, [p]);

  const run = () => {
    setErr(null);
    if (matchedTemplate) { router.push(`/?cut=${matchedTemplate.id}`); return; } // prebuilt — instant
    const nm = name.trim();
    if (!nm) { setErr("Name this analysis to run & save it."); return; }
    startRun(async () => {
      const res = await runAnalysis({ name: nm, trialIds });
      if (res.status === "error") { setErr(res.error); return; }
      router.push(`/?cut=${res.cutId}`);
    });
  };

  const result = resultFresh ? initial!.bundle : null;
  const hasGenomic = !!(result as { genomic?: unknown } | null)?.genomic;
  const studyName = cutLabel(result) ?? matchedTemplate?.label ?? cutLabel(previewBundle) ?? "new cut";

  const RunGate = ({ what }: { what: string }) => (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-600"><Lock size={18} /></div>
      <p className="mt-3 text-sm font-medium text-slate-700">Run the analysis to see {what}</p>
      <p className="mt-1 text-xs text-slate-500">Review the data and the model, then press <b>Run analysis</b> in the Model step.</p>
      <button type="button" onClick={() => setActive(2)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">Go to Model <ArrowRight size={12} /></button>
    </div>
  );

  const steps: Step[] = [
    { id: "cut", label: "Data cut", sublabel: "compose what to analyze", icon: <Layers size={14} />,
      content: (
        <div className="space-y-4">
          <DataCutPicker embedded onComposition={setTrialIds} cuts={cuts} catalog={catalog} taxonomy={taxonomy} savedCuts={savedCuts} selected={initial?.cutId ?? ""} composition={null} currentTrialIds={trialIds} />
          <NextHint onNext={() => setActive(1)} label="Review the data" disabled={!trialIds.length} />
        </div>
      ) },
    { id: "data", label: "Data", sublabel: "review the cut & its outliers", icon: <ShieldCheck size={14} />,
      content: previewBundle ? (
        <div className="space-y-5">
          <OverviewSummary bundle={previewBundle} studyName={studyName} />
          <DataQuality bundle={previewBundle} phase="data" reviewOnly />
          <NextHint onNext={() => setActive(2)} label="Review the model" />
        </div>
      ) : <Loading /> },
    { id: "model", label: "Model", sublabel: "review the planner's call, then run", icon: <SlidersHorizontal size={14} />,
      content: previewBundle ? (
        <div className="space-y-5">
          <InsightBanner bundle={previewBundle} />
          <ModelReadiness bundle={previewBundle} />
          <RunPanel matchedTemplate={!!matchedTemplate} name={name} setName={setName} run={run} running={running} err={err} fresh={resultFresh} />
        </div>
      ) : <Loading /> },
    { id: "understand", label: "Understand", sublabel: "ask, heritability & correlations", icon: <Microscope size={14} />,
      content: result ? (
        <div className="space-y-5">
          <AskPanel cutId={initial!.cutId} />
          <section><h3 className="mb-2 text-sm font-semibold text-slate-700">Heritability on this cut</h3><HeritabilityCards bundle={result} /></section>
          <GeneticCorrelations bundle={result} />
          <CombiningAbilityUnderstand bundle={result} />
        </div>
      ) : <RunGate what="heritability & correlations" /> },
    { id: "select", label: "Select", sublabel: "rank by market & choose", icon: <ListChecks size={14} />,
      content: result ? (
        <SelectionSection bundle={result} analysisRunId={initial!.runId} advancements={initial!.advancements.map((a) => ({ candidate: a.candidate, unit: a.unit, pool: a.pool, disposition: a.disposition }))} />
      ) : <RunGate what="the rankings" /> },
    { id: "advance", label: "Advance", sublabel: "record decisions", icon: <ClipboardCheck size={14} />,
      content: result ? <AdvanceStep advancements={initial!.advancements} /> : <RunGate what="advancement decisions" /> },
    ...(hasGenomic ? [{ id: "genomics", label: "Genomics", sublabel: "relationship, structure, GEBVs", icon: <Dna size={14} />, content: <GenomicWorkspace bundle={result!} /> } as Step] : []),
  ];

  return <StepShell steps={steps} active={active} onActiveChange={setActive} />;
}

function Loading() {
  return <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500"><RefreshCw size={15} className="animate-spin" /> Computing the data quality and the model plan…</div>;
}
function NextHint({ onNext, label, disabled }: { onNext: () => void; label: string; disabled?: boolean }) {
  return <div className="flex justify-end"><button type="button" onClick={onNext} disabled={disabled} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40">{label} <ArrowRight size={14} /></button></div>;
}
function RunPanel({ matchedTemplate, name, setName, run, running, err, fresh }: { matchedTemplate: boolean; name: string; setName: (s: string) => void; run: () => void; running: boolean; err: string | null; fresh: boolean }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
      <h3 className="text-sm font-semibold text-slate-800">{fresh ? "Analysis is up to date" : "Run the analysis"}</h3>
      <p className="mt-0.5 text-[12px] text-slate-500">
        {fresh ? "This cut has already been fit — its results are in the steps that follow. Edit the cut or model to run again."
          : matchedTemplate ? "A standard cut — running fits the model and shows the results below."
          : "Name this custom analysis; running fits the model and saves it as a re-runnable cut."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!matchedTemplate && !fresh && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this analysis, e.g. “CA processing training set 24-25”" className="min-w-[260px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />}
        <button type="button" onClick={run} disabled={running} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
          {running ? <><RefreshCw size={15} className="animate-spin" /> Running the fit…</> : <><Play size={15} /> {fresh ? "Re-run analysis" : "Run analysis"}</>}
        </button>
      </div>
      {err && <p className="mt-2 text-[12px] text-rose-600">{err}</p>}
    </div>
  );
}
