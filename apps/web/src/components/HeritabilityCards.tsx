// One card per trait: the heritability with a bar, plus the genotype count. Heritability is the
// "can I trust this ranking?" number — high = reliable, low = noisy (PRD: teach as it works).
import type { ResultBundle } from "@verdant/contracts";

export default function HeritabilityCards({ bundle }: { bundle: ResultBundle }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {bundle.traits.map((t) => {
        const h2 = t.heritability?.value ?? null;
        const pct = h2 != null ? Math.round(h2 * 100) : null;
        // full class strings (Tailwind scans source literally — no dynamic class names)
        const barClass =
          h2 == null
            ? "bg-slate-400"
            : h2 >= 0.5
              ? "bg-emerald-500"
              : h2 >= 0.2
                ? "bg-amber-500"
                : "bg-rose-500";
        return (
          <div key={t.variable_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="truncate text-xs font-medium text-slate-500">{t.variable_id}</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="tnum text-2xl font-semibold text-slate-900">
                {h2 != null ? h2.toFixed(2) : "—"}
              </span>
              <span className="text-[11px] text-slate-400">
                h² {t.heritability ? `(${t.heritability.method})` : ""}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${barClass}`}
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              {t.diagnostics?.n_genotypes ?? t.effects.length} genotypes
            </div>
          </div>
        );
      })}
    </div>
  );
}
