// The DATA-CUT model over the synthetic tomato program (ADR-0023, docs/sim-corpus-spec.md).
//
// Trials are tagged to a node in a MARKET-TARGET HIERARCHY (a tree: All > TPE > specific market). Tags
// narrow as material advances — early screens are tagged broadly (All), late market-specific trials at
// the leaf (Brix / Firmness / East). Germplasm is never tagged; a line's markets are derived from the
// trials it appears in.
//
// A data cut is a breeder-composed COMPOSITE: a SET of selected nodes; the cut is the union of trials
// tagged to those nodes (no auto-expansion — the UI cascades a parent's checkbox to its subtree, but
// the cut itself is just "trials whose tag is in the selected set"). So a Brix training set = pick
// {All, Processing, Brix}; a narrow decision = {Brix}; a cross-strategy cut = {Brix, East}. The rank
// index is one of the markets (leaf nodes carrying weights).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { tomatoCorpusDir } from './paths';

export interface TrialMeta {
  trial_id: string; stage: string; stage_label: string; year: number; tpe: string;
  market_tag: string; // a node key in the hierarchy
  n_entries: number; n_loc: number; n_rep: number; design: string; traits_measured: string[]; file: string;
}
export interface HierNode { parent: string | null; tpe: string | null; label: string; weights?: Record<string, number> }
export interface Manifest {
  program: string; traits: string[];
  tpes: Record<string, { label: string }>;
  hierarchy: Record<string, HierNode>; // the market-target tree
  trials: TrialMeta[];
}

let _manifest: Manifest | null = null;
export function loadManifest(): Manifest {
  if (_manifest) return _manifest;
  return (_manifest = JSON.parse(readFileSync(join(tomatoCorpusDir(), 'manifest.json'), 'utf8')) as Manifest);
}

// ---- hierarchy helpers --------------------------------------------------------------------------
/** Ancestor chain of a node, inclusive: e.g. Proc-Brix → [Proc-Brix, Processing, All]. */
export function ancestorChain(node: string, m: Manifest = loadManifest()): string[] {
  const chain: string[] = []; let cur: string | null = node;
  while (cur && m.hierarchy[cur]) { chain.push(cur); cur = m.hierarchy[cur].parent; }
  return chain;
}
/** A node + all transitive descendants (for the UI's "check a parent → check the subtree" cascade). */
export function subtree(node: string, m: Manifest = loadManifest()): string[] {
  const out = [node];
  for (const [k, n] of Object.entries(m.hierarchy)) if (n.parent === node) out.push(...subtree(k, m));
  return out;
}
/** The rankable markets (hierarchy nodes carrying index weights — the leaves). */
export function markets(m: Manifest = loadManifest()): Array<{ id: string; label: string; tpe: string | null; tag: string }> {
  return Object.entries(m.hierarchy).filter(([, n]) => n.weights).map(([id, n]) => ({ id, label: n.label, tpe: n.tpe, tag: id }));
}
/** Back-compat: a flat market list for older callers. */
export function marketList(m: Manifest = loadManifest()): Array<{ id: string; label: string }> {
  return markets(m).map((x) => ({ id: x.id, label: x.label }));
}

const STAGE_ORDER = ['S1', 'S2', 'S3', 'S4'];
export type Purpose = 'prediction' | 'advancement';

export interface Cut {
  id: string; purpose: Purpose; market: string; market_label: string; tpe: string;
  label: string; blurb: string; tags: string[]; custom?: boolean;
}

/** The canonical templates: per rankable market, a broad prediction cut (the market's whole ancestor
 *  chain) and a narrow advancement cut (just the market's own late trials). Starting points to compose
 *  from — the breeder edits the node set freely. */
export function listCuts(m: Manifest = loadManifest()): Cut[] {
  const cuts: Cut[] = [];
  for (const mk of markets(m)) {
    cuts.push({
      id: `predict-${mk.id.toLowerCase()}`, purpose: 'prediction', market: mk.id, market_label: mk.label, tpe: mk.tpe ?? '',
      label: `Prediction · ${mk.label}`, blurb: 'Broad training set: this market and the broader stages it narrowed from.',
      tags: ancestorChain(mk.id, m),
    });
    cuts.push({
      id: `advance-${mk.id.toLowerCase()}`, purpose: 'advancement', market: mk.id, market_label: mk.label, tpe: mk.tpe ?? '',
      label: `Advancement · ${mk.label}`, blurb: 'Narrow decision set: only the market-specific late trials.',
      tags: [mk.id],
    });
  }
  return cuts;
}
export function cutById(id: string, m: Manifest = loadManifest()): Cut | null {
  return listCuts(m).find((c) => c.id === id) ?? null;
}

/** A rankable market available to a cut (its trials are in the cut) — drives the Select-step switcher. */
export interface CutMarket { id: string; label: string; weights: Record<string, number> }
export interface AssembledCut {
  cut: Cut; traits: string[]; weights: Record<string, number>; trials: TrialMeta[];
  /** Full plot records. row/col carry the field grid; parent1/parent2 are set on F1-hybrid testcross
   *  trials (null on inbred-line trials) and drive the combining-ability facet. */
  records: Array<{ genotype: string; environment: string; row: number | null; col: number | null; rep: string | number | null; parent1: string | null; parent2: string | null; values: Array<number | null> }>;
  germplasm: string[];
  /** Every market whose TPE is represented in the cut — the cut is ranked under EACH (one fit, many
   *  lenses); the Select step switches between them. */
  relevantMarkets: CutMarket[];
  composition: { n_trials: number; n_env: number; n_geno: number; n_obs: number; n_checks: number; stages: string[]; years: number[] };
}

const isCheck = (g: string) => g.startsWith('CHK-');

function readTrial(t: TrialMeta, traits: string[]): AssembledCut['records'] {
  const rows = parse(readFileSync(join(tomatoCorpusDir(), t.file)), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const num = (v: string | undefined) => (v == null || v === '' || v === 'NA' ? null : Number(v));
  return rows.map((r) => ({
    genotype: r.genotype,
    environment: `${t.trial_id}/${r.env}`, // namespace so distinct trials never merge into one env
    row: num(r.row), col: num(r.col), // real field grid → planner can recommend SpATS / two-stage
    rep: r.rep ?? null,
    parent1: r.parent1 || null, parent2: r.parent2 || null, // F1 testcross trials carry parentage
    values: traits.map((tr) => num(r[tr])),
  }));
}

// ---- combining-ability inbred fixture (ADR-0019/0020) -------------------------------------------
export interface InbredFact { name: string; role: string; pool: string; per_se: number | null; nclb: number | null }
let _inbreds: Map<string, InbredFact> | null = null;
/** The testcross lines' inbred facts (heterotic pool / per-se merit / native disease trait) from
 *  data/tomato/inbreds.csv — the combining-ability driver's parent-level data. */
export function loadInbreds(): Map<string, InbredFact> {
  if (_inbreds) return _inbreds;
  const path = join(tomatoCorpusDir(), 'inbreds.csv');
  const m = new Map<string, InbredFact>();
  try {
    const rows = parse(readFileSync(path), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    for (const r of rows) m.set(r.name, {
      name: r.name, role: r.role, pool: r.pool,
      per_se: r.per_se === '' || r.per_se === 'NA' ? null : Number(r.per_se),
      nclb: r.nclb === '' || r.nclb === 'NA' ? null : Number(r.nclb),
    });
  } catch { /* no inbred fixture → combining ability simply won't run */ }
  return (_inbreds = m);
}

/** The tomato corpus marker panel: data/tomato/markers.csv read ONCE into a genotype→dosage matrix
 *  (`byId`), the marker-column order (`cols`), and a column→position `index`. The single reader the
 *  genomic, combining-ability and recycling facets share (each used to re-parse the file itself). */
export interface MarkerPanel { byId: Map<string, number[]>; cols: string[]; nMarkers: number; index: Map<string, number> }
let _markerPanel: MarkerPanel | null = null;
export function markerPanel(): MarkerPanel {
  if (_markerPanel) return _markerPanel;
  const rows = parse(readFileSync(join(tomatoCorpusDir(), 'markers.csv')), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const cols = Object.keys(rows[0] ?? {}).filter((c) => c !== 'genotype');
  const index = new Map(cols.map((c, i) => [c, i]));
  const byId = new Map<string, number[]>();
  for (const r of rows) byId.set(r.genotype, cols.map((c) => Number(r[c])));
  return (_markerPanel = { byId, cols, nMarkers: cols.length, index });
}

/** Markets (leaf nodes with weights) whose TPE appears among the cut's trials. */
function relevantMarketsFor(trials: TrialMeta[], m: Manifest): CutMarket[] {
  const tpes = new Set(trials.map((t) => t.tpe));
  return Object.entries(m.hierarchy)
    .filter(([, n]) => n.weights && n.tpe && tpes.has(n.tpe))
    .map(([id, n]) => ({ id, label: n.label, weights: n.weights as Record<string, number> }));
}

function compose(cut: Cut, trials: TrialMeta[], rankMarket: string, m: Manifest): AssembledCut {
  const traits = m.traits;
  const records = trials.flatMap((t) => readTrial(t, traits));
  const germplasm = [...new Set(records.map((r) => r.genotype))];
  return {
    cut, traits, weights: m.hierarchy[rankMarket]?.weights ?? {}, trials, records, germplasm,
    relevantMarkets: relevantMarketsFor(trials, m),
    composition: {
      n_trials: trials.length, n_env: new Set(records.map((r) => r.environment)).size, n_geno: germplasm.length,
      n_obs: records.length, n_checks: germplasm.filter(isCheck).length,
      stages: [...new Set(trials.map((t) => t.stage))].sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b)),
      years: [...new Set(trials.map((t) => t.year))].sort(),
    },
  };
}

/** Trials in a composite = union of trials tagged to any selected node. */
export function trialsForTags(tags: string[], m: Manifest = loadManifest()): TrialMeta[] {
  const set = new Set(tags);
  return m.trials.filter((t) => set.has(t.market_tag));
}

/** Assemble a template/canonical cut from its node set, ranked by its market. */
export function assembleCut(cut: Cut, m: Manifest = loadManifest()): AssembledCut {
  return compose(cut, trialsForTags(cut.tags, m), cut.market, m);
}

/** A breeder-defined cut: a name and the exact trials (the UI resolves the composite of selected nodes
 *  to this list). The cut is ranked under every market its trials touch; `market` (optional) just sets
 *  the default lens shown first. */
export interface CutDef { id: string; name: string; trialIds: string[]; market?: string }
export function assembleCustom(def: CutDef, m: Manifest = loadManifest()): AssembledCut {
  const trials = def.trialIds.map((id) => m.trials.find((t) => t.trial_id === id)).filter((t): t is TrialMeta => !!t);
  if (trials.length === 0) throw new Error('a cut must include at least one trial');
  const rel = relevantMarketsFor(trials, m);
  const primary = (def.market && rel.some((r) => r.id === def.market)) ? def.market : rel[0]?.id;
  if (!primary) throw new Error('the chosen trials are not associated with any rankable market');
  const mk = m.hierarchy[primary];
  const multiStage = new Set(trials.map((t) => t.stage)).size > 1;
  const cut: Cut = {
    id: def.id, purpose: multiStage ? 'prediction' : 'advancement', market: primary, market_label: mk.label,
    tpe: mk.tpe ?? '', label: def.name, blurb: 'Breeder-defined cut — the trials you composed.',
    tags: [...new Set(trials.map((t) => t.market_tag))], custom: true,
  };
  return compose(cut, trials, primary, m);
}

/** The full trial catalog (for "see all the data"), in funnel order. */
export function trialCatalog(m: Manifest = loadManifest()): TrialMeta[] {
  return [...m.trials].sort((a, b) =>
    a.year - b.year || STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.trial_id.localeCompare(b.trial_id));
}

/** The market-target hierarchy for the builder UI: every node (in tree/DFS order) with its depth,
 *  whether it's a rankable market, and how many trials carry its tag. */
export interface TaxNode { id: string; label: string; parent: string | null; tpe: string | null; depth: number; isMarket: boolean; trialCount: number }
export interface CutTaxonomy { nodes: TaxNode[]; markets: Array<{ id: string; label: string; tpe: string | null }> }
export function cutTaxonomy(m: Manifest = loadManifest()): CutTaxonomy {
  const count = (tag: string) => m.trials.filter((t) => t.market_tag === tag).length;
  const depthOf = (id: string) => ancestorChain(id, m).length - 1;
  // DFS from each root (parent null) so children follow parents.
  const order: string[] = [];
  const visit = (id: string) => { order.push(id); for (const [k, n] of Object.entries(m.hierarchy)) if (n.parent === id) visit(k); };
  for (const [id, n] of Object.entries(m.hierarchy)) if (n.parent == null) visit(id);
  const nodes: TaxNode[] = order.map((id) => {
    const n = m.hierarchy[id];
    return { id, label: n.label, parent: n.parent, tpe: n.tpe, depth: depthOf(id), isMarket: !!n.weights, trialCount: count(id) };
  });
  return { nodes, markets: markets(m).map((x) => ({ id: x.id, label: x.label, tpe: x.tpe })) };
}
