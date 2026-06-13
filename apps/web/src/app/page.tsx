import { Leaf, FlaskConical, Sprout, ClipboardCheck, Compass, SlidersHorizontal, Microscope, ListChecks, Dna, ShieldCheck } from "lucide-react";
import type { ResultBundle, AnalysisRequest } from "@verdant/contracts";
import { getLatestResult } from "@/lib/data";
import { getCombiningAbility } from "@/lib/ca";
import InsightBanner from "@/components/InsightBanner";
import ModelReadiness from "@/components/ModelReadiness";
import ModelStudio from "@/components/ModelStudio";
import DataQuality from "@/components/DataQuality";
import HeritabilityCards from "@/components/HeritabilityCards";
import GeneticCorrelations from "@/components/GeneticCorrelations";
import CombiningAbilityUnderstand from "@/components/CombiningAbilityUnderstand";
import SelectionSection from "@/components/SelectionSection";
import GenomicWorkspace from "@/components/GenomicWorkspace";
import StepShell, { type Step } from "@/components/StepShell";

// Always read the freshest persisted result from Postgres.
export const dynamic = "force-dynamic";
// A synchronous override re-run (ADR-0018) can refit the model; give the Server Action headroom.
export const maxDuration = 300;

// One trial → one analysis → many facets, presented as a WORKFLOW of focused steps (not an endless
// scroll): Overview → Model → Understand → Select → Advance → (Genomics).
export default async function Home() {
  const result = await getLatestResult();
  const ca = result ? getCombiningAbility(result.bundle) : null;
  const hasGenomic = !!(result?.bundle as { genomic?: unknown } | undefined)?.genomic;
  // The exclusion overlay the current run was fit with (for the with/without comparison).
  const activeExclusions = (result?.run.request as AnalysisRequest | null)?.data_overrides?.exclusions ?? [];

  const steps: Step[] = result
    ? [
        {
          id: "overview", label: "Overview", sublabel: "what this trial says", icon: <Compass size={14} />,
          content: (
            <div className="space-y-5">
              <OverviewSummary bundle={result.bundle} studyName={result.study?.name ?? null} />
              <InsightBanner bundle={result.bundle} />
            </div>
          ),
        },
        {
          id: "quality", label: "Quality", sublabel: "trust your data & the fit", icon: <ShieldCheck size={14} />,
          content: <DataQuality bundle={result.bundle} activeExclusions={activeExclusions} />,
        },
        {
          id: "model", label: "Model", sublabel: "trust & tune the fit", icon: <SlidersHorizontal size={14} />,
          content: (
            <div className="space-y-5">
              <ModelReadiness bundle={result.bundle} />
              <ModelStudio bundle={result.bundle} />
            </div>
          ),
        },
        {
          id: "understand", label: "Understand", sublabel: "heritability, correlations, combining ability", icon: <Microscope size={14} />,
          content: (
            <div className="space-y-5">
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
          {result?.study && (
            <span className="ml-3 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              <FlaskConical size={11} /> {result.study.name}
            </span>
          )}
          {ca && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              <Sprout size={11} /> combining ability
            </span>
          )}
          <div className="ml-auto text-xs text-slate-400">AI-native · trustworthy by design</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        {!result ? <EmptyState /> : <StepShell steps={steps} />}
      </main>
    </div>
  );
}

// At-a-glance summary for the Overview step.
function OverviewSummary({ bundle, studyName }: { bundle: ResultBundle; studyName: string | null }) {
  const ca = getCombiningAbility(bundle);
  const nGeno = bundle.traits[0]?.effects.length ?? 0;
  const stats: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Trial", value: studyName ?? "—", sub: `${bundle.traits.length} traits` },
    { label: "Hybrids", value: nGeno.toLocaleString(), sub: "genotypes analyzed" },
    { label: "Relationship", value: relLabel(bundle.chosen_model.relationship), sub: "breeding-value model" },
  ];
  if (ca) {
    stats.push({ label: "Combining ability", value: ca.topology.kind.replace("_", " × "), sub: `${ca.topology.n_lines} lines · pools ${ca.topology.pools.map((p) => p.pool).join("/")}` });
  }
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

function relLabel(r: string) {
  return ({ identity: "Identity", A: "Pedigree (A)", G: "Genomic (G)", H: "Single-step (H)" } as Record<string, string>)[r] ?? r;
}

function AdvanceStep({ advancements }: { advancements: Array<{ candidate: string; unit: string; pool: string | null; disposition: string }> }) {
  if (advancements.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><ClipboardCheck size={20} /></div>
        <p className="mt-3 text-sm font-medium text-slate-700">No advancement decisions yet</p>
        <p className="mt-1 text-xs text-slate-500">Go to <b>Select</b> and advance the parents or hybrids you want to recycle — they&rsquo;ll be recorded here, the close of the analysis→select→advance arc.</p>
      </div>
    );
  }
  const inbreds = advancements.filter((a) => a.unit === "inbred");
  const hybrids = advancements.filter((a) => a.unit === "hybrid");
  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-600 text-white"><ClipboardCheck size={15} /></div>
        <h3 className="text-sm font-semibold text-slate-800">Advancement decisions</h3>
        <span className="text-[11px] text-slate-400">recorded for this analysis</span>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <LedgerCol title={`Parents · ${inbreds.length}`} rows={inbreds} />
        <LedgerCol title={`Hybrids · ${hybrids.length}`} rows={hybrids} />
      </div>
    </section>
  );
}

function LedgerCol({ title, rows }: { title: string; rows: Array<{ candidate: string; pool: string | null; disposition: string }> }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-slate-400">none yet</div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <li key={r.candidate} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
              {r.pool && <span className={`h-1.5 w-1.5 rounded-full ${r.pool === "A" ? "bg-sky-500" : "bg-violet-500"}`} />}
              {r.candidate}
            </li>
          ))}
        </ul>
      )}
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
