// The Advance step ledger — advancement decisions recorded for this analysis (closes analysis→select→
// advance). Inbred lines and hybrids both land here.
import { ClipboardCheck } from "lucide-react";

export type AdvanceRow = { candidate: string; unit: string; pool: string | null; disposition: string };

export default function AdvanceStep({ advancements }: { advancements: AdvanceRow[] }) {
  if (advancements.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><ClipboardCheck size={20} /></div>
        <p className="mt-3 text-sm font-medium text-slate-700">No advancement decisions yet</p>
        <p className="mt-1 text-xs text-slate-500">Go to <b>Select</b> and advance the lines you want to recycle — they&rsquo;ll be recorded here.</p>
      </div>
    );
  }
  const inbreds = advancements.filter((a) => a.unit === "inbred");
  const hybrids = advancements.filter((a) => a.unit === "hybrid");
  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-600 text-white"><ClipboardCheck size={15} /></div>
        <h3 className="text-sm font-semibold text-slate-800">Advancement decisions</h3>
        <span className="text-[11px] text-slate-400">recorded for this analysis</span>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <LedgerCol title={`Lines · ${inbreds.length}`} rows={inbreds} />
        <LedgerCol title={`Hybrids · ${hybrids.length}`} rows={hybrids} />
      </div>
    </section>
  );
}

function LedgerCol({ title, rows }: { title: string; rows: AdvanceRow[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-slate-400">none yet</div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <li key={r.candidate} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
              {r.pool && <span className={`h-1.5 w-1.5 rounded-full ${/(^|\s)A$/.test(r.pool) || r.pool === "A" ? "bg-sky-500" : "bg-violet-500"}`} />}
              {r.candidate}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
