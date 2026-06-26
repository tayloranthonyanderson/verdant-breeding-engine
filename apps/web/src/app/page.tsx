import Link from "next/link";
import { Leaf, FlaskConical, Sprout, ClipboardCheck, Compass, SlidersHorizontal, Microscope, ListChecks, Dna, ShieldCheck, Layers } from "lucide-react";
import type { ResultBundle, AnalysisRequest } from "@verdant/contracts";
import { getG2fResult, getCutResult, listSavedCuts } from "@/lib/data";
import { listCuts, trialsForTags, trialCatalog, cutTaxonomy, type CutTaxonomy } from "@verdant/pipeline";
import { getCombiningAbility } from "@/lib/ca";
import InsightBanner from "@/components/InsightBanner";
import ModelReadiness from "@/components/ModelReadiness";
import ModelStudio from "@/components/ModelStudio";
import DataQuality from "@/components/DataQuality";
import HeritabilityCards from "@/components/HeritabilityCards";
import GeneticCorrelations from "@/components/GeneticCorrelations";
import CombiningAbilityUnderstand from "@/components/CombiningAbilityUnderstand";
import AskPanel from "@/components/AskPanel";
import SelectionSection from "@/components/SelectionSection";
import GenomicWorkspace from "@/components/GenomicWorkspace";
import OverviewSummary from "@/components/OverviewSummary";
import AdvanceStep from "@/components/AdvanceStep";
import { type CutCard, type CatalogTrial } from "@/components/DataCutPicker";
import CutWorkbench, { type WorkbenchInitial } from "@/components/CutWorkbench";
import StepShell, { type Step } from "@/components/StepShell";

// Always read the freshest persisted result from Postgres.
export const dynamic = "force-dynamic";
// A synchronous override re-run (ADR-0018) can refit the model; give the Server Action headroom.
export const maxDuration = 300;

// The front door is the maize PROGRAM as a deliberate analysis PIPELINE (ADR-0023): compose a data
// cut → review the data + outliers and the model the planner recommends (live, pre-fit) → Run → results.
// The rich G2F MET demo is preserved behind ?view=g2f.
export default async function Home({ searchParams }: { searchParams: Promise<{ cut?: string; view?: string }> }) {
  const sp = await searchParams;
  if (sp.view !== "g2f") return <CutExperience cutId={sp.cut ?? null} />;
  return <G2fExperience />;
}

// ---- Maize data-cut experience (the deliberate pipeline, driven by the client workbench) --------
async function CutExperience({ cutId }: { cutId: string | null }) {
  let cuts: CutCard[] = [];
  let catalog: CatalogTrial[] = [];
  let taxonomy: CutTaxonomy | null = null;
  try {
    cuts = listCuts().map((c) => {
      const tr = trialsForTags(c.tags);
      return { ...c, trial_ids: tr.map((t) => t.trial_id), stages: [...new Set(tr.map((t) => t.stage))].sort(), years: [...new Set(tr.map((t) => t.year))].sort(), n_trials: tr.length };
    });
    catalog = trialCatalog().map((t) => ({ trial_id: t.trial_id, stage: t.stage, stage_label: t.stage_label, year: t.year, tpe: t.tpe, market_tag: t.market_tag, n_entries: t.n_entries, n_loc: t.n_loc, n_rep: t.n_rep, design: t.design }));
    taxonomy = cutTaxonomy();
  } catch { /* corpus not generated — page still renders the empty state */ }
  const savedCuts = await listSavedCuts().catch(() => []);

  // The fitted analysis to show in the results steps (only when ?cut= points at a built cut).
  let initial: WorkbenchInitial | null = null;
  if (cutId) {
    const r = await getCutResult(cutId);
    if (r) {
      const cut = (r.bundle.data_readiness as { cut?: { trial_ids?: string[]; label?: string } } | undefined)?.cut;
      initial = {
        cutId: r.study?.name ?? cutId, bundle: r.bundle, runId: r.run.id,
        advancements: r.advancements.map((a) => ({ candidate: a.candidate, unit: a.unit, pool: a.pool, disposition: a.disposition })),
        trialIds: cut?.trial_ids ?? [],
      };
    }
  }
  const badge = (initial?.bundle.data_readiness as { cut?: { label?: string } } | undefined)?.cut?.label ?? "maize program";

  return (
    <Shell badge={badge} altHref="/?view=g2f" altLabel="G2F MET demo">
      {taxonomy ? <CutWorkbench cuts={cuts} catalog={catalog} taxonomy={taxonomy} savedCuts={savedCuts} initial={initial} /> : <EmptyState />}
    </Shell>
  );
}

// ---- G2F MET experience (the original rich maize demo) ------------------------------------------
async function G2fExperience() {
  const result = await getG2fResult();
  const ca = result ? getCombiningAbility(result.bundle) : null;
  const hasGenomic = !!(result?.bundle as { genomic?: unknown } | undefined)?.genomic;
  const activeExclusions = (result?.run.request as AnalysisRequest | null)?.data_overrides?.exclusions ?? [];

  const steps: Step[] = result
    ? [
        {
          id: "overview", label: "Overview", sublabel: "trial & data at a glance", icon: <Compass size={14} />,
          content: <OverviewSummary bundle={result.bundle} studyName={result.study?.name ?? null} />,
        },
        {
          id: "data", label: "Data", sublabel: "is your data sound?", icon: <ShieldCheck size={14} />,
          content: <DataQuality bundle={result.bundle} activeExclusions={activeExclusions} phase="data" />,
        },
        {
          id: "model", label: "Model", sublabel: "choose, tune & check the fit", icon: <SlidersHorizontal size={14} />,
          content: (
            <div className="space-y-5">
              <InsightBanner bundle={result.bundle} />
              <ModelReadiness bundle={result.bundle} />
              <ModelStudio bundle={result.bundle} />
              <DataQuality bundle={result.bundle} activeExclusions={activeExclusions} phase="fit" />
            </div>
          ),
        },
        {
          id: "understand", label: "Understand", sublabel: "heritability, correlations, combining ability", icon: <Microscope size={14} />,
          content: (
            <div className="space-y-5">
              <AskPanel bundle={result.bundle} />
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">Heritability</h3>
                <HeritabilityCards bundle={result.bundle} />
              </section>
              <GeneticCorrelations bundle={result.bundle} />
              <CombiningAbilityUnderstand bundle={result.bundle} />
            </div>
          ),
        },
        {
          id: "select", label: "Select", sublabel: "rank & choose — hybrids or parents", icon: <ListChecks size={14} />,
          content: (
            <SelectionSection
              bundle={result.bundle}
              analysisRunId={result.run.id}
              advancements={result.advancements.map((a) => ({ candidate: a.candidate, unit: a.unit, pool: a.pool, disposition: a.disposition }))}
            />
          ),
        },
        {
          id: "advance", label: "Advance", sublabel: "record decisions", icon: <ClipboardCheck size={14} />,
          content: <AdvanceStep advancements={result.advancements} />,
        },
        ...(hasGenomic
          ? [{
              id: "genomics", label: "Genomics", sublabel: "relationship, structure, GEBVs", icon: <Dna size={14} />,
              content: <GenomicWorkspace bundle={result.bundle} />,
            } as Step]
          : []),
      ]
    : [];

  return (
    <Shell badge={result?.study?.name ?? null} altHref="/" altLabel="← Maize program" extra={ca ? "combining ability" : null}>
      {!result ? <EmptyState /> : <StepShell steps={steps} />}
    </Shell>
  );
}

// Shared chrome for both experiences, with a link to switch between them.
function Shell({ children, badge, altHref, altLabel, extra }: { children: React.ReactNode; badge: string | null; altHref: string; altLabel: string; extra?: string | null }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-green-700 text-white shadow-sm">
            <Leaf size={18} />
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight text-slate-900">Verdant</div>
            <div className="text-[11px] text-slate-500">Breeding Analytics</div>
          </div>
          {badge && (
            <span className="ml-3 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              <FlaskConical size={11} /> {badge}
            </span>
          )}
          {extra && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              <Sprout size={11} /> {extra}
            </span>
          )}
          <Link href={altHref} className="ml-auto text-xs text-slate-400 hover:text-emerald-600">{altLabel}</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">{children}</main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-20 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
        <Sprout size={26} />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-slate-800">No analysis yet</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        Run an analysis to see spatially-adjusted BLUPs, heritability, combining ability, and a ranked
        selection index.
      </p>
    </div>
  );
}
