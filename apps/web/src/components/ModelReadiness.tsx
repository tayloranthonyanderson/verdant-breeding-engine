// Model & data readiness (ADR-0016): show the deterministic Model Planner's decision log —
// every scientific choice + why — and, as a teaching surface, what more data would unlock.
// The AI narrates these; the planner makes them. This panel never re-derives anything.
import {
  Grid3x3,
  Layers,
  Network,
  Dna,
  Cpu,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";
import type { ResultBundle } from "@verdant/contracts";

// The contracts package re-exports only ResultBundle, so derive the row types from it
// (NonNullable peels the optional/null) rather than touching the contract package.
type ModelDecision = NonNullable<NonNullable<ResultBundle["chosen_model"]["decisions"]>[number]>;
type ReadinessUnlock = NonNullable<
  NonNullable<NonNullable<ResultBundle["data_readiness"]>["unlocks"]>[number]
>;

export default function ModelReadiness({ bundle }: { bundle: ResultBundle }) {
  const decisions = bundle.chosen_model?.decisions ?? [];
  const unlocks = bundle.data_readiness?.unlocks ?? [];

  // Nothing to teach -> render nothing (the InsightBanner already carries the headline).
  if (decisions.length === 0 && unlocks.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {decisions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-800">How the model was chosen</h3>
          <ul className="mt-3 space-y-3">
            {decisions.map((d, i) => (
              <DecisionRow key={i} decision={d} />
            ))}
          </ul>
        </div>
      )}

      {unlocks.length > 0 && (
        <div
          className={
            decisions.length > 0
              ? "mt-5 rounded-xl border border-amber-100 bg-amber-50/50 p-4"
              : "rounded-xl border border-amber-100 bg-amber-50/50 p-4"
          }
        >
          <div className="flex items-center gap-2">
            <Lightbulb size={15} className="shrink-0 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-800">What more data would unlock</h3>
          </div>
          <ul className="mt-3 space-y-3">
            {unlocks.map((u, i) => (
              <UnlockRow key={i} unlock={u} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DecisionRow({ decision }: { decision: ModelDecision }) {
  const { icon: Icon, label } = factorMeta(decision.factor);
  const tone = decisionTone(decision);
  return (
    <li className="flex items-start gap-3">
      <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tone.iconBg}`}>
        <Icon size={14} className={tone.iconText} />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {label}
          </span>
          <span className={`text-sm font-semibold ${tone.choiceText}`}>{decision.choice}</span>
        </div>
        {decision.reason && (
          <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{decision.reason}</p>
        )}
      </div>
    </li>
  );
}

function UnlockRow({ unlock }: { unlock: ReadinessUnlock }) {
  return (
    <li className="text-sm leading-relaxed">
      {unlock.capability && (
        <span className="font-semibold text-slate-700">{unlock.capability}</span>
      )}
      {unlock.blocked_by && (
        <span className="text-slate-400"> — blocked by {unlock.blocked_by}</span>
      )}
      {unlock.hint && <p className="mt-0.5 text-slate-500">{unlock.hint}</p>}
    </li>
  );
}

// A subtle icon + short label per planner factor.
function factorMeta(factor: ModelDecision["factor"]): { icon: LucideIcon; label: string } {
  switch (factor) {
    case "spatial":
      return { icon: Grid3x3, label: "Spatial" };
    case "staging":
      return { icon: Layers, label: "Staging" };
    case "gxe":
      return { icon: Network, label: "GxE" };
    case "genotype_effect":
      return { icon: Dna, label: "Genotype" };
    case "engine":
      return { icon: Cpu, label: "Engine" };
    default:
      return { icon: Cpu, label: factor };
  }
}

// GxE 'skipped' is an honest "not estimated here", not an error — color the included case green,
// leave everything else neutral slate.
function decisionTone(decision: ModelDecision): {
  iconBg: string;
  iconText: string;
  choiceText: string;
} {
  if (decision.factor === "gxe") {
    const included = decision.choice.toLowerCase().includes("includ");
    if (included) {
      return {
        iconBg: "bg-emerald-50",
        iconText: "text-emerald-600",
        choiceText: "text-emerald-700",
      };
    }
    return { iconBg: "bg-amber-50", iconText: "text-amber-600", choiceText: "text-amber-700" };
  }
  return { iconBg: "bg-slate-100", iconText: "text-slate-500", choiceText: "text-slate-800" };
}
