// Dataset-agnostic question suggestions for "Ask your results" (AskPanel). The old suggestions were
// hardcoded to the G2F maize demo ("Yield-first market", hybrid "lines"), so on any other dataset they
// pointed at markets/entities that don't exist — the app would suggest a question its own results
// couldn't answer. These are derived from the actual bundle: real weighted-index segments (target
// markets), and only the questions the bundle can actually answer (divergence/genomic offered only when
// present). Every entity named here appears in the bundle, so the grounded answerer stays grounded.
import type { ResultBundle } from "@verdant/contracts";

/** Distinct weighted-index segments (target markets) in bundle order — the same ids the AI digest uses. */
function segmentsOf(bundle: ResultBundle): string[] {
  const out: string[] = [];
  for (const i of bundle.indices ?? [])
    if (i.kind === "weighted" && i.segment_id && !out.includes(i.segment_id)) out.push(i.segment_id);
  return out;
}

export function suggestQuestions(bundle?: ResultBundle | null): string[] {
  if (!bundle) return ["What's the heritability of each trait?"];
  const segs = segmentsOf(bundle);
  const hasGenomic = !!(bundle as { genomic?: unknown }).genomic;
  const out: string[] = [];

  // 1. Top candidates for a real target market (or overall if the cut has no market index).
  out.push(segs.length ? `Which genotypes rank highest for ${segs[0]}, and why?` : "Which genotypes rank highest overall?");
  // 2. Heritability — always answerable from the traits block.
  out.push("What's the heritability of each trait?");
  // 3. The transparent-vs-genetic divergence is the headline insight — but only if it was computed.
  if (bundle.divergence) out.push("Where do the transparent and genetically-aware indices disagree?");
  // 4. Genomic prediction question only when a genomic block exists; else a cross-market trade-off when
  //    the cut spans two markets.
  if (hasGenomic) out.push("How much does genomic prediction change the top selections?");
  else if (segs.length >= 2) out.push(`Which genotypes hold up across ${segs[0]} and ${segs[1]}?`);

  return out.slice(0, 4);
}
