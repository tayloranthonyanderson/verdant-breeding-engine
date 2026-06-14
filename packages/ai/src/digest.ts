// A compact, NUMBER-FAITHFUL text rendering of the result bundle — the grounding context the AI is
// allowed to draw on (ADR-0002: the AI explains the bundle, never computes). Every figure here comes
// straight from the bundle, so an answer that cites only digest numbers passes the groundedness gate.
import type { ResultBundle } from "@verdant/contracts";

const TOP_N = 10;

function fmt(n: number | null | undefined, dp = 3): string {
  return n == null || !Number.isFinite(n) ? "—" : Number(n.toFixed(dp)).toString();
}

/** Distinct weighted-index segments (target markets), in bundle order. */
export function segmentsOf(bundle: ResultBundle): string[] {
  const out: string[] = [];
  for (const i of bundle.indices ?? [])
    if (i.kind === "weighted" && i.segment_id && !out.includes(i.segment_id)) out.push(i.segment_id);
  return out;
}

export function bundleDigest(bundle: ResultBundle): string {
  const L: string[] = [];
  const traitIds = bundle.traits?.map((t) => t.variable_id) ?? [];
  const nGeno = bundle.traits?.[0]?.effects?.length ?? 0;
  const nEnv = bundle.data_readiness?.scale?.n_env ?? null;

  L.push(`TRIAL: intent=${bundle.intent ?? "?"}; ${traitIds.length} traits; ${nGeno} genotypes; ${nEnv ?? "?"} environments.`);
  if (bundle.chosen_model?.description) L.push(`MODEL: ${bundle.chosen_model.description}`);

  L.push("");
  L.push("TRAITS (heritability h2, genetic SD):");
  for (const t of bundle.traits ?? [])
    L.push(`- ${t.variable_id}: h2=${fmt(t.heritability?.value, 4)}, genetic_sd=${fmt(t.genetic_sd, 4)}`);

  // Genetic correlations (each off-diagonal pair once).
  const gc = bundle.genetic_correlations;
  if (gc?.variable_ids?.length && gc.matrix?.length) {
    L.push("");
    L.push("GENETIC CORRELATIONS (trait pair: r):");
    for (let i = 0; i < gc.variable_ids.length; i++)
      for (let j = i + 1; j < gc.variable_ids.length; j++)
        L.push(`- ${gc.variable_ids[i]} × ${gc.variable_ids[j]}: ${fmt(gc.matrix[i]?.[j], 2)}`);
  }

  // Per-target-market rankings (weighted index), top N each.
  L.push("");
  L.push(`RANKINGS by target market (top ${TOP_N}, transparent weighted index):`);
  for (const seg of segmentsOf(bundle)) {
    const idx = bundle.indices?.find((i) => i.kind === "weighted" && i.segment_id === seg);
    const top = (idx?.ranking ?? []).slice(0, TOP_N).map((r) => `#${r.rank} ${r.germplasm_id} (${fmt(r.score)})`);
    L.push(`- [${seg}] ${top.join(", ")}`);
  }

  // Transparent ↔ genetically-aware divergence (the insight).
  if (bundle.divergence) {
    L.push("");
    L.push(`DIVERGENCE (transparent vs genetically-aware): rank_correlation=${fmt(bundle.divergence.rank_correlation, 2)}.`);
    const movers = (bundle.divergence.notable_movers ?? [])
      .filter((m): m is { germplasm_id: string; rank_delta: number } => m?.germplasm_id != null)
      .slice(0, 8)
      .map((m) => `${m.germplasm_id} (Δ${m.rank_delta})`);
    if (movers.length) L.push(`Notable movers: ${movers.join(", ")}.`);
  }

  // Combining ability, if attached (loosely typed in the bundle).
  const ca = (bundle as unknown as Record<string, unknown>).combining_ability as
    | { topology?: { kind?: string; n_lines?: number }; traits?: Array<{ variable_id: string; baker_ratio: number | null }> }
    | undefined;
  if (ca?.topology) {
    L.push("");
    L.push(`COMBINING ABILITY: topology=${ca.topology.kind ?? "?"}, ${ca.topology.n_lines ?? "?"} lines.`);
    for (const t of ca.traits ?? []) L.push(`- ${t.variable_id}: Baker's ratio=${fmt(t.baker_ratio, 2)}`);
  }

  return L.join("\n");
}
