// Combining-ability facet for the tomato corpus (ADR-0019/0020). The tomato testcross trial (S3-2024-TXH)
// records F1 plots with parent1 (candidate line) / parent2 (tester); this feeds the SAME generic kernel
// (combining-ability.R) the G2F path uses, decomposing the hybrids into GCA (the parent selection target)
// + SCA. Parent-level facts (heterotic pool, per-se merit, native disease trait) come from inbreds.csv;
// the marker gate's loci are read from markers.csv against a small tomato gene panel. Returns the
// combining_ability block the Understand + Select (Parents·GCA / Hybrids) views render. Best-effort:
// callers wrap in try/catch, and it returns null when the cut carries no crosses.
import { runRKernel } from './kernel';
import { loadInbreds, markerPanel, type AssembledCut } from './tomato-corpus';
import { buildTomatoRecycling } from './tomato-recycling';
import type { CombiningAbility } from './combining-ability-build';

// A small tomato major-gene panel for the marker gate (GcaGates): each locus maps to one marker column
// in markers.csv; an inbred carries the favorable (resistant/quality) allele when its dosage there ≥ 1.
// Real tomato genes — the demo's marker-assisted-selection vocabulary (replace with a genotyped panel).
interface TomatoLocus { locus: string; trait: string; alleles: [string, string]; favorable: string; freq: number; marker: string }
const TOMATO_LOCI: TomatoLocus[] = [
  { locus: 'Pto',  trait: 'Bacterial speck resistance',      alleles: ['Pto', 'pto'],   favorable: 'Pto',  freq: 0.45, marker: 'm007' },
  { locus: 'Ph-3', trait: 'Late blight resistance',          alleles: ['Ph-3', 'ph-3'], favorable: 'Ph-3', freq: 0.35, marker: 'm042' },
  { locus: 'Sw-5', trait: 'Tomato spotted wilt resistance',  alleles: ['Sw-5', 'sw-5'], favorable: 'Sw-5', freq: 0.30, marker: 'm088' },
  { locus: 'ogc',  trait: 'Crimson / high-lycopene',         alleles: ['ogc', '+'],     favorable: 'ogc',  freq: 0.40, marker: 'm150' },
];
const NATIVE_GATE = 'Pto_resistant'; // the native-trait gate id (bacterial speck) — see combining-ability.R native_id

/** A line's homozygous-ish allele at each gate locus (dosage ≥ 1 → favorable), for the marker gate.
 *  Reads the shared marker panel by column index. */
function allelesFor(name: string): Record<string, string> {
  const panel = markerPanel();
  const dos = panel.byId.get(name);
  const out: Record<string, string> = {};
  for (const L of TOMATO_LOCI) {
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
export function buildTomatoCombiningAbility(assembled: AssembledCut): CombiningAbility | null {
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
      per_se: facts.map((f) => f?.per_se ?? null),
      nclb: facts.map((f) => f?.nclb ?? null),
    },
    objective,
  };

  const ca = runRKernel<{ combining_ability: CombiningAbility }>('combining-ability.R', payload, { transport: 'cfg-file', maxBuffer: 1 << 28 }).combining_ability;
  // Attach each line's marker calls (the gate source) + the tomato locus catalog for the GcaGates UI.
  ca.gca = ca.gca.map((g) => ({ ...g, loci: allelesFor(g.line) }));
  ca.loci_catalog = TOMATO_LOCI.map(({ locus, trait, alleles, favorable, freq }) => ({ locus, trait, alleles, favorable, freq }));
  // Within-pool recycling (mode 2) — usefulness vs OCS per pool. Best-effort; rides along on the same block.
  try { ca.recycling = buildTomatoRecycling(); } catch { /* recycling stays absent */ }
  return ca;
}
