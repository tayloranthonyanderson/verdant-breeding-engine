"use client";
// Data Quality + Model QC — the trust station (ADR-0021). Two passes in one place:
//   • pre-fit Data Quality (value-level findings on the data that was fit), and
//   • post-fit Model QC (per-trait residual diagnostics).
// Advisory only: the kernel never removes data. The breeder DISPOSES findings into a `data_overrides`
// exclusion overlay (review / accept-all / auto), capped per trait, then "Exclude & re-run" calls the
// rerunWithDataOverrides Server Action — dropping a site/plot/entry re-plans the model (decision-C).
// Stored data is untouched; the prior run stays for a with/without comparison.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck, AlertOctagon, AlertTriangle, Info, MapPin, Sprout, FlaskConical,
  Play, Loader2, RotateCcw, Check, X, ChevronDown, ChevronRight, Microscope, type LucideIcon,
} from "lucide-react";
import type { ResultBundle, AnalysisRequest } from "@verdant/contracts";
import { rerunWithDataOverrides } from "@/app/actions";
import TraitDiagnosticPlots from "@/components/TraitDiagnosticPlots";
import RawDistributions from "@/components/RawDistributions";
import FieldTrends from "@/components/FieldTrends";

type Finding = NonNullable<NonNullable<ResultBundle["data_quality"]>["findings"]>[number];
type Diagnostics = NonNullable<ResultBundle["traits"][number]["diagnostics"]>;
type Influential = NonNullable<Diagnostics["influential"]>[number];
type Exclusion = NonNullable<NonNullable<AnalysisRequest["data_overrides"]>["exclusions"]>[number];
type Severity = "error" | "warning" | "info";
type Mode = "review" | "batch" | "auto";

// A unified exclusion candidate — from a pre-fit finding or a post-fit influential observation.
interface Candidate {
  key: string;
  kind: "environment" | "observation_unit" | "germplasm";
  id: string;
  variable_id: string | null;
  severity: Severity;
  source: "pre" | "post";
  label: string;
  detail: string;
  score: number; // MAD (pre outlier) or |studentized residual| (post); for ordering + the auto threshold
}

const SEV_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const KIND_ICON: Record<string, LucideIcon> = { environment: MapPin, observation_unit: FlaskConical, germplasm: Sprout, variable: Microscope, dataset: Info };

function candKey(kind: string, id: string, variable_id: string | null | undefined) {
  return `${kind}::${id}::${variable_id ?? "*"}`;
}

export default function DataQuality({
  bundle,
  activeExclusions = [],
  phase = "data",
  reviewOnly = false,
}: {
  bundle: ResultBundle;
  activeExclusions?: Exclusion[];
  // 'data' = pre-fit (raw findings + distributions, before the model); 'fit' = post-fit (residual
  // diagnostics + field triptych, with the model). Split across the journey so the model-dependent
  // checks follow model selection (ADR-0021 trust layer, journey IA).
  phase?: "data" | "fit";
  // reviewOnly hides the exclude-and-re-run action bar (the cut workbench owns the Run, and its
  // rerun action is maize-aware — not the G2F path this component's button calls).
  reviewOnly?: boolean;
}) {
  const isFit = phase === "fit";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const findings = bundle.data_quality?.findings ?? [];
  const summary = bundle.data_quality?.summary;

  // n_obs per trait (drives the per-trait cap) from the Model-QC diagnostics.
  const nObsByTrait = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of bundle.traits) m[t.variable_id] = t.diagnostics?.n_obs ?? 0;
    return m;
  }, [bundle.traits]);

  // Build the exclusion candidates for THIS phase: pre-fit findings (data) vs post-fit influential
  // observations (fit). Each phase curates from its own evidence — that's the point of the split.
  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    if (!isFit) {
      for (const f of findings) {
        if (!f.suggested_exclusion) continue;
        if (f.target.kind !== "environment" && f.target.kind !== "observation_unit" && f.target.kind !== "germplasm") continue;
        if (!f.target.id) continue;
        out.push({
          key: candKey(f.target.kind, f.target.id, f.variable_id),
          kind: f.target.kind, id: f.target.id, variable_id: f.variable_id ?? null,
          severity: f.severity, source: "pre",
          label: shortTarget(f.target.kind, f.target.id), detail: f.detail, score: Number(f.value ?? 0),
        });
      }
    } else {
      for (const t of bundle.traits) {
        for (const inf of t.diagnostics?.influential ?? []) {
          out.push({
            key: candKey("observation_unit", inf.observation_unit_id, t.variable_id),
            kind: "observation_unit", id: inf.observation_unit_id, variable_id: t.variable_id,
            severity: "warning", source: "post",
            label: shortTarget("observation_unit", inf.observation_unit_id),
            detail: `Residual outlier in ${t.variable_id}: ${inf.germplasm_id ?? ""}${inf.environment_id ? ` @ ${inf.environment_id}` : ""} reads ${fmt(inf.value)} (${fmt(inf.studentized_resid)} studentized residuals from the model).`,
            score: Math.abs(Number(inf.studentized_resid ?? 0)),
          });
        }
      }
    }
    const byKey = new Map<string, Candidate>();
    for (const c of out) {
      const prev = byKey.get(c.key);
      if (!prev || SEV_RANK[c.severity] < SEV_RANK[prev.severity]) byKey.set(c.key, c);
    }
    return [...byKey.values()];
  }, [findings, bundle.traits, isFit]);

  // disposition policy
  const [mode, setMode] = useState<Mode>("review");
  const [capPct, setCapPct] = useState(5);
  const [threshold, setThreshold] = useState(3.5);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [capNote, setCapNote] = useState<string | null>(null);

  // Compute the disposition's selection from the policy (mode/cap/threshold) — overwrites manual edits.
  function applyPolicy(m: Mode, cap: number, thr: number) {
    setMode(m);
    if (m === "review") { setSelected(new Set()); setCapNote(null); return; }
    // structural (env/geno) always in; plot candidates filtered (auto: score>thr) then capped per trait.
    const struct = candidates.filter((c) => c.kind !== "observation_unit");
    let plots = candidates.filter((c) => c.kind === "observation_unit");
    if (m === "auto") plots = plots.filter((c) => c.source === "pre" || c.score > thr);
    // cap per trait
    const keep = new Set<string>(struct.map((c) => c.key));
    let dropped = 0;
    const byTrait = new Map<string, Candidate[]>();
    for (const c of plots) {
      const k = c.variable_id ?? "*";
      (byTrait.get(k) ?? byTrait.set(k, []).get(k)!).push(c);
    }
    for (const [trait, list] of byTrait) {
      const capCount = Math.max(1, Math.ceil((cap / 100) * (nObsByTrait[trait] ?? list.length)));
      const sorted = [...list].sort((a, b) => b.score - a.score);
      sorted.slice(0, capCount).forEach((c) => keep.add(c.key));
      dropped += Math.max(0, sorted.length - capCount);
    }
    setSelected(keep);
    setCapNote(dropped > 0 ? `${dropped} flagged plot(s) exceed the ${cap}% per-trait cap and were left for review.` : null);
  }

  function toggle(key: string) {
    setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
    setMode("review");
  }

  const selectedCandidates = candidates.filter((c) => selected.has(c.key));
  const exclusions: Exclusion[] = selectedCandidates.map((c) => ({
    target: { kind: c.kind, id: c.id },
    variable_id: c.variable_id,
    reason: c.detail.slice(0, 140),
    source: mode === "review" ? "manual" : mode === "batch" ? "batch" : "auto_policy",
  }));

  function rerun(ex: Exclusion[]) {
    setError(null);
    start(async () => {
      const r = await rerunWithDataOverrides({ dataOverrides: { exclusions: ex } });
      if (r.status === "error") setError(r.error ?? "re-run failed");
      else router.refresh();
    });
  }

  const counts = summary?.by_severity ?? severityCounts(findings);
  const nFindings = summary?.n_findings ?? findings.length;
  const hasActive = activeExclusions.length > 0;
  const repNobs = Math.max(1, ...Object.values(nObsByTrait)); // representative plots/trait for the cap blurb

  return (
    <div className="space-y-5">
      {/* Header + quiet summary */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm">
            {isFit ? <Microscope size={18} /> : <ShieldCheck size={18} />}
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-slate-800">{isFit ? "Did the model work?" : "Is your data sound?"}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {isFit
                ? "The fit checks for the model above: residual diagnostics, a normal Q-Q, and the field-trend correction. Did the chosen model actually fit? Nothing is removed unless you choose to."
                : "Before any model runs — raw outliers, missingness, layout and naming errors, and the spread of your measurements. Look at the data first. Nothing is removed unless you choose to."}
            </p>
          </div>
          {!isFit && <SeverityChips counts={counts} total={nFindings} />}
        </div>
        {!isFit && nFindings === 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            <Check size={14} /> No data-quality issues found.
          </div>
        )}
      </section>

      {/* with/without comparison banner */}
      {hasActive && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
          <Info size={15} className="shrink-0" />
          <span className="font-medium">This analysis already excludes {activeExclusions.length} item(s).</span>
          <span className="text-sky-600">{summarizeExclusions(activeExclusions)}</span>
          <button onClick={() => rerun([])} disabled={pending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-2.5 py-1.5 font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50">
            <RotateCcw size={13} /> Restore all &amp; re-run
          </button>
        </div>
      )}

      {/* Disposition + action bar (only when there are candidates to act on; hidden in review-only) */}
      {!reviewOnly && candidates.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">How to handle suggestions</div>
              <div className="mt-1.5 inline-flex rounded-lg border border-slate-200 p-0.5">
                {(isFit
                  ? ([["review", "Review each"], ["batch", "Accept all"], ["auto", "Auto · residual"]] as [Mode, string][])
                  : ([["review", "Review each"], ["batch", "Accept all"]] as [Mode, string][])
                ).map(([m, lbl]) => (
                  <button key={m} onClick={() => applyPolicy(m, capPct, threshold)} disabled={pending}
                    className={["rounded-md px-3 py-1.5 text-xs font-medium transition",
                      mode === m ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"].join(" ")}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-4">
              <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400"
                title="At most this share of a trait's plots can be auto-excluded. Removing too many points makes heritability look artificially high, so this is a safety limit.">
                Per-trait safety cap
                <div className="mt-1 flex items-center gap-1.5">
                  <input type="number" min={1} max={100} value={capPct}
                    onChange={(e) => { const v = Math.max(1, Math.min(100, Number(e.target.value) || 1)); setCapPct(v); if (mode !== "review") applyPolicy(mode, v, threshold); }}
                    disabled={pending}
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm tabular-nums text-slate-700" />
                  <span className="text-xs font-normal normal-case text-slate-400">% of plots</span>
                </div>
              </label>
              {mode === "auto" && (
                <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Residual cutoff
                  <div className="mt-1 flex items-center gap-2">
                    <input type="range" min={2.5} max={6} step={0.5} value={threshold}
                      onChange={(e) => { const v = Number(e.target.value); setThreshold(v); applyPolicy("auto", capPct, v); }}
                      disabled={pending} className="w-28 accent-emerald-600" />
                    <span className="w-8 text-sm tabular-nums text-slate-600">{threshold.toFixed(1)}</span>
                  </div>
                </label>
              )}
            </div>
          </div>

          {/* plain-language help — what the active mode does + what the cap means */}
          <p className="mt-3 text-[12px] leading-snug text-slate-500">
            {mode === "review" && <><span className="font-medium text-slate-600">Review each:</span> nothing is pre-selected — tick the plots you want to drop.</>}
            {mode === "batch" && <><span className="font-medium text-slate-600">Accept all:</span> pre-selects everything flagged {isFit ? "— every residual outlier from the fit" : "— the raw data-check findings (outliers, bad sites, etc.)"}.</>}
            {mode === "auto" && <><span className="font-medium text-slate-600">Auto:</span> pre-selects only residual outliers beyond the cutoff (stricter cutoff = fewer plots) — the conservative way to drop just the extreme points.</>}
            {mode !== "review" && (
              <> Limited to {capPct}% of each trait&apos;s plots (≈{Math.round((capPct / 100) * repNobs).toLocaleString()}) so a handful of points can&apos;t gut a trait; anything past the cap is left for you to review.</>
            )}
          </p>

          {capNote && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
              <AlertTriangle size={12} /> {capNote} A cap protects heritability from over-pruning.
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => rerun(exclusions)} disabled={pending || selected.size === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300">
              {pending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {pending ? "Re-fitting on the remaining data…" : `Exclude ${selected.size} & re-run`}
            </button>
            {selected.size > 0 && !pending && (
              <button onClick={() => { setSelected(new Set()); setMode("review"); setCapNote(null); }}
                className="text-xs font-medium text-slate-500 hover:text-slate-700">Clear selection</button>
            )}
            <span className="ml-auto text-[11px] text-slate-400">{selected.size} of {candidates.length} suggestion(s) selected</span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-400">
            Re-running drops the selected plots from <span className="font-medium text-slate-500">this analysis only</span> — your uploaded data is never changed — then re-checks the model and recomputes every BLUP, heritability and ranking (about a minute or two). It&apos;s saved as a <span className="font-medium text-slate-500">new</span> analysis; the current one is kept, so you can compare with and without.
          </p>
          {error && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
        </section>
      )}

      {!isFit && (
        <>
          {/* Pre-fit findings */}
          <FindingsTable findings={findings} candidates={candidates} selected={selected} onToggle={toggle} disabled={pending} />
          {/* Raw measurement distributions (pre-fit, data sanity) */}
          <RawDistributions bundle={bundle} />
        </>
      )}

      {isFit && (
        <>
          {/* Post-fit Model QC: residual diagnostics + Q-Q */}
          <ModelQc bundle={bundle} selected={selected} onToggle={toggle} disabled={pending} />
          {/* Field trends — raw → fitted trend → residual triptych (the spatial correction) */}
          <FieldTrends bundle={bundle} />
        </>
      )}
    </div>
  );
}

// ---------- pieces ----------

function SeverityChips({ counts, total }: { counts: { error?: number | null; warning?: number | null; info?: number | null }; total: number }) {
  const items: [Severity, number, LucideIcon, string][] = [
    ["error", counts.error ?? 0, AlertOctagon, "text-rose-600 bg-rose-50 ring-rose-200"],
    ["warning", counts.warning ?? 0, AlertTriangle, "text-amber-600 bg-amber-50 ring-amber-200"],
    ["info", counts.info ?? 0, Info, "text-slate-500 bg-slate-50 ring-slate-200"],
  ];
  return (
    <div className="flex shrink-0 items-center gap-1.5" title={`${total} finding(s)`}>
      {items.map(([s, n, Icon, cls]) => (
        <span key={s} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums ring-1 ${cls}`}>
          <Icon size={11} /> {n}
        </span>
      ))}
    </div>
  );
}

function FindingsTable({
  findings, candidates, selected, onToggle, disabled,
}: {
  findings: Finding[]; candidates: Candidate[]; selected: Set<string>; onToggle: (k: string) => void; disabled: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  if (findings.length === 0) return null;
  const excludableKey = new Set(candidates.map((c) => c.key));
  const sorted = [...findings].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const shown = showAll ? sorted : sorted.slice(0, 12);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-5 py-3.5 text-left">
        {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
        <h3 className="text-sm font-semibold text-slate-800">Before the model — data checks</h3>
        <span className="text-[11px] text-slate-400">{findings.length} finding(s)</span>
      </button>
      {open && (
        <div className="border-t border-slate-100">
          <ul className="divide-y divide-slate-50">
            {shown.map((f, i) => {
              const key = f.target.id ? candKey(f.target.kind, f.target.id, f.variable_id) : null;
              const excludable = key != null && excludableKey.has(key);
              const isSel = key != null && selected.has(key);
              const Icon = KIND_ICON[f.target.kind] ?? Info;
              return (
                <li key={i} className="flex items-start gap-3 px-5 py-3">
                  <SeverityDot s={f.severity} />
                  <div className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-100"><Icon size={12} className="text-slate-500" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-700">{checkLabel(f.check)}</span>
                      {f.variable_id && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{f.variable_id}</span>}
                      {f.target.id && <span className="text-[11px] text-slate-400">{shortTarget(f.target.kind, f.target.id)}</span>}
                    </div>
                    <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{f.detail}</p>
                  </div>
                  {excludable && key && (
                    <ToggleExclude isSel={isSel} onClick={() => onToggle(key)} disabled={disabled} />
                  )}
                </li>
              );
            })}
          </ul>
          {sorted.length > 12 && (
            <button onClick={() => setShowAll((s) => !s)} className="w-full border-t border-slate-100 py-2.5 text-xs font-medium text-emerald-700 hover:bg-slate-50">
              {showAll ? "Show fewer" : `Show all ${sorted.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ModelQc({
  bundle, selected, onToggle, disabled,
}: {
  bundle: ResultBundle; selected: Set<string>; onToggle: (k: string) => void; disabled: boolean;
}) {
  const traits = bundle.traits.filter((t) => t.diagnostics);
  const [openPlots, setOpenPlots] = useState<Set<string>>(new Set());
  if (traits.length === 0) return null;
  // Did the fitted model actually de-trend the field? (Two-stage SpATS removes within-field trend in
  // Stage 1.) If so, residual spatial structure is what SpATS CORRECTED — not a warning. If no spatial
  // model was used, the same structure genuinely biases the BLUPs.
  const sm = bundle.chosen_model?.spatial_method;
  const spatialCorrected = !!sm && sm !== "none";
  const togglePlots = (id: string) => setOpenPlots((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100"><Microscope size={14} className="text-slate-500" /></div>
        <h3 className="text-sm font-semibold text-slate-800">After the model — fit checks</h3>
        <span className="text-[11px] text-slate-400">did the chosen model actually work?</span>
      </div>
      <div className="mt-3 space-y-3">
        {traits.map((t) => {
          const d = t.diagnostics!;
          const infl = d.influential ?? [];
          return (
            <div key={t.variable_id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">{t.variable_id}</span>
                <Chip ok={d.converged !== false} okLabel="Converged" warnLabel="Did not converge" />
                <NormalityChip skew={d.residual_skew} kurtosis={d.residual_kurtosis} />
                <VarianceChip rho={d.heteroscedasticity_rho} />
                <SpatialChip moran={d.spatial_residual_autocorr} corrected={spatialCorrected} />
                {d.h2_boundary && <Chip ok={false} okLabel="" warnLabel="h² at boundary" />}
                {d.viz && (
                  <button onClick={() => togglePlots(t.variable_id)}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50">
                    {openPlots.has(t.variable_id) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    {openPlots.has(t.variable_id) ? "Hide plots" : "Show plots"}
                  </button>
                )}
              </div>
              {openPlots.has(t.variable_id) && <TraitDiagnosticPlots diagnostics={d} />}
              {infl.length > 0 && (
                <div className="mt-2.5">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    {infl.length} influential observation{infl.length > 1 ? "s" : ""} (large residuals)
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {infl.slice(0, 6).map((inf) => {
                      const key = candKey("observation_unit", inf.observation_unit_id, t.variable_id);
                      return (
                        <li key={inf.observation_unit_id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                          <span className="font-mono text-[10px] text-slate-400">{shortTarget("observation_unit", inf.observation_unit_id)}</span>
                          <span className="text-[11px] text-slate-600">{inf.germplasm_id}{inf.environment_id ? ` @ ${inf.environment_id}` : ""}</span>
                          <span className="text-[11px] tabular-nums text-slate-500">= {fmt(inf.value)}</span>
                          <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">{fmt(inf.studentized_resid)}σ</span>
                          <div className="ml-auto"><ToggleExclude isSel={selected.has(key)} onClick={() => onToggle(key)} disabled={disabled} /></div>
                        </li>
                      );
                    })}
                  </ul>
                  {infl.length > 6 && <div className="mt-1 text-[10px] text-slate-400">+{infl.length - 6} more (use Accept-all or Auto above to select them).</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ToggleExclude({ isSel, onClick, disabled }: { isSel: boolean; onClick: () => void; disabled: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={["inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition",
        isSel ? "border-rose-300 bg-rose-50 text-rose-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"].join(" ")}>
      {isSel ? <><X size={11} /> Excluded</> : <>Exclude</>}
    </button>
  );
}

function Chip({ label, p, warnIf, tip, ok, okLabel, warnLabel }: {
  label?: string; p?: number | null; warnIf?: (p: number | null | undefined) => boolean; tip?: string;
  ok?: boolean; okLabel?: string; warnLabel?: string;
}) {
  const isWarn = ok !== undefined ? !ok : warnIf ? warnIf(p) : false;
  const text = ok !== undefined ? (ok ? okLabel : warnLabel) : `${label}${p != null ? ` ${p < 0.001 ? "p<0.001" : `p=${p.toFixed(3)}`}` : ""}`;
  if (ok !== undefined && ok && !okLabel) return null;
  return (
    <span title={tip}
      className={["inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
        isWarn ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"].join(" ")}>
      {isWarn ? <AlertTriangle size={9} /> : <Check size={9} />} {text}
    </span>
  );
}

// Normality by EFFECT SIZE, not a p-value (which rejects on any real-size trait). Material if the
// residuals are clearly skewed (|skew| ≳ 1) or heavy-tailed (excess kurtosis ≳ 2).
function NormalityChip({ skew, kurtosis }: { skew?: number | null; kurtosis?: number | null }) {
  if (skew == null && kurtosis == null) return null;
  const s = skew ?? 0, k = kurtosis ?? 0;
  const skewBad = Math.abs(s) > 1, kurtBad = Math.abs(k) > 2;
  const warn = skewBad || kurtBad;
  const cls = warn ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  const tip = `Residual skew ${s.toFixed(2)} (0 = symmetric), excess kurtosis ${k.toFixed(2)} (0 = normal tails; large = heavy tails / outliers). Judged by size, not a p-value — a significance test rejects on almost any large trial, so it isn't useful here.`;
  // label the metric that actually tripped it (heavy tails are usually kurtosis, not skew)
  const label = !warn ? "Normality ok"
    : skewBad && (!kurtBad || Math.abs(s) >= Math.abs(k) / 2) ? `Normality · skew ${s.toFixed(1)}`
      : `Normality · heavy tails (kurt ${k.toFixed(1)})`;
  return (
    <span title={tip} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${cls}`}>
      {warn ? <AlertTriangle size={9} /> : <Check size={9} />} {label}
    </span>
  );
}

// Equal variance by effect size: |Spearman ρ(|resid|, fitted)| — near 0 = constant variance.
function VarianceChip({ rho }: { rho?: number | null }) {
  if (rho == null) return null;
  const warn = Math.abs(rho) > 0.2;
  const cls = warn ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return (
    <span title={`Spearman correlation of |residual| with fitted value = ${rho.toFixed(2)}. Near 0 = spread is constant (good); large = a funnel (variance grows with the value).`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${cls}`}>
      {warn ? <AlertTriangle size={9} /> : <Check size={9} />} {warn ? `Equal variance · ρ ${rho.toFixed(2)}` : "Equal variance ok"}
    </span>
  );
}

function SpatialChip({ moran, corrected }: { moran?: number | null; corrected?: boolean }) {
  if (moran == null) return null;
  const structured = Math.abs(moran) > 0.2;
  // Structure + a spatial model = SpATS corrected it (informational, not a warning). Structure + NO
  // spatial model = a real warning (trend left in the BLUPs). No structure = clean.
  const warn = structured && !corrected;
  const cls = warn ? "bg-amber-50 text-amber-700 ring-amber-200"
    : structured ? "bg-sky-50 text-sky-700 ring-sky-200"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  const tip = warn
    ? "Moran's I on residuals over the field layout. No spatial model was used, so this trend is left in the BLUPs — consider spatial de-trending."
    : structured ? "Field structure was present and the spatial model (SpATS) corrected it for the genotype estimates."
      : "Moran's I ≈ 0: little spatial structure in the residuals.";
  const label = structured && corrected ? `Field structure · SpATS-corrected` : `Spatial I=${moran.toFixed(2)}`;
  return (
    <span title={tip} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${cls}`}>
      {warn ? <AlertTriangle size={9} /> : <Check size={9} />} {label}
    </span>
  );
}

function SeverityDot({ s }: { s: Severity }) {
  const c = s === "error" ? "bg-rose-500" : s === "warning" ? "bg-amber-500" : "bg-slate-300";
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

// ---------- helpers ----------
function fmt(v: number | null | undefined) { return v == null ? "—" : Math.abs(v) >= 1000 ? v.toExponential(2) : Number(v).toFixed(2); }
function checkLabel(c: string) {
  return ({ missingness: "Missingness", outlier: "Outlier", duplicate_coords: "Duplicate plot", duplicate_name: "Similar names", distribution: "Distribution", factor_sanity: "Design issue" } as Record<string, string>)[c] ?? c;
}
function shortTarget(kind: string, id: string) {
  if (kind === "observation_unit") { const m = id.match(/#(\d+)$/); return `plot ${m ? m[1] : id.slice(0, 10)}`; }
  return id;
}
function severityCounts(findings: Finding[]) {
  const c = { error: 0, warning: 0, info: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}
function summarizeExclusions(ex: Exclusion[]) {
  const by: Record<string, number> = {};
  for (const e of ex) by[e.target.kind] = (by[e.target.kind] ?? 0) + 1;
  return Object.entries(by).map(([k, n]) => `${n} ${k.replace("observation_unit", "plot").replace("_", " ")}${n > 1 ? "s" : ""}`).join(", ");
}
