"use client";

import { useRef } from "react";
import Papa from "papaparse";
import { Sprout, Upload, Loader2 } from "lucide-react";
import type { TrialRow } from "@/lib/types";

export type Cols = { genotype: string; env: string; block: string };

function pick(cols: string[], opts: string[], fallback: string) {
  const hit = cols.find((c) => opts.includes(c.toLowerCase()));
  return hit ?? fallback;
}

export default function DataBar({
  onLoadDemo,
  onUpload,
  engine,
  effect,
  onEngine,
  onEffect,
  loading,
  source,
}: {
  onLoadDemo: () => void;
  onUpload: (rows: TrialRow[], traits: string[], cols: Cols) => void;
  engine: string;
  effect: string;
  onEngine: (v: string) => void;
  onEffect: (v: string) => void;
  loading: boolean;
  source: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data as TrialRow[];
        const cols = res.meta.fields ?? [];
        const genotype = pick(cols, ["genotype", "geno", "entry", "line"], cols[0] ?? "genotype");
        const env = pick(cols, ["env", "environment", "site", "location"], "env");
        const block = pick(cols, ["block", "rep", "replicate"], "block");
        const reserved = new Set([genotype, env, block, "rep", "row", "col"].map((c) => c.toLowerCase()));
        const traits = cols.filter(
          (c) => !reserved.has(c.toLowerCase()) && typeof rows[0]?.[c] === "number"
        );
        onUpload(rows, traits, { genotype, env, block });
      },
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <button
        onClick={onLoadDemo}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Sprout size={16} />}
        Load demo trial
      </button>

      <button
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-60"
      >
        <Upload size={16} /> Upload CSV
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />

      <div className="mx-1 h-6 w-px bg-slate-200" />

      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Engine
        <select
          value={engine}
          onChange={(e) => onEngine(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
        >
          <option value="lme4">lme4</option>
          <option value="rrblup">rrBLUP (2-step)</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Effect
        <select
          value={effect}
          onChange={(e) => onEffect(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
        >
          <option value="random">Random (BLUP)</option>
          <option value="fixed">Fixed (BLUE)</option>
        </select>
      </label>

      {source && (
        <span className="ml-auto text-xs text-slate-400">{source}</span>
      )}
    </div>
  );
}
