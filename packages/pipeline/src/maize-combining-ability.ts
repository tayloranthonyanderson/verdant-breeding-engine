// Combining-ability facet for the maize corpus (ADR-0019/0020). Every maize trial is an F1 testcross —
// records carry parent1 (candidate line) / parent2 (tester); this feeds the SAME generic kernel
// (combining-ability.R) the G2F path uses, decomposing the hybrids into GCA (the parent selection target)
// + SCA. Parent-level facts (heterotic pool, per-se merit, native disease trait) come from inbreds.csv;
// the marker gate's loci are read from markers.csv against a small maize gene panel. Returns the
// combining_ability block the Understand + Select (Parents·GCA / Hybrids) views render. Best-effort:
// callers wrap in try/catch, and it returns null when the cut carries no crosses.
import { runRKernel } from './kernel';
import { loadInbreds, markerPanel, type AssembledCut } from './maize-corpus';
import { buildMaizeRecycling } from './maize-recycling';
import type { CombiningAbility } from './combining-ability-build';

// A small maize major-gene panel for the marker gate (GcaGates): each locus maps to one marker column
// in markers.csv; an inbred carries the favorable (resistant/quality) allele when its dosage there ≥ 1.
// Real maize genes — the demo's marker-assisted-selection vocabulary (replace with a genotyped panel).
interface MaizeLocus { locus: string; trait: string; alleles: [string, string]; favorable: string; freq: number; marker: string }
const MAIZE_LOCI: MaizeLocus[] = [
  { locus: 'Ht1',  trait: 'Northern corn leaf blight resistance', alleles: ['Ht1', 'ht1'],   favorable: 'Ht1',  freq: 0.45, marker: 'm007' },
  { locus: 'Rp1',  trait: 'Common rust resistance',               alleles: ['Rp1', 'rp1'],   favorable: 'Rp1',  freq: 0.35, marker: 'm042' },
  { locus: 'Rcg1', trait: 'Anthracnose stalk rot resistance',     alleles: ['Rcg1', 'rcg1'], favorable: 'Rcg1', freq: 0.30, marker: 'm088' },
  { locus: 'o2',   trait: 'Opaque-2 / high-lysine (QPM)',         alleles: ['o2', '+'],      favorable: 'o2',   freq: 0.40, marker: 'm150' },
];
const NATIVE_GATE = 'NCLB_resistant'; // the native-trait gate id (northern corn leaf blight) — see combining-ability.R native_id

/** A line's homozygous-ish allele at each gate locus (dosage ≥ 1 → favorable), for the marker gate.
 *  Reads the shared marker panel by column index. */
function allelesFor(name: string): Record<string, string> {
  const panel = markerPanel();
  const dos = panel.byId.get(name);
  const out: Record<string, string> = {};
  for (const L of MAIZE_LOCI) {
    const other = L.alleles[0] === L.favorable ? L.alleles[1] : L.alleles[0];
    const idx = panel.index.get(L.marker);
    const d = dos && idx != null ? (dos[idx] ?? 0) : 0;
    out[L.locus] = d >= 1 ? L.favorable : other;
  }
  return out;
}

/** Does this cut carry an F1 testcross trial (records with both parents)? */
export function cutHasCrosses(assembled: AssembledCut): boolean {
  return assembled.records.some((r) => r.parent1 && r.parent2);
}

/** Compute the combining_ability facet for a cut that includes a testcross trial. Returns null when the
 *  cut has no crosses or too few lines for a meaningful GCA fit. */
export function buildMaizeCombiningAbility(assembled: AssembledCut): CombiningAbility | null {
  const traits = assembled.traits;
  const hyb = assembled.records.filter((r) => r.parent1 && r.parent2);
  if (hyb.length === 0) return null;
  const lines = [...new Set(hyb.map((r) => r.parent1 as string))];
  if (lines.length < 4) return null; // too few candidate lines for within-pool GCA

  // Objective: the cut's market weights become the GCA index; the native disease trait is the cull gate.
  const index_weights = Object.entries(assembled.weights)
    .filter(([vid]) => traits.includes(vid))
    .map(([vid, w]) => ({ variable_id: vid, mode: (w < 0 ? 'min' : 'max') as 'min' | 'max', weight: Math.abs(w) }));
  const objective = { index_weights, gates: [{ variable_id: NATIVE_GATE, operator: '>=' as const, threshold: 1 }] };

  const inbreds = loadInbreds();
  const facts = lines.map((l) => inbreds.get(l));
  // per-se merit is per-TPE (a parent attribute): a corn-belt cut reads corn-belt per-se, dryland reads
  // dryland per-se — so the per-se↔GCA divergence is shown in the cut's own market context.
  const perSe = (f: (typeof facts)[number]) =>
    assembled.cut.tpe === 'cornbelt' ? (f?.per_se_cb ?? f?.per_se ?? null) : (f?.per_se ?? null);
  const payload = {
    traits,
    tester_fixed_max: 8,
    plot: {
      genotype: hyb.map((r) => r.genotype),
      parent1: hyb.map((r) => r.parent1),
      parent2: hyb.map((r) => r.parent2),
      environment: hyb.map((r) => r.environment),
      row: hyb.map((r) => r.row),
      col: hyb.map((r) => r.col),
      values: Object.fromEntries(traits.map((t, j) => [t, hyb.map((r) => r.values[j])])),
    },
    inbred: {
      native_id: NATIVE_GATE,
      name: lines,
      role: lines.map(() => 'line'),
      pool: facts.map((f) => f?.pool ?? 'Unassigned'),
      per_se: facts.map((f) => perSe(f)),
      nclb: facts.map((f) => f?.nclb ?? null),
    },
    objective,
  };

  const ca = runRKernel<{ combining_ability: CombiningAbility }>('combining-ability.R', payload, { transport: 'cfg-file', maxBuffer: 1 << 28 }).combining_ability;
  // Attach each line's marker calls (the gate source) + the maize locus catalog for the GcaGates UI.
  ca.gca = ca.gca.map((g) => ({ ...g, loci: allelesFor(g.line) }));
  ca.loci_catalog = MAIZE_LOCI.map(({ locus, trait, alleles, favorable, freq }) => ({ locus, trait, alleles, favorable, freq }));
  // Within-pool recycling (mode 2) — usefulness vs OCS per pool. Best-effort; rides along on the same block.
  try { ca.recycling = buildMaizeRecycling(); } catch { /* recycling stays absent */ }
  return ca;
}
