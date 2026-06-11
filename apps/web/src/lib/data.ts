// The web tier's read path: load the most recent persisted result straight from Postgres.
// The bundle is stored whole as JSONB (ADR-0001); we cast it to the contract type it was
// validated against on the way in.
import { desc, eq } from "drizzle-orm";
import { db, study, analysisRun, resultBundle } from "@verdant/db";
import type { ResultBundle } from "@verdant/contracts";

export interface LoadedResult {
  study: typeof study.$inferSelect | null;
  run: typeof analysisRun.$inferSelect;
  bundle: ResultBundle;
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

  return { study: s ?? null, run, bundle: rb.bundle as ResultBundle };
}
