"use client";

// How combining ability was modeled — the deterministic decisions (genotype structure, topology, tester
// fixed/random, SCA) each with reason + the diagnostic that triggered it (ADR-0019), plus variance
// components, Baker's ratio, and the cross-graph readiness that gates it all. The trust/teaching surface.
import { fmt, type CombiningAbility } from "@/lib/ca";

export default function CaModelCard({ ca }: { ca: CombiningAbility }) {
  const d = ca.diagnostics;
  const maxDeg = Math.max(...Object.entries(d.degree.distribution).map(([, n]) => n));

  return (
    <div className="space-y-4">
      {/* decisions */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700">How combining ability was modeled</h3>
        <p className="mt-0.5 text-[11px] text-slate-400">Each choice is the planner&rsquo;s, with the diagnostic that drove it. Deterministic science; the AI explains, never decides (ADR-0019).</p>
        <ul className="mt-3 space-y-2.5">
          {ca.topology.decisions.map((dec) => (
            <li key={dec.factor} className="flex gap-3">
              <span className="mt-0.5 inline-flex h-fit shrink-0 items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {dec.factor.replace(/_/g, " ")}
              </span>
              <div>
                <div className="text-[13px] font-medium text-slate-800">{dec.choice.replace(/_/g, " ")}</div>
                <div className="text-[12px] leading-snug text-slate-500">{dec.reason}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* variance components + Baker's ratio */}
      <div className="grid gap-3 sm:grid-cols-2">
        {ca.traits.map((t) => {
          const total = t.varcomp.reduce((s, v) => s + Math.max(0, v.variance), 0) || 1;
          return (
            <div key={t.variable_id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-700">{shortTrait(t.variable_id)}</div>
                {t.baker_ratio != null && (
                  <div className="text-[11px] text-slate-500">Baker&rsquo;s ratio <b className="text-slate-700">{t.baker_ratio.toFixed(2)}</b></div>
                )}
              </div>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                {t.varcomp.map((v) => (
                  <div key={v.component} title={`${v.component}: ${fmt(v.variance, 3)}`} style={{ width: `${(Math.max(0, v.variance) / total) * 100}%`, background: vcColor(v.component) }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {t.varcomp.map((v) => (
                  <span key={v.component} className="inline-flex items-center gap-1 text-slate-500">
                    <span className="h-2 w-2 rounded-sm" style={{ background: vcColor(v.component) }} />
                    {vcLabel(v.component)} <span className="tabular-nums text-slate-400">{fmt(v.variance, 3)}</span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-slate-400">
                {t.baker_ratio === 1
                  ? "Purely additive — no detectable specific-cross effect; mid-parent GCA fully predicts the cross."
                  : t.baker_ratio != null
                    ? `${(t.baker_ratio * 100).toFixed(0)}% of combining ability is additive (GCA); the rest is specific-cross (SCA).`
                    : ""}
              </p>
            </div>
          );
        })}
      </div>

      {/* cross-graph readiness */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700">Cross-graph readiness</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Crosses per line</div>
            <div className="mt-1 text-[13px] text-slate-600">median <b>{d.degree.median}</b> · range {d.degree.min}–{d.degree.max}</div>
            <div className="mt-2 space-y-1">
              {Object.entries(d.degree.distribution).map(([deg, n]) => (
                <div key={deg} className="flex items-center gap-2">
                  <span className="w-3 text-[10px] text-slate-400">{deg}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(n / maxDeg) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right text-[10px] tabular-nums text-slate-400">{n}</span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">Degree sets GCA precision; thinly-crossed lines shrink toward the mean.</p>
          </div>
          <Stat label="Connectivity" value={d.connectivity.connected ? "single graph" : `${d.connectivity.components} components`}
            note={d.connectivity.connected ? "all GCAs on one common scale" : "small islands estimated against their own component"}
            tone={d.connectivity.connected ? "emerald" : "amber"} />
          <Stat label="Cross-replication" value={`${d.replication.replicated_crosses}/${d.replication.total_crosses}`}
            note="replicated crosses — what makes SCA separable from plot error" tone="slate" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone: "emerald" | "amber" | "slate" }) {
  const c = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-slate-700";
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-[15px] font-semibold ${c}`}>{value}</div>
      <p className="mt-1 text-[10px] text-slate-400">{note}</p>
    </div>
  );
}

const vcColor = (c: string) => ({ gca: "#10b981", sca: "#f59e0b", gca_env: "#0ea5e9", residual: "#e2e8f0" } as Record<string, string>)[c] ?? "#cbd5e1";
const vcLabel = (c: string) => ({ gca: "GCA", sca: "SCA", gca_env: "GCA×env", residual: "residual" } as Record<string, string>)[c] ?? c;
function shortTrait(t: string) { return t.replace("_Mg_ha", " (Mg/ha)").replace("Grain_", "Grain ").replace(/_/g, " "); }
