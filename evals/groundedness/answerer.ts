// VERDANT_ANSWERER for the groundedness gate. Wires the **deterministic offline** answerer (not the
// live LLM): the gate must be reproducible and free in CI, and a non-deterministic model can't be a
// hard pass/fail. This still exercises the real digest + answer logic the live path shares — so if a
// code change makes the answerer emit a number absent from the bundle, the gate goes red.
//
// Run via: pnpm test:evals  (which loads this under tsx and sets VERDANT_ANSWERER).
// Relative import (not @verdant/ai) so no workspace resolution is needed; the offline path pulls in
// only relative modules at runtime.
import { answerOffline } from "../../packages/ai/src/index";
import type { ResultBundle } from "../../packages/contracts/src/index";

export async function answer(question: string, bundle: ResultBundle): Promise<string> {
  return answerOffline(question, bundle);
}
