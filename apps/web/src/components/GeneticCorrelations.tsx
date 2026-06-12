// Genetic correlation matrix (heatmap) — the headline output of the multi-trait model (BLUPF90).
// Genetic correlations are what the transparent index can't see and what the Smith–Hazel index will
// use: how traits co-inherit. Rendered as a diverging heatmap with the values on the cells.
import type { ResultBundle } from "@verdant/contracts";

function label(id: string) {
  return id.replace(/_Mg_ha$/i, "").replace(/_cm$/i, "").replace(/_/g, " ");
}

// Diverging scale: emerald for positive, rose for negative, intensity = |r|.
function cellStyle(r: number): React.CSSProperties {
  const a = Math.min(1, Math.abs(r));
  const alpha = (0.1 + 0.82 * a).toFixed(3);
  const bg = r >= 0 ? `rgba(5,150,105,${alpha})` : `rgba(225,29,72,${alpha})`;
  return { background: bg, color: a > 0.55 ? "#ffffff" : "#0f172a" };
}

export default function GeneticCorrelations({ bundle }: { bundle: ResultBundle }) {
  const gc = bundle.genetic_correlations;
  if (!gc?.variable_ids?.length || !gc.matrix?.length) return null;
  const ids = gc.variable_ids;
  const M = gc.matrix;
  const n = ids.length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">Genetic correlations</h3>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
        How the traits co-inherit, from the multi-trait model — the structure the transparent index
        is blind to and the Smith–Hazel index uses. Positive = selecting one trait tends to drag the
        other up; negative = they trade off.
      </p>

      <div className="mt-4 overflow-x-auto">
        <div
          className="inline-grid gap-1 text-xs"
          style={{ gridTemplateColumns: `minmax(96px,auto) repeat(${n}, minmax(64px,1fr))` }}
        >
          {/* header row */}
          <div />
          {ids.map((id) => (
            <div key={`h-${id}`} className="px-1 pb-1 text-center font-medium text-slate-500">
              {label(id)}
            </div>
          ))}
          {/* body */}
          {ids.map((rid, i) => (
            <Row key={rid}>
              <div className="flex items-center pr-2 text-right font-medium text-slate-600">
                {label(rid)}
              </div>
              {ids.map((cid, j) => {
                const r = M[i]?.[j] ?? 0;
                return (
                  <div
                    key={`${rid}-${cid}`}
                    className="grid h-12 place-items-center rounded-md tnum font-semibold"
                    style={cellStyle(r)}
                    title={`${label(rid)} × ${label(cid)}: ${r.toFixed(3)}`}
                  >
                    {i === j ? "1.00" : r.toFixed(2)}
                  </div>
                );
              })}
            </Row>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-400">
        <Legend color="rgba(225,29,72,0.85)" text="−1 trade-off" />
        <Legend color="rgba(148,163,184,0.25)" text="0 independent" />
        <Legend color="rgba(5,150,105,0.85)" text="+1 move together" />
      </div>
    </section>
  );
}

// Grid is flat (display:contents) so each row's cells participate in the parent grid.
function Row({ children }: { children: React.ReactNode }) {
  return <div className="contents">{children}</div>;
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
      {text}
    </span>
  );
}
