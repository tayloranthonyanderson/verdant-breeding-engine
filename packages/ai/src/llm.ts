// Provider-abstracted LLM seam (ADR-0004): one `complete()` behind an interface so the rest of the
// product never imports a vendor SDK directly. Anthropic adapter, Claude Sonnet 4.6 default, adaptive
// thinking. Auth resolves from the environment (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN); when no
// credential is present, complete() returns null and the caller falls back to the offline answerer —
// so the feature works keyless in development and goes live the moment a key is dropped in.
//
// NOTE on auth: this needs an Anthropic *API* key (console.anthropic.com, pay-as-you-go). A Claude
// Code / Max *subscription* authenticates interactive Claude Code + claude.ai only; it is not an API
// key and must not be used to power this server.

export interface LlmResult {
  text: string;
  model: string;
}

export const DEFAULT_MODEL = "claude-sonnet-4-6";

/** True when an Anthropic API credential is available (so the live path can run). */
export function llmConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * One grounded completion. Returns null (not an error) when no credential is configured — the caller
 * treats null as "use the offline answerer". The SDK is imported dynamically so the package builds and
 * the offline path runs even when @anthropic-ai/sdk is not yet installed.
 */
export async function complete(system: string, user: string): Promise<LlmResult | null> {
  if (!llmConfigured()) return null;
  const model = process.env.VERDANT_LLM_MODEL || DEFAULT_MODEL;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;
  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from env
  const resp = await client.messages.create({
    model,
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = (resp.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
  return { text, model };
}
