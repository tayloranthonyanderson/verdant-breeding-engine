"use client";

function prettyTrait(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TraitControls({
  traits,
  weights,
  directions,
  onWeight,
  onDirection,
}: {
  traits: string[];
  weights: Record<string, number>;
  directions: Record<string, number>;
  onWeight: (trait: string, value: number) => void;
  onDirection: (trait: string, value: number) => void;
}) {
  return (
    <div className="space-y-3">
      {traits.map((t) => (
        <div key={t} className="flex items-center gap-3">
          <div className="w-24 shrink-0 text-sm font-medium text-slate-700">
            {prettyTrait(t)}
          </div>
          <input
            type="range"
            min={0}
            max={3}
            step={0.25}
            value={weights[t] ?? 1}
            onChange={(e) => onWeight(t, parseFloat(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-emerald-600"
          />
          <span className="tnum w-8 text-right text-xs text-slate-500">
            {(weights[t] ?? 1).toFixed(2)}
          </span>
          <button
            onClick={() => onDirection(t, (directions[t] ?? 1) * -1)}
            className={`w-16 rounded-lg border px-2 py-1 text-xs font-medium transition ${
              (directions[t] ?? 1) > 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-sky-200 bg-sky-50 text-sky-700"
            }`}
            title="Toggle whether higher or lower values are better"
          >
            {(directions[t] ?? 1) > 0 ? "↑ higher" : "↓ lower"}
          </button>
        </div>
      ))}
    </div>
  );
}
