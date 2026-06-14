// Provider-abstracted LLM seam (ADR-0004): one `complete()` behind an interface so the rest of the
// product never imports a vendor SDK directly. Two adapters today —
//   • Anthropic / Claude Sonnet 4.6 (the production default; official SDK, adaptive thinking)
//   • Google Gemini (a free-tier adapter for interim development; raw REST, no extra dependency)
// — selected by which credential is present (Anthropic wins when both are), overridable with
// VERDANT_LLM_PROVIDER. When no credential is configured, complete() returns null and the caller
// falls back to the offline answerer, so the feature works keyless and goes live on a key drop.
//
// GOVERNANCE (ADR-0004): the prompt includes the bundle digest. A FREE-TIER third-party endpoint may
// use submitted data for model improvement — fine for PUBLIC demo data (G2F), NOT for proprietary
// breeder data. Route real customer data through a paid/production provider only.
//
// AUTH NOTE: the Anthropic adapter needs an Anthropic *API* key (console.anthropic.com). A Claude
// Code / Max *subscription* is not an API key and must not power this server.

export interface LlmResult {
  text: string;
  model: string;
}

export const DEFAULT_MODEL = "claude-sonnet-4-6"; // Anthropic (production default)
export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"; // Gemini free-tier (interim dev)

type Provider = "anthropic" | "gemini" | null;

function selectedProvider(): Provider {
  const forced = (process.env.VERDANT_LLM_PROVIDER || "").toLowerCase();
  const hasAnthropic = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const hasGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (forced === "anthropic") return hasAnthropic ? "anthropic" : null;
  if (forced === "gemini") return hasGemini ? "gemini" : null;
  // Default preference: Anthropic (production) when keyed, else Gemini (interim free), else offline.
  if (hasAnthropic) return "anthropic";
  if (hasGemini) return "gemini";
  return null;
}

/** True when some LLM credential is available (so the live path can run). */
export function llmConfigured(): boolean {
  return selectedProvider() !== null;
}

/** One grounded completion via the selected provider. Returns null (not an error) when no credential
 *  is configured — the caller treats null as "use the offline answerer". */
export async function complete(system: string, user: string): Promise<LlmResult | null> {
  const provider = selectedProvider();
  if (provider === "anthropic") return completeAnthropic(system, user);
  if (provider === "gemini") return completeGemini(system, user);
  return null;
}

// --- Anthropic / Claude (production default) ---------------------------------------------------
// Official SDK, imported dynamically so the package builds and the offline/Gemini paths run even when
// @anthropic-ai/sdk is not installed.
async function completeAnthropic(system: string, user: string): Promise<LlmResult> {
  const model = process.env.VERDANT_LLM_MODEL || DEFAULT_MODEL;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;
  // Pin to the public API: ignore any ambient ANTHROPIC_BASE_URL (e.g. a Claude Code gateway) so the
  // user's API key routes to api.anthropic.com. Override deliberately with VERDANT_ANTHROPIC_BASE_URL.
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.VERDANT_ANTHROPIC_BASE_URL || "https://api.anthropic.com",
  });
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

// --- Google Gemini (free-tier, interim dev) ----------------------------------------------------
// Raw REST (generativelanguage.googleapis.com); key sent in the x-goog-api-key header (not the URL).
async function completeGemini(system: string, user: string): Promise<LlmResult> {
  const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) as string;
  const model = process.env.VERDANT_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
    }),
  });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    modelVersion?: string;
  };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  return { text, model: data.modelVersion || model };
}
