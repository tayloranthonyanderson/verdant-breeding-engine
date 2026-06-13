// Combining-ability driver (ADR-0019/0020), UNIFIED. Combining ability is a FACET of the one trial
// analysis, not a separate analysis: `computeCombiningAbility` runs the GCA/SCA fit and returns the
// `combining_ability` section, and `buildCombinedAnalysis` attaches it to the trial's existing hybrid
// bundle (chosen_model / indices / genetic_correlations / genomic) so the web tier renders ONE analysis
// with a Hybrids/Parents level switch. The phenotypic+genomic fit is heavy (BLUPF90/Docker); we reuse
// the latest persisted hybrid bundle rather than re-running it, and `runMetAnalysis` attaches CA itself
// so Model Studio re-runs stay unified.
import { desc, eq } from 'drizzle-orm';
import { db, pool as pgPool, program, study, analysisRun, resultBundle, inbredLine } from '@verdant/db';
import { validateResultBundle, type ResultBundle, type AnalysisRequest } from '@verdant/contracts';
import { parseG2fMet, parseG2fHybrids } from './g2f';
import { runRKernel } from './kernel';
import { metFixture } from './paths';
import { isEntrypoint } from './entry';

const PROG = 'G2F (public dev data)';
const FIXTURE = metFixture();

// CA fits on the SAME trait set as the hybrid analysis so the Hybrids/Parents levels are comparable and
// the GCA genetic lens spans all traits; the default GCA index weights mirror the hybrid objective.
const CA_TRAITS = ['Plant_Height_cm', 'Ear_Height_cm', 'Yield_Mg_ha', 'Grain_Moisture'];
const DEFAULT_OBJECTIVE = {
  index_weights: [
    { variable_id: 'Yield_Mg_ha', mode: 'max' as const, weight: 0.4 },
    { variable_id: 'Grain_Moisture', mode: 'min' as const, weight: 0.25 },
    { variable_id: 'Plant_Height_cm', mode: 'max' as const, weight: 0.2 },
    { variable_id: 'Ear_Height_cm', mode: 'min' as const, weight: 0.15 },
  ],
  // native-trait gate from directly-observed inbred data (dual-source gate, ADR-0020).
  gates: [{ variable_id: 'nctlb_resistant', operator: '>=' as const, threshold: 1 }],
};

export interface CombiningAbility {
  topology: { kind: string; n_lines: number; n_testers: number; eff_testers: number; n_crosses: number; tester_effect: string; sca_included: boolean; pools: Array<{ pool: string; n: number }>; decisions: Array<{ factor: string; choice: string; reason: string; diagnostic?: unknown }> };
  diagnostics: { degree: { min: number; median: number; max: number; distribution: Record<string, number> }; connectivity: { components: number; connected: boolean }; replication: { replicated_crosses: number; total_crosses: number } };
  traits: Array<{ variable_id: string; varcomp: Array<{ component: string; variance: number }>; genetic_sd: number | null; baker_ratio: number | null }>;
  gca_genetic_correlations: { variable_ids: string[]; matrix: number[][] };
  index_traits: string[];
  gca: Array<{ line: string; pool: string; cross_degree: { n_testers: number; n_plots: number }; per_se: number | null; nclb_resistant: number | null; values: Record<string, number | null> }>;
  pool_rankings: Array<{ pool: string; n: number; ranking: Array<{ line: string; pool: string; score: number; rank: number; gated_out: boolean; gate_failures: string[] }> }>;
  hybrids: Array<{ hybrid: string; line: string; tester: string; pool: string; n_plots: number; rank: number; score: number; observed: Record<string, number | null>; line_gca: Record<string, number | null> }>;
  sca: Array<{ line: string; tester: string; value: number }>;
  divergence: { compared: string[]; rank_correlation: number | null; notable_movers: Array<{ line: string; pool: string; rank_delta: number; per_se: number; gca_score: number }> };
}

/** Run the GCA/SCA fit and return the combining_ability section. Reuses the MET fixture (parentage +
 *  plot phenotypes) + the synthetic inbred-line facts (pool / per-se / native trait) from the DB. */
export async function computeCombiningAbility(opts: { traits?: string[] } = {}): Promise<CombiningAbility> {
  const traits = opts.traits?.length ? opts.traits.filter((t) => CA_TRAITS.includes(t)) : CA_TRAITS;
  await db.insert(program).values({ name: PROG }).onConflictDoNothing();
  const [prog] = await db.select().from(program).where(eq(program.name, PROG));
  const inbreds = await db.select().from(inbredLine).where(eq(inbredLine.programId, prog.id));
  if (inbreds.length === 0) throw new Error('inbred_line not seeded — run seed-inbred.ts first');

  const { records } = parseG2fMet(FIXTURE, traits);
  const hyb = parseG2fHybrids(FIXTURE, traits);
  const parentsOf = new Map(hyb.map((h) => [h.genotype, { p1: h.parent1, p2: h.parent2 }]));

  const objective = {
    index_weights: DEFAULT_OBJECTIVE.index_weights.filter((w) => traits.includes(w.variable_id)),
    gates: DEFAULT_OBJECTIVE.gates,
  };
  const payload = {
    traits,
    tester_fixed_max: 8,
    plot: {
      genotype: records.map((r) => r.genotype),
      parent1: records.map((r) => parentsOf.get(r.genotype)?.p1 ?? null),
      parent2: records.map((r) => parentsOf.get(r.genotype)?.p2 ?? null),
      environment: records.map((r) => r.environment),
      row: records.map((r) => r.row),
      col: records.map((r) => r.col),
      values: Object.fromEntries(traits.map((t, j) => [t, records.map((r) => r.values[j])])),
    },
    inbred: {
      name: inbreds.map((i) => i.name), role: inbreds.map((i) => i.role), pool: inbreds.map((i) => i.pool),
      per_se: inbreds.map((i) => i.perSeValue), nclb: inbreds.map((i) => i.nctlbResistant),
    },
    objective,
  };
  return runRKernel<{ combining_ability: CombiningAbility }>('combining-ability.R', payload, { transport: 'cfg-file', maxBuffer: 1 << 28 }).combining_ability;
}

/** The latest persisted bundle that carries the rich HYBRID analysis (model decisions + genomic +
 *  genetic correlations) — the trial analysis we attach combining ability onto. */
async function latestHybridBundle(): Promise<{ bundle: ResultBundle; studyId: number | null; programId: number } | null> {
  const rows = await db.select().from(resultBundle).orderBy(desc(resultBundle.id)).limit(40);
  for (const rb of rows) {
    const b = rb.bundle as ResultBundle & { genetic_correlations?: unknown; genomic?: unknown };
    if (b.genetic_correlations || b.genomic) {
      const [run] = await db.select().from(analysisRun).where(eq(analysisRun.id, rb.analysisRunId));
      return { bundle: b as ResultBundle, studyId: run?.studyId ?? null, programId: run?.programId ?? 0 };
    }
  }
  return null;
}

/** Attach the combining-ability facet to an existing hybrid bundle → one unified analysis bundle. */
export function attachCombiningAbility(hybrid: ResultBundle, ca: CombiningAbility): ResultBundle {
  const note = { code: 'synthetic_inbred_data', message: 'Combining-ability inbred facts (heterotic pool, per-se value, NCLB native trait) are SYNTHETIC scaffolding (ADR-0020) — G2F gives parent identity only. Real tomato inbred data replaces them.', severity: 'info' as const };
  return {
    ...hybrid,
    combining_ability: ca as unknown as ResultBundle['combining_ability'],
    warnings: [...(hybrid.warnings ?? []).filter((w) => w.code !== 'synthetic_inbred_data'), note],
  };
}

/** Build + persist the unified trial analysis (hybrid bundle + combining-ability facet). */
export async function buildCombinedAnalysis(opts: { persist?: boolean } = {}): Promise<{ bundle: ResultBundle; analysisRunId: number | null }> {
  const persist = opts.persist ?? true;
  const base = await latestHybridBundle();
  if (!base) throw new Error('no hybrid analysis bundle found — run the MET analysis first (pnpm --filter @verdant/pipeline exec tsx src/met-build.ts)');
  const traits = base.bundle.traits.map((t) => t.variable_id);
  console.log(`attaching combining ability to the hybrid bundle (${traits.length} traits, relationship=${base.bundle.chosen_model.relationship}) …`);
  const ca = await computeCombiningAbility({ traits });
  console.log(`  topology=${ca.topology.kind} lines=${ca.topology.n_lines} pools=${ca.topology.pools.map((p) => `${p.pool}:${p.n}`).join(' ')}`);
  const bundle = validateResultBundle(attachCombiningAbility(base.bundle, ca));

  let analysisRunId: number | null = null;
  if (persist) {
    await db.insert(program).values({ name: PROG }).onConflictDoNothing();
    const [prog] = await db.select().from(program).where(eq(program.name, PROG));
    await db.insert(study).values({ programId: prog.id, name: 'MET_2019', fieldLocation: '8-env MET', year: 2019, source: 'g2f' }).onConflictDoNothing();
    const [s] = await db.select().from(study).where(eq(study.name, 'MET_2019'));
    const request: AnalysisRequest = {
      contract_version: 'v0', analysis_request_id: 'met-2019-combined', intent: 'selection',
      variables: traits.map((id) => ({ variable_id: id, name: id, data_type: 'numeric' as const })) as AnalysisRequest['variables'],
      observation_units: [{ observation_unit_id: 'combined', germplasm_id: 'g' }] as AnalysisRequest['observation_units'],
      observations: [], relationship: { type: (base.bundle.chosen_model.relationship ?? 'identity') as 'identity' | 'A' | 'G' | 'H' },
    };
    const [run] = await db.insert(analysisRun).values({ programId: prog.id, studyId: s.id, intent: 'selection', status: 'ok', contractVersion: 'v0', request, finishedAt: new Date() }).returning({ id: analysisRun.id });
    await db.insert(resultBundle).values({ analysisRunId: run.id, contractVersion: 'v0', bundle });
    analysisRunId = run.id;
    console.log(`persisted unified analysis bundle (analysis_run=${analysisRunId})`);
  }
  return { bundle, analysisRunId };
}

if (isEntrypoint(import.meta.url)) {
  buildCombinedAnalysis().then(async () => { await pgPool.end(); }).catch(async (e) => { console.error(e); await pgPool.end(); process.exit(1); });
}
