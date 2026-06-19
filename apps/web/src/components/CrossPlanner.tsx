"use client";

// The Cross step (ADR-0024) — the FORWARD half of the breeding cycle: "which product cross is most likely
// to succeed?" Across-pool A×B crosses ranked by the market-weighted sum of parental GCA, gated on whether
// the cross DELIVERS each required disease allele (either parent carries it → dominant resistance fixes in
// the F1), then greedily composed into a portfolio under a per-parent use cap. All derived live from the
// combining_ability the run already carries (buildCrossPlan) — the breeder's gate toggles and portfolio
// limits recompute instantly. GCA-only by design: these crosses are unmade, so SCA is unknowable until
// they're tested — and the pool split, not a coancestry penalty, supplies the diversity (see ADR-0024).
import { useMemo, useState } from "react";
import type { ResultBundle } from "@verdant/contracts";
import { Combine, ShieldCheck, Dna, X, ChevronDown, ChevronRight, Info, Plus, Minus, Recycle, Sprout } from "lucide-react";
import { getCombiningAbility, getRecycling, type MarkerGates, type Recycling, type RecyclePool, type RecycleCross } from "@/lib/ca";
import { buildCrossPlan, humanizeTrait, type CrossCandidate, type CrossTraitTerm } from "@/lib/cross-plan";

const COLORS = ["#0ea5e9", "#8b5cf6"]; // poolA, poolB
type CaT = NonNullable<ReturnType<typeof getCombiningAbility>>;

// The Cross step: two crossing modes (ADR-0024). Product = across-pool A×B (which F1 to sell); Recycle =
// within-pool line×line (what to recombine to keep the pool productive), shown as usefulness-vs-OCS.
export default function CrossPlanner({ bundle, testcrossTrials = [], included = [], onAddTestcross }: {
  bundle: ResultBundle;
  testcrossTrials?: { trial_id: string; label: string }[];
  included?: string[];
  onAddTestcross?: (id: string) => void;
}) {
  const ca = useMemo(() => getCombiningAbility(bundle), [bundle]);
  const recycling = useMemo(() => getRecycling(ca), [ca]);
  const [mode, setMode] = useState<"product" | "recycle">("product");
  if (!ca) return <NoCrosses testcrossTrials={testcrossTrials} included={included} onAdd={onAddTestcross} />;
  return (
    <section className="space-y-4">
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
        <ModeTab active={mode === "product"} onClick={() => setMode("product")} icon={<Combine size={13} />}>Product · across-pool</ModeTab>
        <ModeTab active={mode === "recycle"} onClick={() => setMode("recycle")} icon={<Recycle size={13} />}>Recycle · within-pool</ModeTab>
      </div>
      {mode === "product" ? (
        <ProductCross ca={ca} />
      ) : recycling ? (
        <RecyclePlanner recycling={recycling} />
      ) : (
        <Empty msg="No within-pool recycling on this run — the heterotic pools were too small to fit." />
      )}
    </section>
  );
}

function ModeTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${active ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
      {icon}{children}
    </button>
  );
}

function ProductCross({ ca }: { ca: CaT }) {
  const [gates, setGates] = useState<MarkerGates>({});
  const [maxPerParent, setMaxPerParent] = useState(3);
  const [nCrosses, setNCrosses] = useState(12);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const plan = useMemo(() => buildCrossPlan(ca, { gates, maxPerParent, nCrosses, excluded }), [ca, gates, maxPerParent, nCrosses, excluded]);
  if (plan.note) return <Empty msg={plan.note} />;

  const [poolA, poolB] = plan.pools!;
  const maxMerit = Math.max(1e-6, ...plan.candidates.filter((c) => !c.gatedOut).map((c) => c.merit));
  const exclude = (key: string) => setExcluded((s) => new Set(s).add(key));
  const restore = () => setExcluded(new Set());

  return (
    <section className="space-y-4">
      {/* heading */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Combine size={15} /></div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Plan product crosses</h3>
            <p className="text-[11px] text-slate-400">Which across-pool A×B cross is most likely to succeed — ranked by combined GCA on your market index.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: COLORS[0] }} /> {poolA}</span>
          <span className="text-slate-300">×</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: COLORS[1] }} /> {poolB}</span>
        </div>
      </div>

      {/* objective + GCA caveat */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px]">
        <span className="font-medium text-slate-600">Market objective:</span>
        {plan.objective.map((w) => (
          <span key={w.variable_id} className="inline-flex items-center gap-1 text-slate-600">
            <span className={w.mode === "min" ? "text-rose-500" : "text-emerald-600"}>{w.mode === "min" ? "↓" : "↑"}</span>
            {humanizeTrait(w.variable_id)} <span className="tabular-nums text-slate-400">{Math.round(w.weight * 100)}%</span>
          </span>
        ))}
      </div>
      <div className="flex items-start gap-1.5 rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2 text-[11px] leading-snug text-sky-800">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>Ranked on <b>GCA</b> — the predictable, transmissible combining value — because these crosses are unmade. SCA (the cross-specific deviation) is only knowable once a cross is made and tested. Diversity comes from crossing <i>across</i> heterotic pools; no coancestry penalty is applied at the product level.</span>
      </div>

      {/* controls: gates + portfolio limits */}
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <CrossGates ca={ca} gates={gates} onChange={setGates} poolA={poolA} poolB={poolB} />
        <div className="flex flex-col justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <Stepper label="Crosses to make" value={nCrosses} set={setNCrosses} min={1} max={30} />
          <Stepper label="Max uses / parent" value={maxPerParent} set={setMaxPerParent} min={1} max={8} hint="caps reliance on any one inbred" />
        </div>
      </div>

      {/* the plan */}
      <div className="rounded-2xl border border-emerald-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-700">Recommended cross plan</h4>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{plan.selected.length} crosses · {plan.nParentsUsed} parents</span>
          </div>
          {excluded.size > 0 && (
            <button type="button" onClick={restore} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
              <X size={11} /> Restore {excluded.size} excluded
            </button>
          )}
        </div>
        {plan.selected.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400">No crosses clear the active gates. Relax a gate or raise the per-parent cap.</p>
        ) : (
          <ul className="divide-y divide-slate-50">
            {plan.selected.map((c, i) => (
              <CrossRow key={c.key} c={c} order={i + 1} maxMerit={maxMerit} onExclude={() => exclude(c.key)} />
            ))}
          </ul>
        )}
      </div>

      {/* the full ranked field */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button type="button" onClick={() => setShowAll((v) => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <span className="flex items-center gap-2">{showAll ? <ChevronDown size={15} /> : <ChevronRight size={15} />} All {plan.candidates.length} candidate crosses</span>
          <span className="text-[11px] font-normal text-slate-400">{plan.candidates.filter((c) => !c.gatedOut).length} clear the gates</span>
        </button>
        {showAll && (
          <div className="max-h-[28rem] overflow-auto border-t border-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                <tr><Th>#</Th><Th>Cross</Th><Th className="text-right">Index merit</Th>{plan.objective.map((w) => <Th key={w.variable_id} className="text-right">{humanizeTrait(w.variable_id)}</Th>)}<Th>Gates</Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {plan.candidates.map((c) => (
                  <tr key={c.key} className={c.gatedOut ? "text-slate-300" : c.selected ? "bg-emerald-50/40" : ""}>
                    <Td className="tabular-nums text-slate-400">{c.rank}</Td>
                    <Td>
                      <span className="font-medium text-slate-700">{c.parent1}</span>
                      <span className="text-slate-300"> × </span>
                      <span className="font-medium text-slate-700">{c.parent2}</span>
                      {c.selected && <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-700">in plan</span>}
                    </Td>
                    <Td className="text-right tabular-nums font-medium">{c.merit >= 0 ? "+" : ""}{c.merit.toFixed(2)}</Td>
                    {c.perTrait.map((t) => <Td key={t.variable_id} className="text-right tabular-nums">{t.combined_gca >= 0 ? "+" : ""}{t.combined_gca.toFixed(2)}</Td>)}
                    <Td>{c.gates.length === 0 ? <span className="text-slate-300">—</span> : c.gates.map((g) => <GateDot key={g.locus} delivered={g.delivered} locus={g.locus} />)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function CrossRow({ c, order, maxMerit, onExclude }: {
  c: CrossCandidate; order: number; maxMerit: number; onExclude: () => void;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-100 text-[11px] font-semibold tabular-nums text-slate-500">{order}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1 font-medium text-slate-800">
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[0] }} />{c.parent1}
          </span>
          <Combine size={12} className="text-slate-300" />
          <span className="inline-flex items-center gap-1 font-medium text-slate-800">
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[1] }} />{c.parent2}
          </span>
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] tabular-nums text-slate-500">
            merit {c.merit >= 0 ? "+" : ""}{c.merit.toFixed(2)}
          </span>
        </div>
        {/* per-trait combined-GCA chips */}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {c.perTrait.map((t) => <TraitChip key={t.variable_id} t={t} />)}
        </div>
        {/* deterministic rationale */}
        {c.reasons.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            {c.reasons.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5">
                {r.startsWith("carries ") ? <ShieldCheck size={10} className="text-emerald-500" /> : null}{r}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="ml-1 w-20 shrink-0">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, Math.min(100, (c.merit / maxMerit) * 100))}%` }} />
        </div>
      </div>
      <button type="button" onClick={onExclude} title="Remove from plan" className="shrink-0 rounded-md p-1 text-slate-300 hover:bg-slate-50 hover:text-slate-500"><X size={13} /></button>
    </li>
  );
}

function TraitChip({ t }: { t: CrossTraitTerm }) {
  const good = t.merit >= 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums ${good ? "border-emerald-100 bg-emerald-50/60 text-emerald-700" : "border-rose-100 bg-rose-50/50 text-rose-600"}`}
      title={`combined GCA = ${t.p1 >= 0 ? "+" : ""}${t.p1} + ${t.p2 >= 0 ? "+" : ""}${t.p2}`}>
      {humanizeTrait(t.variable_id)} {t.combined_gca >= 0 ? "+" : ""}{t.combined_gca}
    </span>
  );
}

function GateDot({ delivered, locus }: { delivered: boolean; locus: string }) {
  return (
    <span title={`${locus}: ${delivered ? "delivered (a parent carries it)" : "neither parent carries it"}`}
      className={`mr-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[10px] ${delivered ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-500"}`}>
      {delivered ? <ShieldCheck size={9} /> : <X size={9} />}{locus}
    </span>
  );
}

// Cross-level marker gates: require a favourable allele be DELIVERABLE by the cross (either parent carries
// it → a dominant resistance fixes in the F1). Distinct from the within-line gate on the parent levels.
function CrossGates({ ca, gates, onChange, poolA, poolB }: {
  ca: NonNullable<ReturnType<typeof getCombiningAbility>>; gates: MarkerGates; onChange: (g: MarkerGates) => void; poolA: string; poolB: string;
}) {
  const catalog = ca.loci_catalog ?? [];
  const carriers = useMemo(() => {
    const c: Record<string, number> = {};
    const inPools = ca.gca.filter((g) => g.pool === poolA || g.pool === poolB);
    for (const L of catalog) c[L.locus] = inPools.filter((g) => g.loci?.[L.locus] === L.favorable).length;
    return c;
  }, [ca.gca, catalog, poolA, poolB]);

  if (catalog.length === 0) return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-400 shadow-sm">No marker panel on this cut.</div>;
  const toggle = (locus: string, favorable: string) => {
    const on = (gates[locus]?.length ?? 0) > 0;
    const g = { ...gates };
    if (on) delete g[locus]; else g[locus] = [favorable];
    onChange(g);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-slate-100"><Dna size={13} className="text-slate-500" /></div>
        <h4 className="text-sm font-semibold text-slate-700">Require disease resistance</h4>
        <span className="text-[11px] text-slate-400">a cross passes if either parent carries the allele (dominant → fixed in the F1)</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {catalog.map((L) => {
          const on = (gates[L.locus]?.length ?? 0) > 0;
          return (
            <button key={L.locus} type="button" onClick={() => toggle(L.locus, L.favorable)}
              title={`${L.trait} — ${carriers[L.locus]} candidate parents carry ${L.favorable}`}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition ${on ? "border-emerald-500 bg-emerald-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              <ShieldCheck size={12} className={on ? "text-white" : "text-emerald-500"} />
              <span className="font-mono">{L.locus}</span>
              <span className={on ? "text-emerald-100" : "text-slate-400"}>{L.trait}</span>
              <span className={`tabular-nums ${on ? "text-emerald-100" : "text-slate-400"}`}>{carriers[L.locus]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stepper({ label, value, set, min, max, hint }: { label: string; value: number; set: (n: number) => void; min: number; max: number; hint?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs font-medium text-slate-600">{label}</div>
        <div className="inline-flex items-center gap-1">
          <StepBtn onClick={() => set(Math.max(min, value - 1))} disabled={value <= min}><Minus size={12} /></StepBtn>
          <span className="w-7 text-center text-sm font-semibold tabular-nums text-slate-800">{value}</span>
          <StepBtn onClick={() => set(Math.min(max, value + 1))} disabled={value >= max}><Plus size={12} /></StepBtn>
        </div>
      </div>
      {hint && <p className="mt-0.5 text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}
function StepBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-30">{children}</button>;
}
function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>; }
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <td className={`px-3 py-2 ${className}`}>{children}</td>; }
function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-400"><Combine size={17} /></div>
      <p className="mt-3 text-sm text-slate-500">{msg}</p>
    </div>
  );
}

// Shown when the cut carries no testcross trial (so no combining ability to plan from). Explains why and
// offers a one-click add of an available testcross trial — making cross-planning discoverable from any cut.
function NoCrosses({ testcrossTrials, included, onAdd }: {
  testcrossTrials: { trial_id: string; label: string }[]; included: string[]; onAdd?: (id: string) => void;
}) {
  const addable = testcrossTrials.filter((t) => !included.includes(t.trial_id));
  const presentButThin = testcrossTrials.some((t) => included.includes(t.trial_id));
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Combine size={18} /></div>
      <p className="mt-3 text-sm font-medium text-slate-700">No crosses to plan on this cut</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
        Product cross-planning ranks across-pool A×B crosses by <b>combining ability</b>, so it needs an
        F1 <b>testcross</b> trial in the cut to estimate GCA. This cut has none
        {presentButThin ? " with enough lines for a GCA fit" : ""}.
      </p>
      {addable.length > 0 && onAdd && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {addable.map((t) => (
              <button key={t.trial_id} type="button" onClick={() => onAdd(t.trial_id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700">
                <Plus size={13} /> Add {t.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Adds it to your cut and opens the Model step — press Run to plan crosses.</p>
        </>
      )}
    </div>
  );
}

// ===== Recycle (within-pool) — usefulness vs OCS, the teaching contrast (ADR-0024 mode 2) =====
function RecyclePlanner({ recycling }: { recycling: Recycling }) {
  const pools = Object.keys(recycling);
  const [pool, setPool] = useState(pools[0]);
  const rp: RecyclePool | undefined = recycling[pool] ?? recycling[pools[0]];
  if (!rp) return <Empty msg="No recycling pools on this run." />;
  const c = rp.comparison;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-violet-50 text-violet-600"><Recycle size={15} /></div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Recycle within {pool}</h3>
            <p className="text-[11px] text-slate-400">Which line×line crosses to recombine into the next inbred generation — chasing gain vs. holding the pool&apos;s diversity.</p>
          </div>
        </div>
        {pools.length > 1 && (
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {pools.map((p, i) => (
              <button key={p} type="button" onClick={() => setPool(p)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${pool === p ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % 2] }} />{p}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-start gap-1.5 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2 text-[11px] leading-snug text-violet-900">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span><b>Usefulness</b> ranks each cross by <code>μ + i·σ</code> (progeny mean + the variance it throws) and greedily takes the best — which piles onto a few elite, related lines. <b>OCS</b> maximises the same gain but caps <b>group coancestry</b>, spreading across more parents to protect the pool&apos;s long-term variance. Selection intensity i = {rp.selection_intensity} (top {Math.round(rp.sel_prop * 100)}%).</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.2fr]">
        <PlanCard tone="amber" title="Usefulness" subtitle="greedy · chase gain" pt={c.usefulness_point} nCrosses={rp.usefulness_plan.n_crosses} />
        <PlanCard tone="emerald" title="OCS" subtitle="cap coancestry" pt={c.ocs_point} nCrosses={rp.ocs_plan.n_crosses} />
        <Frontier frontier={rp.frontier} useful={c.usefulness_point} ocs={c.ocs_point} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] leading-relaxed text-slate-600 shadow-sm">
        OCS gives up <b className="text-amber-700">{c.gain_cost.toFixed(2)}</b> gain to save <b className="text-emerald-700">{c.coancestry_saved.toFixed(3)}</b> group coancestry and keep <b className="text-emerald-700">{c.eff_parents_gained.toFixed(1)}</b> more effective parents — only <b>{c.shared_crosses}/{rp.n_crosses}</b> crosses are shared between the two plans.
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <CrossList title="Usefulness plan" tone="amber" crosses={rp.usefulness_plan.crosses} />
        <CrossList title="OCS plan" tone="emerald" crosses={rp.ocs_plan.crosses} />
      </div>
    </div>
  );
}

function PlanCard({ tone, title, subtitle, pt, nCrosses }: { tone: "amber" | "emerald"; title: string; subtitle: string; pt: { gain: number; coancestry: number; eff_parents: number }; nCrosses: number }) {
  const ring = tone === "amber" ? "border-amber-200" : "border-emerald-200";
  return (
    <div className={`rounded-2xl border ${ring} bg-white p-3 shadow-sm`}>
      <div className="flex items-baseline justify-between"><h4 className="text-sm font-semibold text-slate-700">{title}</h4><span className="text-[10px] text-slate-400">{subtitle}</span></div>
      <dl className="mt-2 space-y-1 text-[12px]">
        <Stat label="gain (Σ index)" value={`${pt.gain >= 0 ? "+" : ""}${pt.gain.toFixed(2)}`} />
        <Stat label="group coancestry" value={pt.coancestry.toFixed(3)} />
        <Stat label="effective parents" value={pt.eff_parents.toFixed(1)} />
        <Stat label="crosses" value={String(nCrosses)} />
      </dl>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><dt className="text-slate-500">{label}</dt><dd className="font-medium tabular-nums text-slate-800">{value}</dd></div>;
}

function Frontier({ frontier, useful, ocs }: { frontier: { gain: number; coancestry: number }[]; useful: { gain: number; coancestry: number }; ocs: { gain: number; coancestry: number } }) {
  const W = 280, H = 150, pad = 30;
  const xs = frontier.map((f) => f.coancestry).concat(useful.coancestry, ocs.coancestry);
  const ys = frontier.map((f) => f.gain).concat(useful.gain, ocs.gain);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const sx = (x: number) => pad + (xmax > xmin ? (x - xmin) / (xmax - xmin) : 0.5) * (W - pad - 10);
  const sy = (y: number) => H - pad - (ymax > ymin ? (y - ymin) / (ymax - ymin) : 0.5) * (H - pad - 12);
  const pts = [...frontier].sort((a, b) => a.coancestry - b.coancestry).map((f) => `${sx(f.coancestry).toFixed(1)},${sy(f.gain).toFixed(1)}`).join(" ");
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="px-1 text-[11px] font-medium text-slate-600">Gain vs. coancestry frontier</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="gain vs coancestry frontier">
        <line x1={pad} y1={H - pad} x2={W - 6} y2={H - pad} stroke="#e2e8f0" />
        <line x1={pad} y1={8} x2={pad} y2={H - pad} stroke="#e2e8f0" />
        <text x={(W + pad) / 2} y={H - 6} textAnchor="middle" fontSize="8" className="fill-slate-400">group coancestry →</text>
        <text x={10} y={(H - pad) / 2} textAnchor="middle" fontSize="8" className="fill-slate-400" transform={`rotate(-90 10 ${(H - pad) / 2})`}>gain →</text>
        <polyline points={pts} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
        <circle cx={sx(useful.coancestry)} cy={sy(useful.gain)} r="4" fill="#f59e0b" />
        <text x={sx(useful.coancestry) - 6} y={sy(useful.gain) + 3} textAnchor="end" fontSize="8" className="fill-amber-600">usefulness</text>
        <circle cx={sx(ocs.coancestry)} cy={sy(ocs.gain)} r="4" fill="#10b981" />
        <text x={sx(ocs.coancestry) + 6} y={sy(ocs.gain) + 3} textAnchor="start" fontSize="8" className="fill-emerald-600">OCS</text>
      </svg>
    </div>
  );
}

function CrossList({ title, tone, crosses }: { title: string; tone: "amber" | "emerald"; crosses: RecycleCross[] }) {
  const head = tone === "amber" ? "text-amber-700" : "text-emerald-700";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className={`border-b border-slate-100 px-3 py-2 text-xs font-semibold ${head}`}>{title} <span className="font-normal text-slate-400">· {crosses.length} crosses</span></div>
      <ul className="max-h-[20rem] divide-y divide-slate-50 overflow-auto text-[12px]">
        {crosses.map((c, i) => (
          <li key={`${c.p1}-${c.p2}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="inline-flex items-center gap-1 font-medium text-slate-700"><Sprout size={11} className="text-slate-300" />{c.p1} <span className="text-slate-300">×</span> {c.p2}</span>
            <span className="flex items-center gap-2 tabular-nums text-[11px] text-slate-500">
              <span title="midparent breeding value">μ {c.midparent >= 0 ? "+" : ""}{c.midparent.toFixed(2)}</span>
              <span title="progeny SD — the variance this cross throws" className="text-slate-400">σ {c.sigma.toFixed(2)}</span>
              <span title="parental coancestry (lower = more outbred)" className={c.coancestry > 0.1 ? "text-rose-500" : "text-slate-400"}>r {c.coancestry.toFixed(2)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
