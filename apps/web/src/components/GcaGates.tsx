"use client";

// Marker gates (ADR-0020) — interactive, marker-assisted culling. Pick a locus, pick the desired
// allele(s), and lines not carrying them are gated out of selection (independent culling, applied
// before the index ranks survivors — and consistently across every lens). Reads the directly-observed
// inbred allele calls (synthetic here; real tomato genotyping later), never anything inferred from hybrids.
import { useMemo } from "react";
import { Dna, ShieldCheck, X } from "lucide-react";
import { lineFailsGates, activeGateLoci, type CombiningAbility, type MarkerGates } from "@/lib/ca";

export default function GcaGates({
  ca, pool, gates, onChange,
}: { ca: CombiningAbility; pool: string; gates: MarkerGates; onChange: (g: MarkerGates) => void }) {
  const catalog = ca.loci_catalog ?? [];
  const members = useMemo(() => ca.gca.filter((g) => g.pool === pool), [ca.gca, pool]);

  // per-locus per-allele carrier count within the pool (context for the breeder)
  const counts = useMemo(() => {
    const c: Record<string, Record<string, number>> = {};
    for (const g of members) for (const [l, a] of Object.entries(g.loci ?? {})) {
      (c[l] ??= {}); c[l][a] = (c[l][a] ?? 0) + 1;
    }
    return c;
  }, [members]);

  const active = activeGateLoci(gates);
  const pass = useMemo(() => members.filter((g) => !lineFailsGates(g, gates)).length, [members, gates]);

  const toggle = (locus: string, allele: string) => {
    const cur = gates[locus] ?? [];
    const next = cur.includes(allele) ? cur.filter((a) => a !== allele) : [...cur, allele];
    const g = { ...gates, [locus]: next };
    if (next.length === 0) delete g[locus];
    onChange(g);
  };
  const clear = () => onChange({});

  if (catalog.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-slate-100"><Dna size={13} className="text-slate-500" /></div>
          <h3 className="text-sm font-semibold text-slate-700">Marker gates</h3>
          <span className="text-[11px] text-slate-400">pick a locus &amp; the desired allele(s) — lines without them are culled</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">
            <b className={pass < members.length ? "text-emerald-700" : "text-slate-700"}>{pass}</b> of {members.length} pass in pool {pool}
          </span>
          {active.length > 0 && (
            <button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
              <X size={11} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {catalog.map((L) => {
          const sel = gates[L.locus] ?? [];
          const on = sel.length > 0;
          return (
            <div key={L.locus} className={`rounded-xl border p-2.5 transition ${on ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200"}`}>
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-xs font-semibold text-slate-800">{L.locus}</span>
                  <span className="text-[11px] text-slate-500">{L.trait}</span>
                </div>
                {on && <span className="text-[10px] font-medium text-emerald-700">require {sel.join(" / ")}</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {L.alleles.map((a) => {
                  const picked = sel.includes(a);
                  const fav = a === L.favorable;
                  const n = counts[L.locus]?.[a] ?? 0;
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => toggle(L.locus, a)}
                      title={`${n} line${n === 1 ? "" : "s"} in pool ${pool} carry ${a}`}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[11px] transition ${
                        picked ? "border-emerald-500 bg-emerald-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {fav && <ShieldCheck size={11} className={picked ? "text-white" : "text-emerald-500"} />}
                      {a}
                      <span className={`tabular-nums ${picked ? "text-emerald-100" : "text-slate-400"}`}>{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-400">
        Gates cull first; the index then ranks only survivors — and the cull holds across every lens. Alleles read from
        directly-observed inbred genotypes (the <ShieldCheck size={10} className="inline text-emerald-500" /> allele is the favourable one).
      </p>
    </div>
  );
}
