import { generateWithFallbacks, type GeminiCandidate } from "./gemini";
import type { CandidateScore } from "../strategy/engine";

export type TradingDecisionAction = "BUY" | "SELL" | "HOLD" | "SKIP";

export interface TradingDecision {
  action: TradingDecisionAction;
  confidence: number;
  risk: "LOW" | "MEDIUM" | "HIGH";
  rationale: string;
  maxPositionPct: number;
}

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["BUY", "SELL", "HOLD", "SKIP"] },
    confidence: { type: "number" },
    risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    rationale: { type: "string" },
    maxPositionPct: { type: "number" }
  },
  required: ["action", "confidence", "risk", "rationale", "maxPositionPct"]
};

function parseDecision(text: string): TradingDecision {
  const value = JSON.parse(text) as Partial<TradingDecision>;
  if (!value || typeof value !== "object") throw new Error("Gemini returned an invalid decision.");
  if (!["BUY", "SELL", "HOLD", "SKIP"].includes(value.action ?? "")) throw new Error("Invalid Gemini action.");
  if (!["LOW", "MEDIUM", "HIGH"].includes(value.risk ?? "")) throw new Error("Invalid Gemini risk.");
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    throw new Error("Gemini confidence must be between 0 and 1.");
  }
  if (typeof value.maxPositionPct !== "number" || value.maxPositionPct < 0 || value.maxPositionPct > 100) {
    throw new Error("Gemini position percentage must be between 0 and 100.");
  }
  if (typeof value.rationale !== "string" || value.rationale.length === 0) {
    throw new Error("Gemini rationale is required.");
  }

  return value as TradingDecision;
}

export async function getTradingDecision(
  candidates: GeminiCandidate[],
  candidate: CandidateScore,
  context: Record<string, unknown> = {}
): Promise<{ decision: TradingDecision; provider: string; model: string }> {
  const prompt = [
    "You are Jarvis, a conservative Base-chain meme-token trading analyst.",
    "Return only the requested JSON schema.",
    "Never invent market data. Treat supplied values as authoritative observations.",
    "Do not recommend leverage, borrowing, or bypassing risk controls.",
    "A BUY recommendation is only a recommendation; execution is handled separately by deterministic risk and execution code.",
    "Candidate:",
    JSON.stringify({
      token: candidate.market.address,
      symbol: candidate.market.symbol,
      priceUsd: candidate.market.priceUsd,
      liquidityUsd: candidate.market.liquidityUsd,
      volume24hUsd: candidate.market.volume24hUsd,
      change24hPct: candidate.market.change24hPct,
      score: candidate.score,
      reasons: candidate.reasons
    }),
    "Context:",
    JSON.stringify(context)
  ].join("\n");

  const result = await generateWithFallbacks(candidates, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: DECISION_SCHEMA
    }
  });

  return {
    decision: parseDecision(result.text),
    provider: result.role,
    model: result.model
  };
}
