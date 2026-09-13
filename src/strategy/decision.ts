import { generateWithFallbacks, type GeminiCandidate, type GeminiRequest } from "../ai/gemini";
import type { CandidateScore } from "./engine";

export type TradeDecision = "BUY" | "SELL" | "HOLD" | "SKIP";
export type DecisionRisk = "LOW" | "MEDIUM" | "HIGH";

export interface StrategyDecision {
  decision: TradeDecision;
  confidence: number;
  risk: DecisionRisk;
  reason: string;
  suggestedSizeBps: number;
}

const allowedDecisions = new Set<TradeDecision>(["BUY", "SELL", "HOLD", "SKIP"]);
const allowedRisks = new Set<DecisionRisk>(["LOW", "MEDIUM", "HIGH"]);

function parseDecision(text: string): StrategyDecision {
  const raw = JSON.parse(text) as Partial<StrategyDecision>;

  if (!raw.decision || !allowedDecisions.has(raw.decision)) throw new Error("Gemini returned an invalid decision.");
  if (!raw.risk || !allowedRisks.has(raw.risk)) throw new Error("Gemini returned an invalid risk level.");
  if (!Number.isFinite(raw.confidence) || (raw.confidence as number) < 0 || (raw.confidence as number) > 1) {
    throw new Error("Gemini returned an invalid confidence value.");
  }
  if (!Number.isFinite(raw.suggestedSizeBps) || (raw.suggestedSizeBps as number) < 0 || (raw.suggestedSizeBps as number) > 10000) {
    throw new Error("Gemini returned an invalid position size.");
  }
  if (typeof raw.reason !== "string" || raw.reason.length < 3 || raw.reason.length > 1000) {
    throw new Error("Gemini returned an invalid rationale.");
  }

  return {
    decision: raw.decision,
    confidence: raw.confidence as number,
    risk: raw.risk,
    reason: raw.reason,
    suggestedSizeBps: raw.suggestedSizeBps as number
  };
}

export async function analyzeCandidate(
  candidate: CandidateScore,
  geminiCandidates: GeminiCandidate[]
): Promise<{ decision: StrategyDecision; provider: { role: string; model: string } }> {
  const prompt = `You are Jarvis, a crypto trading decision assistant. Analyze ONLY the supplied market snapshot. Do not invent prices, liquidity, volume, momentum, news, or on-chain facts. Treat unavailable fields as unavailable. Never request calldata, wallet actions, or transaction parameters.

Return JSON only with exactly these fields:
- decision: BUY | SELL | HOLD | SKIP
- confidence: number from 0 to 1
- risk: LOW | MEDIUM | HIGH
- reason: concise explanation
- suggestedSizeBps: integer from 0 to 10000

Market snapshot:
${JSON.stringify({
  address: candidate.market.address,
  symbol: candidate.market.symbol,
  decimals: candidate.market.decimals,
  priceUsd: candidate.market.priceUsd,
  liquidityUsd: candidate.market.liquidityUsd,
  volume24hUsd: candidate.market.volume24hUsd,
  change24hPct: candidate.market.change24hPct,
  dataCompleteness: candidate.market.dataCompleteness ?? "full",
  scannerScore: candidate.score,
  scannerReasons: candidate.reasons
})}`;

  const request: GeminiRequest = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          decision: { type: "string", enum: ["BUY", "SELL", "HOLD", "SKIP"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
          reason: { type: "string" },
          suggestedSizeBps: { type: "integer", minimum: 0, maximum: 10000 }
        },
        required: ["decision", "confidence", "risk", "reason", "suggestedSizeBps"]
      }
    }
  };

  const response = await generateWithFallbacks(geminiCandidates, request);
  return {
    decision: parseDecision(response.text),
    provider: { role: response.role, model: response.model }
  };
}
