"use server";
// The synchronous re-run seam (ADR-0018). A Server Action so the Model Studio button can apply
// breeder overrides and refresh the page without a client fetch layer; revalidatePath re-reads the
// freshly persisted bundle (page is force-dynamic). The kernel (Rscript/Docker) runs server-only —
// runMetAnalysis is never imported into a client module. The durable job queue (ADR-0001) is the
// production answer; this sync action is the sanctioned bridge, with scope-aware recompute
// (relationship-only re-points GEBVs in seconds; a structural change refits in minutes).
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db, analysisRun, advancementDecision } from "@verdant/db";
import { runMetAnalysis, type ModelOverrides } from "@verdant/pipeline";

// --- Advancement (DOMAIN-MODEL §4) — record/withdraw the staging move that closes analysis→select→
// advance. Persists to advancement_decision, scoped to the analysis it was made on; revalidates so the
// workspace re-reads. The capstone of the combining-ability arc (ADR-0020).
export interface AdvanceInput {
  analysisRunId: number;
  candidates: Array<{ candidate: string; unit: "inbred" | "hybrid"; pool?: string | null; disposition: string; rationale?: string }>;
}
export async function recordAdvancement(input: AdvanceInput): Promise<{ status: "ok" | "error"; error?: string }> {
  try {
    const [run] = await db.select().from(analysisRun).where(eq(analysisRun.id, input.analysisRunId));
    if (!run) return { status: "error", error: "analysis run not found" };
    for (const c of input.candidates) {
      await db
        .insert(advancementDecision)
        .values({ programId: run.programId, analysisRunId: input.analysisRunId, candidate: c.candidate, unit: c.unit, pool: c.pool ?? null, disposition: c.disposition, rationale: c.rationale ?? null, decidedBy: "breeder" })
        .onConflictDoUpdate({ target: [advancementDecision.analysisRunId, advancementDecision.candidate, advancementDecision.unit], set: { disposition: c.disposition, pool: c.pool ?? null, rationale: c.rationale ?? null } });
    }
    revalidatePath("/");
    return { status: "ok" };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}

export async function withdrawAdvancement(input: { analysisRunId: number; candidate: string; unit: "inbred" | "hybrid" }): Promise<{ status: "ok" | "error"; error?: string }> {
  try {
    await db
      .delete(advancementDecision)
      .where(and(eq(advancementDecision.analysisRunId, input.analysisRunId), eq(advancementDecision.candidate, input.candidate), eq(advancementDecision.unit, input.unit)));
    revalidatePath("/");
    return { status: "ok" };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}

// silence unused import lints when only some helpers are used by a given build
void inArray;

export interface Refusal {
  factor: string;
  recommended?: string | null;
  refused_reason?: string | null;
}
export interface RerunResult {
  status: "ok" | "refused" | "error";
  relationship?: string;
  refusals?: Refusal[];
  error?: string;
}

export async function rerunWithOverrides(input: {
  overrides: ModelOverrides;
  scope: "full" | "relationship_only";
}): Promise<RerunResult> {
  try {
    const { bundle } = await runMetAnalysis({ overrides: input.overrides, scope: input.scope });
    const refusals: Refusal[] = (bundle.chosen_model.decisions ?? [])
      .filter((d) => d.source === "overridden" && d.feasible === false)
      .map((d) => ({ factor: d.factor, recommended: d.recommended, refused_reason: d.refused_reason }));
    revalidatePath("/");
    return {
      status: refusals.length ? "refused" : "ok",
      relationship: bundle.chosen_model.relationship,
      refusals,
    };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}
