// The grounding checker (ADR-0002): the single source of truth for "does this answer state only
// facts present in the result bundle?" Used in TWO places — the runtime guardrail (every live answer
// is checked before the breeder sees it) and the CI eval gate — so they can never drift.
//
// It enforces two invariants:
//   1. NUMBERS — every figure in the answer matches a value in the bundle (to its stated precision).
//      Digits embedded in identifiers (the 779 in "B73/TX779") are NOT figures and are ignored.
//   2. ENTITIES — every germplasm / trait / target-market NAME the answer uses exists in the bundle.
//      No invented lines, traits, or markets.
import type { ResultBundle } from "@verdant/contracts";

export interface GroundingResult {
  grounded: boolean;
  unverifiedNumbers: string[];
  unverifiedEntities: string[];
}

/** Every numeric value anywhere in the bundle. */
export function bundleNumbers(node: unknown, acc: number[] = []): number[] {
  if (typeof node === "number") acc.push(node);
  else if (Array.isArray(node)) for (const x of node) bundleNumbers(x, acc);
  else if (node && typeof node === "object") for (const v of Object.values(node)) bundleNumbers(v, acc);
  return acc;
}

/** The names an answer is allowed to use: germplasm ids, trait ids, target-market (segment) ids, and
 *  combining-ability lines/testers/loci. Lowercased for case-insensitive matching. */
export function bundleEntities(bundle: ResultBundle): Set<string> {
  const s = new Set<string>();
  const add = (x?: string | null) => { if (x && x.trim()) s.add(x.toLowerCase()); };
  for (const t of bundle.traits ?? []) { add(t.variable_id); for (const e of t.effects ?? []) add(e.germplasm_id); }
  for (const v of bundle.genetic_correlations?.variable_ids ?? []) add(v);
  for (const i of bundle.indices ?? []) { add(i.segment_id); for (const r of i.ranking ?? []) add(r.germplasm_id); }
  const ca = (bundle as unknown as {
    combining_ability?: {
      gca?: Array<{ line: string }>;
      hybrids?: Array<{ hybrid: string; line: string; tester: string }>;
      loci_catalog?: Array<{ locus: string }>;
    };
  }).combining_ability;
  if (ca) {
    for (const g of ca.gca ?? []) add(g.line);
    for (const h of ca.hybrids ?? []) { add(h.hybrid); add(h.line); add(h.tester); }
    for (const l of ca.loci_catalog ?? []) add(l.locus);
  }
  return s;
}

// A figure: a standalone number, optionally with thousands-commas and/or a trailing %. The lookbehind
// /lookahead reject digits glued into an identifier (TX779, PHW65, met_2019), so only real figures
// are checked.
const NUM_RE = /(?<![\w/.-])-?\d+(?:,\d{3})*(?:\.\d+)?%?(?![\w/])/g;

// An id-shaped token: alnum parts joined by "/" or "_" (B73/TX779, Yield_Mg_ha, PHN11_PHW65_0626/PHT69),
// or a Letter-then-digits token (G1, TX779, PHT69). Plain words and digit-free acronyms (BLUP, GCA)
// don't match, so ordinary prose is never treated as a name to verify.
const ID_RE = /\b[A-Za-z0-9]+(?:[/_][A-Za-z0-9]+)+\b|\b[A-Z][A-Za-z]*\d+[A-Za-z0-9]*\b/g;

// Generic breeding/stats terms that look id-shaped but aren't germplasm — never flag these.
const GENERIC_TERMS = new Set([
  "f1", "f2", "f3", "f4", "f5", "bc1", "bc2", "bc3", "s0", "s1", "s2", "s3", "s4", "s5",
  "p1", "p2", "r2", "h2", "co2", "qtl", "v0", "gxe", "g2f",
]);

function numberGrounded(tok: string, numbers: number[]): boolean {
  const pct = tok.endsWith("%");
  const raw = Number(tok.replace(/[,%]/g, ""));
  if (!Number.isFinite(raw)) return true;
  const decimals = tok.replace("%", "").split(".")[1]?.length ?? 0;
  const tol = Math.max(0.5 * 10 ** -decimals, pct ? 0.005 : 0);
  // A percent may express a proportion in the bundle (20% ~ 0.20), so accept either reading.
  const candidates = pct ? [raw, raw / 100] : [raw];
  return candidates.some((a) => numbers.some((b) => Math.abs(a - b) <= tol));
}

/** Number-only check (the CI self-test surface; kept for the exemplar checks in run.mjs). */
export function ungroundedNumbers(text: string, numbers: number[]): string[] {
  const bad: string[] = [];
  for (const m of text.match(NUM_RE) ?? []) if (!numberGrounded(m, numbers)) bad.push(m);
  return [...new Set(bad)];
}

/** Full grounding check: numbers + named entities. The runtime guardrail and the eval gate both use it. */
export function checkGrounding(text: string, bundle: ResultBundle): GroundingResult {
  const numbers = bundleNumbers(bundle);
  const entities = bundleEntities(bundle);
  const entityList = [...entities];

  const unverifiedNumbers = ungroundedNumbers(text, numbers);

  const unverifiedEntities: string[] = [];
  for (const m of text.match(ID_RE) ?? []) {
    const key = m.toLowerCase();
    if (GENERIC_TERMS.has(key)) continue;
    // Known if it equals a bundle entity, or is a part of one / contains one (TX779 ⊂ B73/TX779).
    const known = entities.has(key) || entityList.some((e) => e.includes(key) || key.includes(e));
    if (!known) unverifiedEntities.push(m);
  }

  return {
    grounded: unverifiedNumbers.length === 0 && unverifiedEntities.length === 0,
    unverifiedNumbers,
    unverifiedEntities: [...new Set(unverifiedEntities)],
  };
}
