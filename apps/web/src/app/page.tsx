import { Leaf, FlaskConical, Sprout } from "lucide-react";
import { getLatestResult } from "@/lib/data";
import InsightBanner from "@/components/InsightBanner";
import HeritabilityCards from "@/components/HeritabilityCards";
import GeneticCorrelations from "@/components/GeneticCorrelations";
import IndexExplorer from "@/components/IndexExplorer";

// Always read the freshest persisted result from Postgres.
export const dynamic = "force-dynamic";

export default async function Home() {
  const result = await getLatestResult();

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
          <div className="ml-auto text-xs text-slate-400">AI-native · trustworthy by design</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        {!result ? (
          <EmptyState />
        ) : (
          <div className="space-y-5">
            <InsightBanner bundle={result.bundle} />

            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Heritability</h3>
              <HeritabilityCards bundle={result.bundle} />
            </section>

            <GeneticCorrelations bundle={result.bundle} />

            <IndexExplorer bundle={result.bundle} />
          </div>
        )}
      </main>
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
        Run an analysis to see spatially-adjusted BLUPs, heritability, and a ranked selection
        index. Try:{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
          pnpm --filter @verdant/jobs run demo
        </code>
      </p>
    </div>
  );
}
