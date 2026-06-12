// Insight-first (PRD §6): lead with what the trial *means* — the model the engine chose and why,
// and the plain-language notes — before any table.
import { Sparkles, Info } from "lucide-react";
import type { ResultBundle } from "@verdant/contracts";

export default function InsightBanner({ bundle }: { bundle: ResultBundle }) {
  const cm = bundle.chosen_model;
  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
          <Sparkles size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800">
            {cm.description ?? "Analysis complete"}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{cm.rationale}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <Tag label={`spatial: ${cm.spatial_method ?? "none"}`} />
            <Tag label={`genotype: ${cm.genotype_effect}`} />
            <Tag label={`relationship: ${cm.relationship}`} />
            {cm.engine && <Tag label={cm.engine} />}
          </div>
          {(cm.formula || cm.engine) && (
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-600">
              {cm.formula && (
                <div>
                  <span className="text-slate-400">model&nbsp;&nbsp;</span>
                  {cm.formula}
                </div>
              )}
              {cm.engine && (
                <div>
                  <span className="text-slate-400">engine&nbsp;</span>
                  {engineFn(cm.engine)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {bundle.warnings.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
          {bundle.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-500">
              <Info size={13} className="mt-0.5 shrink-0 text-slate-400" />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Map the engine to the actual R package + function call, so "what's running" is never a mystery.
function engineFn(engine: string): string {
  if (engine === "SpATS") return "SpATS::SpATS()  —  2D P-spline spatial mixed model";
  if (engine === "lme4") return "lme4::lmer()  —  REML mixed model";
  if (engine === "blupf90+") return "blupf90+ (AIREMLF90)  —  multi-trait AI-REML variance components";
  return engine;
}

function Tag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
      {label}
    </span>
  );
}
