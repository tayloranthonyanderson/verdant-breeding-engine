"use client";

// The analysis as a WORKFLOW, not an endless scroll. The breeder's journey is a sequence of focused
// steps (Overview → Model → Understand → Select → Advance → Genomics); this shell shows ONE at a time
// with a clickable step rail + Prev/Next. All steps stay mounted (hidden, not unmounted) so client
// state — selection lenses, weight sliders, Model Studio edits — survives moving between steps.
import { Fragment, useState } from "react";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";

export interface Step { id: string; label: string; sublabel?: string; icon?: React.ReactNode; content: React.ReactNode }

export default function StepShell({ steps, active: activeProp, onActiveChange }: { steps: Step[]; active?: number; onActiveChange?: (i: number) => void }) {
  const [internal, setInternal] = useState(0);
  const active = activeProp ?? internal;
  const setActive = (i: number) => { const c = Math.min(Math.max(0, i), steps.length - 1); if (onActiveChange) onActiveChange(c); else setInternal(c); };
  const cur = Math.min(Math.max(0, active), steps.length - 1);

  return (
    <div>
      {/* step rail */}
      <nav className="sticky top-0 z-30 -mx-6 mb-6 border-b border-slate-200 bg-white/90 px-6 py-2.5 backdrop-blur">
        <ol className="flex items-center gap-1 overflow-x-auto">
          {steps.map((s, i) => {
            const isActive = i === cur;
            const done = i < cur;
            return (
              <li key={s.id} className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  className={`group inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                    isActive ? "bg-emerald-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                    isActive ? "bg-emerald-600 text-white" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                  }`}>
                    {done ? <Check size={12} /> : i + 1}
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className={`text-xs font-semibold ${isActive ? "text-emerald-800" : "text-slate-600"}`}>{s.label}</span>
                    {s.sublabel && <span className="hidden text-[10px] text-slate-400 sm:block">{s.sublabel}</span>}
                  </span>
                </button>
                {i < steps.length - 1 && <ChevronRight size={14} className="mx-0.5 shrink-0 text-slate-300" />}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* one step visible; the rest stay mounted (state preserved). The header + the (cross-owner)
          content node are wrapped in keyed Fragments so this runtime's key validator stays quiet. */}
      {steps.map((s, i) => (
        <div key={s.id} className={i === cur ? "" : "hidden"}>
          <Fragment key="head">
            <div className="mb-4 flex items-baseline gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">{s.label}</h2>
              {s.sublabel && <span className="text-xs text-slate-400">{s.sublabel}</span>}
            </div>
          </Fragment>
          <Fragment key="body">{s.content}</Fragment>
        </div>
      ))}

      {/* prev / next */}
      <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => setActive(cur - 1)}
          disabled={cur === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={15} /> {cur > 0 ? steps[cur - 1].label : "Back"}
        </button>
        <span className="text-xs text-slate-400">Step {cur + 1} of {steps.length}</span>
        <button
          type="button"
          onClick={() => setActive(cur + 1)}
          disabled={cur === steps.length - 1}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {cur < steps.length - 1 ? steps[cur + 1].label : "Done"} <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
