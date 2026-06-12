"use server";
// The synchronous re-run seam (ADR-0018). A Server Action so the Model Studio button can apply
// breeder overrides and refresh the page without a client fetch layer; revalidatePath re-reads the
// freshly persisted bundle (page is force-dynamic). The kernel (Rscript/Docker) runs server-only —
// runMetAnalysis is never imported into a client module. The durable job queue (ADR-0001) is the
// production answer; this sync action is the sanctioned bridge, with scope-aware recompute
// (relationship-only re-points GEBVs in seconds; a structural change refits in minutes).
import { revalidatePath } from "next/cache";
import { runMetAnalysis, type ModelOverrides } from "@verdant/pipeline";

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
