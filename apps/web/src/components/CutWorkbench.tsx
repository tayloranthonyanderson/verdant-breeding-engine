"use client";
// The analysis as a DELIBERATE PIPELINE (not "compose → view a baked result"). The breeder composes a
// data cut, REVIEWS the data + outliers and the model the planner recommends (both computed live, pre-fit,
// in ~0.5s — no BLUP), then presses RUN to fit it. Results (Understand / Select / Advance) are the OUTPUT
// of that run, gated until it happens. Editing the composition invalidates the results → you Run again.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ResultBundle } from "@verdant/contracts";
import { Layers, ShieldCheck, SlidersHorizontal, Microscope, ListChecks, ClipboardCheck, Dna, Play, RefreshCw, Lock, ArrowRight, Activity } from "lucide-react";
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
type ModelOv = { spatial?: "spats" | "none"; gxe?: "include" | "skip"; relationship?: "identity" | "G"; engine?: "rrblup" | "blupf90" };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const cutLabel = (b: ResultBundle | null) => (b?.data_readiness as { cut?: { label?: string } } | undefined)?.cut?.label ?? null;

export default function CutWorkbench({ cuts, catalog, taxonomy, savedCuts, initial }: {
  cuts: CutCard[]; catalog: CatalogTrial[]; taxonomy: Taxonomy; savedCuts: SavedCutCard[]; initial: WorkbenchInitial | null;
}) {
  const router = useRouter();
  const [trialIds, setTrialIds] = useState<string[]>(initial?.trialIds ?? cuts[0]?.trial_ids ?? []);
  const [name, setName] = useState("");
  // Breeder model overrides (the Model Studio). Defaults = the fast baseline; toggling on a more
  // thorough option re-plans the preview and is applied at Run.
  const [ov, setOv] = useState<ModelOv>({});
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewAnalysis>> | null>(null);
  const [active, setActive] = useState(initial ? 1 : 0);
  const [, startPreview] = useTransition();
  const [running, startRun] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const hasOverrides = !!(ov.spatial === "spats" || ov.gxe === "include" || ov.relationship === "G" || ov.engine === "blupf90");
  // Results are fresh only if the current composition matches what was fit (a model override invalidates).
  const resultFresh = !!initial && sameSet(trialIds, initial.trialIds) && !hasOverrides;
  const matchedTemplate = useMemo(() => cuts.find((c) => sameSet(trialIds, c.trial_ids)), [cuts, trialIds]);

  // Live pre-fit preview (data quality + planner) whenever the composition or the model overrides change.
  const sig = trialIds.slice().sort().join(",") + "|" + JSON.stringify(ov);
  useEffect(() => {
    if (!trialIds.length) { setPreview(null); return; }
    let cancelled = false;
    startPreview(async () => {
      const res = await previewAnalysis({ trialIds, overrides: ov });
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
    if (matchedTemplate && !hasOverrides) { router.push(`/?cut=${matchedTemplate.id}`); return; } // prebuilt — instant
    const nm = name.trim() || (matchedTemplate ? `${matchedTemplate.label} · custom model` : "");
    if (!nm) { setErr("Name this analysis to run & save it."); return; }
    startRun(async () => {
      const res = await runAnalysis({ name: nm, trialIds, overrides: ov });
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
          <ModelStudio bundle={previewBundle} ov={ov} setOv={setOv} />
          <RunPanel matchedTemplate={!!matchedTemplate && !hasOverrides} name={name} setName={setName} run={run} running={running} err={err} fresh={resultFresh} />
        </div>
      ) : <Loading /> },
    { id: "fit", label: "Fit", sublabel: "did the model work? residuals & Q-Q", icon: <Activity size={14} />,
      content: result ? (
        <div className="space-y-5">
          <DataQuality bundle={result} phase="fit" reviewOnly />
        </div>
      ) : <RunGate what="the fit diagnostics" /> },
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
// The Model Studio — the breeder reviews the planner's recommendation and chooses the model. Spatial /
// GxE / genomic are off by default (fast); turning one on re-plans the preview and is applied at Run.
function ModelStudio({ bundle, ov, setOv }: { bundle: ResultBundle; ov: ModelOv; setOv: (o: ModelOv) => void }) {
  const dec = (f: string) => (bundle.chosen_model.decisions ?? []).find((d) => d.factor === f) as { recommended?: string | null } | undefined;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500"><SlidersHorizontal size={15} /></span>
        <h3 className="text-sm font-semibold text-slate-800">Model studio</h3>
        <span className="text-[11px] text-slate-400">the planner recommends; you choose — more thorough options fit slower</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Toggle label="Spatial correction" desc="SpATS de-trends the field grid (two-stage)" on={ov.spatial === "spats"} rec={dec("spatial")?.recommended === "spats"} onChange={(v) => setOv({ ...ov, spatial: v ? "spats" : "none" })} />
        <Toggle label="Genotype × Environment" desc="separate GxE from error (needs multi-env reps)" on={ov.gxe === "include"} rec={dec("gxe")?.recommended === "include"} onChange={(v) => setOv({ ...ov, gxe: v ? "include" : "skip" })} />
        <Toggle label="Genomic (GRM)" desc="rank on marker-based GEBVs; lights up Genomics" on={ov.relationship === "G"} rec={dec("relationship")?.recommended === "G"} onChange={(v) => setOv({ ...ov, relationship: v ? "G" : "identity", engine: v ? ov.engine : "rrblup" })} />
        <Toggle
          label="Engine: BLUPF90"
          desc={ov.relationship === "G" ? "native preGSf90 GBLUP vs rrBLUP (fast default)" : "turn on Genomic (GRM) to choose the engine"}
          on={ov.engine === "blupf90"}
          rec={dec("engine")?.recommended === "blupf90"}
          disabled={ov.relationship !== "G"}
          onChange={(v) => setOv({ ...ov, engine: v ? "blupf90" : "rrblup" })}
        />
      </div>
    </div>
  );
}
function Toggle({ label, desc, on, rec, onChange, disabled }: { label: string; desc: string; on: boolean; rec: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${disabled ? "border-slate-100 bg-slate-50/60 opacity-60" : on ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-800">{label}</span>
        <span className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-white p-0.5 text-[11px]">
          <button type="button" disabled={disabled} onClick={() => onChange(false)} className={`rounded px-2 py-0.5 disabled:cursor-not-allowed ${!on ? "bg-slate-100 font-medium text-slate-700" : "text-slate-400"}`}>Off</button>
          <button type="button" disabled={disabled} onClick={() => onChange(true)} className={`rounded px-2 py-0.5 disabled:cursor-not-allowed ${on ? "bg-emerald-600 font-medium text-white" : "text-slate-400"}`}>On</button>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{desc}</p>
      {rec && !disabled && <span className="mt-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">planner recommends</span>}
    </div>
  );
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
