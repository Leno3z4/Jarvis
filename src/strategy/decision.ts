import { generateWithFallbacks, type GeminiCandidate, type GeminiRequest } from "../ai/gemini";
import type { CandidateScore } from "./engine";

export type TradeDecision = "BUY" | "SELL" | "HOLD" | "SKIP";
export type DecisionRisk = "LOW" | "MEDIUM" | "HIGH";
export interface StrategyDecision { decision: TradeDecision; confidence: number; risk: DecisionRisk; reason: string; suggestedSizeBps: number; }
const allowedDecisions = new Set<TradeDecision>(["BUY", "SELL", "HOLD", "SKIP"]);
const allowedRisks = new Set<DecisionRisk>(["LOW", "MEDIUM", "HIGH"]);
function parseDecision(text: string): StrategyDecision {
  const raw = JSON.parse(text) as Partial<StrategyDecision>;
  if (!raw.decision || !allowedDecisions.has(raw.decision)) throw new Error("Gemini returned an invalid decision.");
  if (!raw.risk || !allowedRisks.has(raw.risk)) throw new Error("Gemini returned an invalid risk level.");
  if (!Number.isFinite(raw.confidence) || (raw.confidence as number) < 0 || (raw.confidence as number) > 1) throw new Error("Gemini returned an invalid confidence value.");
  if (!Number.isFinite(raw.suggestedSizeBps) || (raw.suggestedSizeBps as number) < 0 || (raw.suggestedSizeBps as number) > 10000) throw new Error("Gemini returned an invalid position size.");
  if (typeof raw.reason !== "string" || raw.reason.length < 3 || raw.reason.length > 1000) throw new Error("Gemini returned an invalid rationale.");
  return { decision: raw.decision, confidence: raw.confidence as number, risk: raw.risk, reason: raw.reason, suggestedSizeBps: raw.suggestedSizeBps as number };
}

export async function analyzeCandidate(candidate: CandidateScore, geminiCandidates: GeminiCandidate[], context: { positionHeld?: boolean } = {}): Promise<{ decision: StrategyDecision; provider: { role: string; model: string } }> {
  const market = candidate.market;
  const positionHeld = Boolean(context.positionHeld);
  const prompt = `You are Jarvis, a disciplined Base-chain meme-coin trading decision assistant. Analyze ONLY the supplied market snapshot. Do not invent facts or assume a token is safe. Treat unavailable fields as unavailable.

Position currently held: ${positionHeld ? "YES" : "NO"}

ENTRY setup: accumulation/consolidation followed by a breakout or reclaim of recent resistance, rising short-term momentum, and abnormal volume expansion. Prefer early liquid setups over already-parabolic moves. A low-cap candidate is a smaller-liquidity token, not a guaranteed low market-cap token; market cap is not supplied.

EXIT setup when Position currently held=YES: SELL when the supplied data shows a credible loss of the setup, such as failed breakout/reclaim, sharp 1h/6h momentum reversal, distribution or volume deterioration after a move, price becoming stretched near a recent high while short-term momentum fades, or other clear evidence that holding is no longer justified. HOLD when the position remains structurally healthy and no exit trigger is confirmed. Do not invent stop-loss or profit targets.

For BUY decisions, require a concrete trigger in the supplied data such as volume expansion plus positive short-term momentum and/or price pressing the recent high. Penalize extended 24h moves and weak liquidity. SKIP when liquidity/data quality/risk is poor.

Return JSON only with exactly these fields:
- decision: BUY | SELL | HOLD | SKIP
- confidence: number from 0 to 1
- risk: LOW | MEDIUM | HIGH
- reason: concise explanation
- suggestedSizeBps: integer from 0 to 10000

Market snapshot:
${JSON.stringify({
  address: market.address,
  symbol: market.symbol,
  decimals: market.decimals,
  priceUsd: market.priceUsd,
  liquidityUsd: market.liquidityUsd,
  volume24hUsd: market.volume24hUsd,
  volume1hUsd: market.volume1hUsd,
  avgHourlyVolumeUsd: market.avgHourlyVolumeUsd,
  volumeSpikeRatio: market.volumeSpikeRatio,
  change1hPct: market.change1hPct,
  change6hPct: market.change6hPct,
  change24hPct: market.change24hPct,
  nearRecentHighPct: market.nearRecentHighPct,
  dataCompleteness: market.dataCompleteness ?? "full",
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
  return { decision: parseDecision(response.text), provider: { role: response.role, model: response.model } };
}
