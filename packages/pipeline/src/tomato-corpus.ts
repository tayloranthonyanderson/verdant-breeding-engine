// The DATA-CUT model over the synthetic tomato program (ADR-0023, docs/sim-corpus-spec.md).
//
// The breeder never tags germplasm and never checks a box per trial. Trials carry a market tag (in a
// shallow hierarchy: All > Processing / Fresh-East), defaulted by stage — early stages tag the broad
// parent (All), late stages tag the TPE node. A line's market membership is DERIVED: it's the markets
// of the trials it appears in. From those tags, two purposes assemble two different cuts:
//
//   • PREDICTION (broad) — relevance is the TPE, not the stage: pool every trial tagged with the
//     market's node OR an ancestor, across ALL stages and years. Early All-tagged trials feed every
//     market; survivors + common checks glue the pool. The widest informative training cut.
//   • ADVANCEMENT (narrow) — the advance/drop decision at a stage: only the latest-stage trials for
//     that market's node, this is the focused hybrid-advancement set.
//
// The two processing markets (Brix, Firmness) SHARE the Processing TPE → identical trial cut, ranked
// by different index weights (one fit, two lenses). Fresh-East has its own TPE → its own fit (GCA×E).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { tomatoCorpusDir } from './paths';

export interface TrialMeta {
  trial_id: string;
  stage: string; // S1..S4
  stage_label: string;
  year: number;
  tpe: string; // 'processing' | 'fresh-east'
  market_tag: string; // node in market_hierarchy: 'All' | 'Processing' | 'Fresh-East'
  n_entries: number;
  n_loc: number;
  n_rep: number;
  design: string;
  traits_measured: string[];
  file: string;
}
interface MarketDef { tag: string; tpe: string; label: string; weights: Record<string, number> }
interface HierNode { parent: string | null; tpe: string | null; label: string }
export interface Manifest {
  program: string;
  traits: string[];
  tpes: Record<string, { label: string; description: string }>;
  market_hierarchy: Record<string, HierNode>;
  markets: Record<string, MarketDef>;
  trials: TrialMeta[];
}

let _manifest: Manifest | null = null;
export function loadManifest(): Manifest {
  if (_manifest) return _manifest;
  const raw = JSON.parse(readFileSync(join(tomatoCorpusDir(), 'manifest.json'), 'utf8')) as Manifest;
  // jsonlite writes parent: NA → null already; normalize just in case.
  return (_manifest = raw);
}

/** The node's ancestor chain (inclusive), e.g. 'Processing' → ['Processing','All']. */
function ancestors(node: string, hier: Manifest['market_hierarchy']): string[] {
  const chain: string[] = [];
  let cur: string | null = node;
  while (cur && hier[cur]) { chain.push(cur); cur = hier[cur].parent; }
  return chain;
}

const STAGE_ORDER = ['S1', 'S2', 'S3', 'S4'];

export type Purpose = 'prediction' | 'advancement';
export interface Cut {
  id: string;
  purpose: Purpose;
  market: string; // key into manifest.markets
  market_label: string;
  tpe: string;
  label: string;
  blurb: string;
  /** true when the breeder hand-picked the trials (a saved preset), false for the built-in templates. */
  custom?: boolean;
}

/** The markets a cut's index can rank on (id + label + signed weights), for the builder UI. */
export function marketList(m: Manifest = loadManifest()): Array<{ id: string; label: string }> {
  return Object.entries(m.markets).map(([id, d]) => ({ id, label: d.label }));
}

/** The market taxonomy for the builder UI: the TPE groups, the rankable markets (leaves) under each,
 *  and the trial-tag hierarchy (All > TPE) so the UI can show how early 'All' trials feed every market. */
export interface CutTaxonomy {
  root: { tag: string; label: string }; // the broad early-screen node (e.g. All)
  tpes: Array<{ id: string; label: string; tag: string }>; // a tag-hierarchy node per TPE
  markets: Array<{ id: string; label: string; tpe: string; tag: string }>; // leaves, ranked on
}
export function cutTaxonomy(m: Manifest = loadManifest()): CutTaxonomy {
  // The root = the hierarchy node with no parent (the broad early-screen tag, 'All').
  const rootEntry = Object.entries(m.market_hierarchy).find(([, n]) => n.parent == null);
  const root = { tag: rootEntry?.[0] ?? 'All', label: rootEntry?.[1].label ?? 'All markets' };
  // TPE nodes = hierarchy nodes that carry a tpe (their key is the trial tag).
  const tpes = Object.entries(m.market_hierarchy)
    .filter(([, n]) => n.tpe)
    .map(([tag, n]) => ({ id: n.tpe as string, label: m.tpes[n.tpe as string]?.label ?? n.label, tag }));
  const tagForTpe = (tpe: string) => tpes.find((t) => t.id === tpe)?.tag ?? root.tag;
  const markets = Object.entries(m.markets).map(([id, d]) => ({ id, label: d.label, tpe: d.tpe, tag: tagForTpe(d.tpe) }));
  return { root, tpes, markets };
}

/** The canonical cuts the corpus ships: each market × {prediction-broad, advancement-narrow}. */
export function listCuts(m: Manifest = loadManifest()): Cut[] {
  const cuts: Cut[] = [];
  for (const [market, def] of Object.entries(m.markets)) {
    cuts.push({
      id: `predict-${market.toLowerCase()}`, purpose: 'prediction', market,
      market_label: def.label, tpe: def.tpe, label: `Prediction · ${def.label}`,
      blurb: 'Broad training cut: every trial relevant to this market across all stages and years.',
    });
    cuts.push({
      id: `advance-${market.toLowerCase()}`, purpose: 'advancement', market,
      market_label: def.label, tpe: def.tpe, label: `Advancement · ${def.label}`,
      blurb: 'Narrow decision cut: the latest-stage trials for this market — the advance/drop set.',
    });
  }
  return cuts;
}

export function cutById(id: string, m: Manifest = loadManifest()): Cut | null {
  return listCuts(m).find((c) => c.id === id) ?? null;
}

/** Which trials belong to a cut, by the tag rule (no per-trial selection by the breeder). */
export function trialsForCut(cut: Cut, m: Manifest = loadManifest()): TrialMeta[] {
  const tag = m.markets[cut.market].tag; // the market's node (e.g. 'Processing')
  if (cut.purpose === 'prediction') {
    // relevance = the TPE: this node or any ancestor (so 'All'-tagged early trials are included).
    const keep = new Set(ancestors(tag, m.market_hierarchy));
    return m.trials.filter((t) => keep.has(t.market_tag));
  }
  // advancement = the latest stage present for this exact node (the focused decision set).
  const own = m.trials.filter((t) => t.market_tag === tag);
  if (own.length === 0) return [];
  const latest = own.reduce((a, b) => (STAGE_ORDER.indexOf(b.stage) > STAGE_ORDER.indexOf(a.stage) ? b : a)).stage;
  const atLatest = own.filter((t) => t.stage === latest);
  const yr = Math.max(...atLatest.map((t) => t.year));
  return atLatest.filter((t) => t.year === yr);
}

export interface AssembledCut {
  cut: Cut;
  traits: string[];
  weights: Record<string, number>;
  trials: TrialMeta[];
  /** Generic plot records for the fit engine; environments are namespaced by trial so distinct
   *  trials never pool (shared genotypes/checks still connect them). */
  records: Array<{ genotype: string; environment: string; values: Array<number | null> }>;
  germplasm: string[]; // derived membership: lines that appear in this cut
  composition: {
    n_trials: number; n_env: number; n_geno: number; n_obs: number;
    n_checks: number; stages: string[]; years: number[];
  };
}

const isCheck = (g: string) => g.startsWith('CHK-');

/** Read a trial CSV into generic records aligned to the trait order. */
function readTrial(t: TrialMeta, traits: string[]): Array<{ genotype: string; environment: string; values: Array<number | null> }> {
  const rows = parse(readFileSync(join(tomatoCorpusDir(), t.file)), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  return rows.map((r) => ({
    genotype: r.genotype,
    environment: `${t.trial_id}/${r.env}`, // namespace: keep distinct trials from merging into one env
    values: traits.map((tr) => { const v = r[tr]; return v == null || v === '' || v === 'NA' ? null : Number(v); }),
  }));
}

/** Assemble an explicit set of trials into a cut bundle input (pooled records + composition). */
function assembleTrials(cut: Cut, trials: TrialMeta[], m: Manifest): AssembledCut {
  const traits = m.traits;
  const records = trials.flatMap((t) => readTrial(t, traits));
  const germplasm = [...new Set(records.map((r) => r.genotype))];
  return {
    cut, traits, weights: m.markets[cut.market].weights, trials, records, germplasm,
    composition: {
      n_trials: trials.length,
      n_env: new Set(records.map((r) => r.environment)).size,
      n_geno: germplasm.length,
      n_obs: records.length,
      n_checks: germplasm.filter(isCheck).length,
      stages: [...new Set(trials.map((t) => t.stage))].sort(),
      years: [...new Set(trials.map((t) => t.year))].sort(),
    },
  };
}

/** Assemble a canonical cut: its trials (by the tag rule), records, derived germplasm + composition. */
export function assembleCut(cut: Cut, m: Manifest = loadManifest()): AssembledCut {
  return assembleTrials(cut, trialsForCut(cut, m), m);
}

/** Definition of a breeder-defined (saved) cut: a name, the market to rank on, and the exact trials. */
export interface CutDef { id: string; name: string; market: string; trialIds: string[] }

/** Assemble a custom cut from a hand-picked trial list (the saved-preset path). */
export function assembleCustom(def: CutDef, m: Manifest = loadManifest()): AssembledCut {
  const d = m.markets[def.market];
  if (!d) throw new Error(`unknown market: ${def.market}`);
  const trials = def.trialIds.map((id) => m.trials.find((t) => t.trial_id === id)).filter((t): t is TrialMeta => !!t);
  if (trials.length === 0) throw new Error('a cut must include at least one trial');
  // "broad" (a prediction-style pool) vs "narrow" follows the SELECTION, not a label: spanning >1 stage
  // means it pools the funnel. The bundle's intent/warnings key off this downstream.
  const multiStage = new Set(trials.map((t) => t.stage)).size > 1;
  const cut: Cut = {
    id: def.id, purpose: multiStage ? 'prediction' : 'advancement', market: def.market, market_label: d.label,
    tpe: d.tpe, label: def.name, blurb: 'Breeder-defined cut — the trials you picked.', custom: true,
  };
  return assembleTrials(cut, trials, m);
}

/** The full trial catalog (for the "see all the data" view) — every trial, untouched by any cut. */
export function trialCatalog(m: Manifest = loadManifest()): TrialMeta[] {
  return [...m.trials].sort((a, b) =>
    a.year - b.year || STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.trial_id.localeCompare(b.trial_id));
}
