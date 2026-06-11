"use client";

import { useMemo, useState } from "react";
import { Leaf, FlaskConical, AlertTriangle, Sprout } from "lucide-react";
import { analyze, getDemoData } from "@/lib/api";
import {
  recomputeIndex,
  defaultWeights,
  defaultDirections,
} from "@/lib/selection";
import type { Bundle, TrialRow } from "@/lib/types";
import DataBar, { type Cols } from "@/components/DataBar";
import HeritabilityCards from "@/components/HeritabilityCards";
import SelectionTable from "@/components/SelectionTable";
import TraitControls from "@/components/TraitControls";
import IndexChart from "@/components/IndexChart";
import Assistant from "@/components/Assistant";

export default function Home() {
  const [raw, setRaw] = useState<TrialRow[] | null>(null);
  const [traits, setTraits] = useState<string[]>([]);
  const [cols, setCols] = useState<Cols>({
    genotype: "genotype",
    env: "env",
    block: "block",
  });
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [directions, setDirections] = useState<Record<string, number>>({});
  const [engine, setEngine] = useState("lme4");
  const [effect, setEffect] = useState("random");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  async function runAnalyze(
    data: TrialRow[],
    tr: string[],
    c: Cols,
    eng: string,
    eff: string
  ) {
    setLoading(true);
    setError(null);
    try {
      const b = await analyze({
        data,
        traits: tr,
        genotype: c.genotype,
        env: c.env,
        block: c.block,
        engine: eng,
        genotype_effect: eff,
      });
      setBundle(b);
      setWeights(defaultWeights(b.traits));
      setDirections(defaultDirections(b.traits));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDemo() {
    setLoading(true);
    setError(null);
    try {
      const demo = await getDemoData();
      const c = { genotype: demo.genotype, env: demo.env, block: demo.block };
      setRaw(demo.data);
      setTraits(demo.traits);
      setCols(c);
      setSource(`Demo: ${demo.data.length} plots · ${demo.traits.length} traits`);
      await runAnalyze(demo.data, demo.traits, c, engine, effect);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  function handleUpload(rows: TrialRow[], tr: string[], c: Cols) {
    setRaw(rows);
    setTraits(tr);
    setCols(c);
    setSource(`Uploaded: ${rows.length} rows · ${tr.length} traits`);
    runAnalyze(rows, tr, c, engine, effect);
  }

  function changeEngine(v: string) {
    setEngine(v);
    if (raw) runAnalyze(raw, traits, cols, v, effect);
  }
  function changeEffect(v: string) {
    setEffect(v);
    if (raw) runAnalyze(raw, traits, cols, engine, v);
  }

  const ranking = useMemo(
    () => (bundle ? recomputeIndex(bundle, weights, directions) : []),
    [bundle, weights, directions]
  );

  const warnings = bundle
    ? Array.isArray(bundle.warnings)
      ? bundle.warnings
      : bundle.warnings
      ? [bundle.warnings]
      : []
    : [];

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-green-700 text-white shadow-sm">
            <Leaf size={18} />
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight text-slate-900">
              Verdant
            </div>
            <div className="text-[11px] text-slate-500">Breeding Analytics</div>
          </div>
          {bundle && (
            <span className="ml-3 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              <FlaskConical size={11} /> {bundle.engine}
            </span>
          )}
          <div className="ml-auto text-xs text-slate-400">
            AI-native · trustworthy by design
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          {/* Left: analysis */}
          <div className="space-y-5">
            <DataBar
              onLoadDemo={loadDemo}
              onUpload={handleUpload}
              engine={engine}
              effect={effect}
              onEngine={changeEngine}
              onEffect={changeEffect}
              loading={loading}
              source={source}
            />

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <AlertTriangle size={16} /> {error}
              </div>
            )}

            {!bundle && !loading && (
              <div className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-20 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <Sprout size={26} />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-slate-800">
                  Analyze a breeding trial
                </h2>
                <p className="mt-1 max-w-md text-sm text-slate-500">
                  Load the demo tomato trial (or upload your own CSV) to get
                  correct mixed-model BLUPs, heritabilities, and a live,
                  re-weightable selection ranking — then ask the assistant about
                  it.
                </p>
              </div>
            )}

            {bundle && (
              <div className="space-y-5">
                {warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                    {warnings.join(" · ")}
                  </div>
                )}

                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">
                    Heritability
                  </h3>
                  <HeritabilityCards bundle={bundle} />
                </section>

                <section className="grid grid-cols-1 gap-5 xl:grid-cols-5">
                  <div className="xl:col-span-3">
                    <h3 className="mb-2 text-sm font-semibold text-slate-700">
                      Selection ranking
                    </h3>
                    <SelectionTable rows={ranking} traits={bundle.traits} />
                  </div>
                  <div className="space-y-5 xl:col-span-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <h3 className="mb-3 text-sm font-semibold text-slate-700">
                        Index weights
                      </h3>
                      <TraitControls
                        traits={bundle.traits}
                        weights={weights}
                        directions={directions}
                        onWeight={(t, v) =>
                          setWeights((w) => ({ ...w, [t]: v }))
                        }
                        onDirection={(t, v) =>
                          setDirections((d) => ({ ...d, [t]: v }))
                        }
                      />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <h3 className="mb-2 text-sm font-semibold text-slate-700">
                        Top of the index
                      </h3>
                      <IndexChart rows={ranking} />
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>

          {/* Right: assistant */}
          <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-7rem)]">
            <Assistant bundle={bundle} />
          </div>
        </div>
      </main>
    </div>
  );
}
