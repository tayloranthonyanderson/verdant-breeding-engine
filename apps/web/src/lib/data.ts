// The web tier's read path: load the most recent persisted result straight from Postgres.
// The bundle is stored whole as JSONB (ADR-0001); we cast it to the contract type it was
// validated against on the way in.
import { desc, eq } from "drizzle-orm";
import { db, study, analysisRun, resultBundle, advancementDecision } from "@verdant/db";
import type { ResultBundle } from "@verdant/contracts";

export interface LoadedResult {
  study: typeof study.$inferSelect | null;
  run: typeof analysisRun.$inferSelect;
  bundle: ResultBundle;
  advancements: (typeof advancementDecision.$inferSelect)[];
}

/** The latest completed analysis + its bundle, or null if none has run yet. */
export async function getLatestResult(): Promise<LoadedResult | null> {
  const [rb] = await db
    .select()
    .from(resultBundle)
    .orderBy(desc(resultBundle.id))
    .limit(1);
  if (!rb) return null;

  const [run] = await db
    .select()
    .from(analysisRun)
    .where(eq(analysisRun.id, rb.analysisRunId));

  let s: typeof study.$inferSelect | null = null;
  if (run?.studyId != null) {
    [s] = await db.select().from(study).where(eq(study.id, run.studyId));
  }

  const advancements = await db
    .select()
    .from(advancementDecision)
    .where(eq(advancementDecision.analysisRunId, run.id))
    .orderBy(desc(advancementDecision.id));

  return { study: s ?? null, run, bundle: rb.bundle as ResultBundle, advancements };
}

/** The latest G2F MET analysis (the rich maize demo), regardless of any newer tomato cuts. */
export async function getG2fResult(): Promise<LoadedResult | null> {
  const [row] = await db
    .select({ bundle: resultBundle.bundle, run: analysisRun, s: study })
    .from(resultBundle)
    .innerJoin(analysisRun, eq(resultBundle.analysisRunId, analysisRun.id))
    .innerJoin(study, eq(analysisRun.studyId, study.id))
    .where(eq(study.source, "g2f"))
    .orderBy(desc(resultBundle.id))
    .limit(1);
  if (!row) return null;
  const advancements = await db
    .select().from(advancementDecision)
    .where(eq(advancementDecision.analysisRunId, row.run.id))
    .orderBy(desc(advancementDecision.id));
  return { study: row.s, run: row.run, bundle: row.bundle as ResultBundle, advancements };
}

/** The breeder's saved cut presets (studies with source='tomato-cut'), newest first, each with the
 *  scope recorded in its latest bundle. Powers the "your saved cuts" list. */
export interface SavedCut { id: string; name: string; market: string; market_label: string; trialIds: string[]; n_geno: number; stages: string[]; years: number[] }
export async function listSavedCuts(): Promise<SavedCut[]> {
  const studies = await db.select().from(study).where(eq(study.source, "tomato-cut")).orderBy(desc(study.id));
  const out: SavedCut[] = [];
  for (const s of studies) {
    const r = await getCutResult(s.name);
    const dr = r?.bundle.data_readiness as { cut?: { market?: string; market_label?: string; trial_ids?: string[]; stages?: string[]; years?: number[] }; scale?: { n_geno?: number } } | undefined;
    const c = dr?.cut;
    out.push({
      id: s.name, name: s.fieldLocation ?? s.name, market: c?.market ?? "", market_label: c?.market_label ?? "",
      trialIds: c?.trial_ids ?? [], n_geno: dr?.scale?.n_geno ?? 0, stages: c?.stages ?? [], years: c?.years ?? [],
    });
  }
  return out;
}

/** The latest analysis for a named data cut (a tomato study whose name === the cut id). The cut
 *  bundle carries its own data scope in data_readiness.cut, so this is "the analysis of this cut". */
export async function getCutResult(cutId: string): Promise<LoadedResult | null> {
  const [s] = await db.select().from(study).where(eq(study.name, cutId));
  if (!s) return null;
  const [row] = await db
    .select({ bundle: resultBundle.bundle, run: analysisRun })
    .from(resultBundle)
    .innerJoin(analysisRun, eq(resultBundle.analysisRunId, analysisRun.id))
    .where(eq(analysisRun.studyId, s.id))
    .orderBy(desc(resultBundle.id))
    .limit(1);
  if (!row) return null;
  return { study: s, run: row.run, bundle: row.bundle as ResultBundle, advancements: [] };
}
