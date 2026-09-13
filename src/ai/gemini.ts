export type GeminiRole = "primary" | "fallback1" | "fallback2";

export interface GeminiCandidate {
  role: GeminiRole;
  apiKey: string;
  model: string;
}

export interface GeminiRequest {
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  generationConfig?: Record<string, unknown>;
}

export interface GeminiResponse {
  text: string;
  role: GeminiRole;
  model: string;
}

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function isQuotaOrTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function callGemini(candidate: GeminiCandidate, request: GeminiRequest): Promise<GeminiResponse> {
  const response = await fetch(
    `${API_BASE}/${encodeURIComponent(candidate.model)}:generateContent?key=${encodeURIComponent(candidate.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    }
  );

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Gemini ${candidate.role} failed (${response.status}): ${body.slice(0, 500)}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();

  if (!text) throw new Error(`Gemini ${candidate.role} returned no text.`);
  return { text, role: candidate.role, model: candidate.model };
}

export async function generateWithFallbacks(
  candidates: GeminiCandidate[],
  request: GeminiRequest
): Promise<GeminiResponse> {
  const usable = candidates.filter((candidate) => candidate.apiKey && candidate.model);
  if (usable.length === 0) throw new Error("No Gemini API keys/models are configured.");

  const errors: string[] = [];

  for (const candidate of usable.slice(0, 3)) {
    try {
      return await callGemini(candidate, request);
    } catch (error) {
      const status = error instanceof Error && "status" in error ? Number((error as Error & { status?: number }).status) : 0;
      const message = error instanceof Error ? error.message : "Unknown Gemini error.";
      errors.push(message);

      if (!isQuotaOrTransientStatus(status)) throw error;
    }
  }

  throw new Error(`All Gemini fallbacks exhausted. ${errors.join(" | ")}`);
}
