"use client";

// "Ask your results" — grounded natural-language Q&A over the result bundle (ADR-0002/0004). The
// answer is generated server-side; every number it states comes from the bundle (the AI explains,
// never computes). Shows whether the answer came from the live model or the offline fallback.
import { useState, useTransition } from "react";
import { Sparkles, CornerDownLeft, AlertCircle } from "lucide-react";
import { askResults, type AskResult } from "@/app/actions";

const SUGGESTIONS = [
  "Which lines top the Yield-first market, and why?",
  "What's the heritability of each trait?",
  "Where do the transparent and genetically-aware indices disagree?",
];

export default function AskPanel() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<AskResult | null>(null);
  const [pending, start] = useTransition();

  function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    setQ(text);
    start(async () => setRes(await askResults(text)));
  }

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
          <Sparkles size={15} />
        </span>
        <h3 className="text-sm font-semibold text-slate-800">Ask your results</h3>
        <span className="text-[11px] text-slate-400">Plain-language answers, grounded in this analysis — never fabricated.</span>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(q); }}
          rows={2}
          placeholder="e.g. Why does the genetically-aware index rank a different line first?"
          className="min-h-[44px] flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400"
        />
        <button
          type="button"
          onClick={() => ask(q)}
          disabled={pending || !q.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40"
        >
          {pending ? "Asking…" : (<>Ask <CornerDownLeft size={14} /></>)}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            disabled={pending}
            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      {res?.status === "error" && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle size={15} /> {res.error}
        </div>
      )}
      {res?.status === "ok" && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{res.answer.text}</p>
          <div className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-400">
            {res.answer.mode === "live"
              ? `answered by ${res.answer.model} · grounded in the result bundle`
              : "offline answer · grounded in the result bundle · add an Anthropic API key for full natural-language answers"}
          </div>
        </div>
      )}
    </section>
  );
}
