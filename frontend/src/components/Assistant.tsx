"use client";

import { useRef, useState, useEffect } from "react";
import { Sparkles, Send, ShieldCheck } from "lucide-react";
import { askAssistant } from "@/lib/api";
import type { Bundle } from "@/lib/types";

type Msg = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "Which 5 lines are the best overall?",
  "Top 5 by yield",
  "How was the selection index computed?",
];

export default function Assistant({ bundle }: { bundle: Bundle | null }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [unconfigured, setUnconfigured] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, busy]);

  async function send(text: string) {
    if (!bundle || !text.trim() || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const res = await askAssistant(bundle, text);
      setUnconfigured(!res.configured);
      setMsgs((m) => [...m, { role: "assistant", text: res.reply }]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: "assistant", text: `Sorry — ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-600 text-white">
          <Sparkles size={15} />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-800">Assistant</div>
          <div className="flex items-center gap-1 text-[11px] text-slate-400">
            <ShieldCheck size={11} /> answers only from your computed results
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto scroll-thin px-4 py-3">
        {msgs.length === 0 && (
          <div className="text-sm text-slate-500">
            <p className="mb-3">
              Ask about your trial. I can only read the analysis that was already
              computed — so the numbers I give are grounded, never made up.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={!bundle}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div
            key={i}
            className={`animate-rise flex ${
              m.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-400">
              thinking…
            </div>
          </div>
        )}
      </div>

      {unconfigured && (
        <div className="mx-4 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          Set <code className="font-mono">ANTHROPIC_API_KEY</code> on the API to
          enable live chat. The analysis itself is fully available.
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-slate-100 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={bundle ? "Ask about your results…" : "Load a trial first"}
          disabled={!bundle || busy}
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:bg-white disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!bundle || busy || !input.trim()}
          className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
