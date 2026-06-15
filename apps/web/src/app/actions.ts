"use server";
// The synchronous re-run seam (ADR-0018). A Server Action so the Model Studio button can apply
// breeder overrides and refresh the page without a client fetch layer; revalidatePath re-reads the
// freshly persisted bundle (page is force-dynamic). The kernel (Rscript/Docker) runs server-only —
// runMetAnalysis is never imported into a client module. The durable job queue (ADR-0001) is the
// production answer; this sync action is the sanctioned bridge, with scope-aware recompute
// (relationship-only re-points GEBVs in seconds; a structural change refits in minutes).
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db, analysisRun, resultBundle, study, advancementDecision } from "@verdant/db";
import { runMetAnalysis, runTomatoCut, buildCustomCut, type ModelOverrides } from "@verdant/pipeline";
import type { AnalysisRequest } from "@verdant/contracts";
import { answer, type Answer } from "@verdant/ai";
import { getLatestResult, getCutResult } from "@/lib/data";

// Turn a preset name into a stable, url-safe cut id (re-saving the same name re-runs the same preset).
function cutSlug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `cut-${s || "untitled"}`;
}

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

// --- Grounded Q&A (ADR-0002/0004) — ask the freshest analysis a question; the AI explains the
// bundle and may state only numbers present in it (evals/groundedness). The LLM call runs server-only.
export type AskResult = { status: "ok"; answer: Answer } | { status: "error"; error: string };
export async function askResults(question: string, cutId?: string): Promise<AskResult> {
  try {
    const q = (question ?? "").trim();
    if (!q) return { status: "error", error: "Ask a question about the results." };
    // Answer against the cut currently being viewed (its own data scope), else the latest analysis.
    const result = cutId ? await getCutResult(cutId) : await getLatestResult();
    if (!result) return { status: "error", error: "No analysis available yet." };
    return { status: "ok", answer: await answer(q, result.bundle) };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}

// Re-run the analysis for a built-in template cut LIVE (assemble → multi-trait AI-REML → persist),
// then revalidate so the page re-reads it. "Running the analysis on this cut" made literal (ADR-0023).
export async function analyzeCut(cutId: string): Promise<{ status: "ok" | "error"; error?: string }> {
  try {
    await runTomatoCut(cutId, { persist: true });
    revalidatePath("/");
    return { status: "ok" };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}

// Save + run a BREEDER-DEFINED cut: the breeder picked the market and the exact trials; we fit them and
// persist a re-runnable preset (a study, source='tomato-cut'). Re-saving the same name re-runs it.
export async function saveAndRunCut(input: { name: string; trialIds: string[] }): Promise<{ status: "ok"; cutId: string } | { status: "error"; error: string }> {
  try {
    const name = (input.name ?? "").trim();
    if (!name) return { status: "error", error: "Name your data cut so you can find it later." };
    if (!input.trialIds?.length) return { status: "error", error: "Pick at least one trial for the cut." };
    const id = cutSlug(name);
    // Markets are derived from the trials (the cut is ranked under each at Select time).
    await buildCustomCut({ id, name, trialIds: input.trialIds });
    revalidatePath("/");
    return { status: "ok", cutId: id };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}

// Delete a saved preset (its study + runs + bundles). Built-in templates aren't deletable here.
export async function deleteCut(cutId: string): Promise<{ status: "ok" | "error"; error?: string }> {
  try {
    const [s] = await db.select().from(study).where(and(eq(study.name, cutId), eq(study.source, "tomato-cut")));
    if (!s) return { status: "error", error: "Saved cut not found." };
    const runs = await db.select({ id: analysisRun.id }).from(analysisRun).where(eq(analysisRun.studyId, s.id));
    const runIds = runs.map((r) => r.id);
    if (runIds.length) {
      await db.delete(resultBundle).where(inArray(resultBundle.analysisRunId, runIds));
      await db.delete(analysisRun).where(inArray(analysisRun.id, runIds));
    }
    await db.delete(study).where(eq(study.id, s.id));
    revalidatePath("/");
    return { status: "ok" };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}

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

// Raw-data SELECTION re-run (ADR-0021): apply the breeder's exclusion overlay and refit. The data
// sibling of rerunWithOverrides — dropping a site/plot/entry re-plans the model (decision-C). Stored
// data is never touched; each re-run is a new immutable analysis, so with/without is a comparison.
export async function rerunWithDataOverrides(input: {
  dataOverrides: AnalysisRequest["data_overrides"];
}): Promise<RerunResult & { excluded?: number }> {
  try {
    const { bundle } = await runMetAnalysis({ dataOverrides: input.dataOverrides, scope: "full" });
    revalidatePath("/");
    return {
      status: "ok",
      relationship: bundle.chosen_model.relationship,
      excluded: input.dataOverrides?.exclusions?.length ?? 0,
    };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}
