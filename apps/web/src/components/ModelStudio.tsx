"use client";
// Model Studio (ADR-0018): the breeder's interactive override surface. The planner recommends every
// decision (sibling panel ModelReadiness explains them); here each axis is a control pre-set to the
// recommendation, with infeasible values locked + explained. "Re-run with these settings" calls the
// rerunWithOverrides Server Action — relationship-only changes re-point in seconds, structural changes
// refit. The whole menu is always shown (no model hidden); R owns feasibility, this only renders it.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Grid3x3, Layers, Network, Dna, Cpu, RotateCcw, Play, Loader2, Lock, CheckCircle2, AlertTriangle, type LucideIcon } from "lucide-react";
import type { ResultBundle } from "@verdant/contracts";
import { rerunWithOverrides, type Refusal } from "@/app/actions";

type Decision = NonNullable<NonNullable<ResultBundle["chosen_model"]["decisions"]>[number]>;
type Overridable = NonNullable<NonNullable<ResultBundle["chosen_model"]["overridable"]>[number]>;

type Factor = "spatial" | "staging" | "gxe" | "relationship" | "engine";
const AXES: { factor: Factor; label: string; icon: LucideIcon; labels: Record<string, string> }[] = [
  { factor: "relationship", label: "Relationship / GRM", icon: Dna, labels: { identity: "Identity", A: "Pedigree (A)", G: "Genomic (G)", H: "Single-step (H)" } },
  { factor: "engine", label: "Genomic engine", icon: Cpu, labels: { rrblup: "rrBLUP", blupf90: "BLUPF90" } },
  { factor: "spatial", label: "Spatial", icon: Grid3x3, labels: { spats: "SpATS", none: "None" } },
  { factor: "staging", label: "Staging", icon: Layers, labels: { single_stage: "One-stage", two_stage: "Two-stage" } },
  { factor: "gxe", label: "GxE", icon: Network, labels: { include: "Include", skip: "Fold into residual" } },
];

export default function ModelStudio({ bundle }: { bundle: ResultBundle }) {
  const decisions = bundle.chosen_model?.decisions ?? [];
  const overridable = bundle.chosen_model?.overridable ?? [];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ status: string; refusals?: Refusal[]; error?: string } | null>(null);

  // current resolved choice + recommendation per axis (the planner's record).
  const current = useMemo(() => {
    const m: Record<string, { choice: string; recommended: string; reason: string; evidence?: Record<string, unknown> | null }> = {};
    for (const d of decisions) m[d.factor] = { choice: d.choice, recommended: d.recommended ?? d.choice, reason: d.reason, evidence: d.evidence };
    return m;
  }, [decisions]);
  const optionsFor = (f: Factor): Overridable["options"] =>
    overridable.find((o) => o.factor === f)?.options ?? [];

  // local selection, initialized to the resolved choice.
  const [sel, setSel] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {};
    for (const a of AXES) if (current[a.factor]) s[a.factor] = current[a.factor].choice;
    return s;
  });

  const axesPresent = AXES.filter((a) => current[a.factor] && optionsFor(a.factor).length > 0);
  if (axesPresent.length === 0) return null;

  const changed = axesPresent.filter((a) => sel[a.factor] !== current[a.factor].choice).map((a) => a.factor);
  const diverged = changed.length > 0;
  // relationship + engine are instant re-points from precomputed GEBVs; structural axes need a refit.
  const FAST = new Set(["relationship", "engine"]);
  const scope: "full" | "relationship_only" =
    changed.length > 0 && changed.every((f) => FAST.has(f)) ? "relationship_only" : "full";

  const reset = () => {
    const s: Record<string, string> = {};
    for (const a of axesPresent) s[a.factor] = current[a.factor].choice;
    setSel(s);
    setResult(null);
  };

  const run = () => {
    setResult(null);
    const overrides = Object.fromEntries(axesPresent.map((a) => [a.factor, sel[a.factor]]));
    start(async () => {
      const r = await rerunWithOverrides({ overrides, scope });
      setResult(r);
      if (r.status === "ok" || r.status === "refused") router.refresh();
    });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Model Studio</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Every choice is the planner&apos;s recommendation — override any of them and re-run. Locked options show what data would unlock them.
          </p>
        </div>
        {diverged && (
          <button onClick={reset} disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RotateCcw size={13} /> Reset to recommended
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {axesPresent.map((a) => (
          <AxisControl key={a.factor} axis={a} options={optionsFor(a.factor)}
            cur={current[a.factor]} selected={sel[a.factor]}
            onPick={(v) => setSel((s) => ({ ...s, [a.factor]: v }))} disabled={pending} />
        ))}
      </div>

      {result?.status === "refused" && result.refusals && result.refusals.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle size={15} /> Some overrides weren&apos;t feasible — the planner kept its recommendation
          </div>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-700">
            {result.refusals.map((r, i) => (
              <li key={i}><span className="font-medium uppercase">{r.factor}</span> → kept {r.recommended}: {r.refused_reason}</li>
            ))}
          </ul>
        </div>
      )}
      {result?.status === "error" && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Re-run failed: {result.error}</div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={run} disabled={!diverged || pending}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {pending
            ? scope === "relationship_only" ? "Re-pointing breeding values…" : "Re-fitting — this can take a few minutes…"
            : "Re-run with these settings"}
        </button>
        {diverged && !pending && (
          <span className="text-xs text-slate-400">
            {scope === "relationship_only" ? "Fast: re-points the ranking (seconds)." : "Full refit of the variance components."}
          </span>
        )}
      </div>
    </section>
  );
}

function AxisControl({
  axis, options, cur, selected, onPick, disabled,
}: {
  axis: { factor: Factor; label: string; icon: LucideIcon; labels: Record<string, string> };
  options: Overridable["options"];
  cur: { choice: string; recommended: string; reason: string; evidence?: Record<string, unknown> | null };
  selected: string;
  onPick: (v: string) => void;
  disabled: boolean;
}) {
  const Icon = axis.icon;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-slate-100"><Icon size={13} className="text-slate-500" /></div>
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{axis.label}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((o) => {
          const isSel = selected === o.value;
          const isRec = cur.recommended === o.value;
          const locked = !o.feasible;
          return (
            <button key={o.value} disabled={disabled || locked} onClick={() => onPick(o.value)}
              title={locked ? o.reason ?? "Not available with this data" : undefined}
              className={[
                "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition",
                locked ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                  : isSel ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50",
              ].join(" ")}>
              {locked && <Lock size={11} />}
              {axis.labels[o.value] ?? o.value}
              {isRec && !locked && <CheckCircle2 size={11} className="text-emerald-500" />}
            </button>
          );
        })}
      </div>

      {/* a locked value's unlock hint (first blocked option with a reason) */}
      {options.some((o) => !o.feasible && o.reason) && (
        <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
          {options.filter((o) => !o.feasible && o.reason).map((o) => `${axis.labels[o.value] ?? o.value}: ${o.reason}`).join("  ·  ")}
        </p>
      )}

      {/* relationship CV evidence (the recommendation's proof) */}
      {axis.factor === "relationship" && cur.evidence && <Evidence evidence={cur.evidence} />}

      <p className="mt-1.5 text-xs leading-snug text-slate-500">{cur.reason}</p>
      <p className="mt-1 text-[11px] text-slate-400">Recommended: <span className="font-medium text-slate-500">{axis.labels[cur.recommended] ?? cur.recommended}</span></p>
    </div>
  );
}

// Compact predictive-ability bars from the relationship decision's CV evidence.
function Evidence({ evidence }: { evidence: Record<string, unknown> }) {
  const rows: { label: string; v: number }[] = [
    { label: "Genomic G", v: Number(evidence.genomic_G ?? NaN) },
    { label: "Pedigree A", v: Number(evidence.pedigree_A ?? NaN) },
    { label: "Identity", v: Number(evidence.identity ?? NaN) },
  ].filter((r) => Number.isFinite(r.v));
  if (rows.length === 0) return null;
  const max = Math.max(0.001, ...rows.map((r) => r.v));
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">CV predictive ability</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[11px] text-slate-500">{r.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-slate-200">
            <div className="h-full rounded bg-emerald-500" style={{ width: `${(Math.max(0, r.v) / max) * 100}%` }} />
          </div>
          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-slate-600">{r.v.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
