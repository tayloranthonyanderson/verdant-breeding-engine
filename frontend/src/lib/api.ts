import type { Bundle, AssistantResponse, TrialRow } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function jsonOrThrow(r: Response) {
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  return r.json();
}

export type DemoData = {
  data: TrialRow[];
  traits: string[];
  genotype: string;
  env: string;
  block: string;
};

export async function getDemoData(): Promise<DemoData> {
  return jsonOrThrow(await fetch(`${BASE}/demo-data`, { cache: "no-store" }));
}

export type AnalyzePayload = {
  data: TrialRow[];
  traits: string[];
  genotype?: string;
  env?: string;
  block?: string;
  engine?: string;
  genotype_effect?: string;
};

export async function analyze(payload: AnalyzePayload): Promise<Bundle> {
  return jsonOrThrow(
    await fetch(`${BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

export async function askAssistant(
  bundle: Bundle,
  message: string
): Promise<AssistantResponse> {
  return jsonOrThrow(
    await fetch(`${BASE}/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle, message }),
    })
  );
}
