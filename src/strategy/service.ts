import type { GeminiCandidate } from "../ai/gemini";
import { getTradingDecision, type TradingDecision } from "../ai/trading-decision";
import { scanMarkets, type CandidateScore, type StrategyConfig } from "./engine";
import type { TokenMarket } from "../market/types";

export interface StrategyEvaluation {
  candidates: CandidateScore[];
  decisions: Array<{
    candidate: CandidateScore;
    decision: TradingDecision;
    provider: string;
    model: string;
  }>;
}

export async function evaluateMarkets(
  markets: TokenMarket[],
  geminiCandidates: GeminiCandidate[],
  strategyConfig?: StrategyConfig,
  context: Record<string, unknown> = {}
): Promise<StrategyEvaluation> {
  const candidates = scanMarkets(markets, strategyConfig);
  const topCandidates = candidates.slice(0, 5);
  const decisions: StrategyEvaluation["decisions"] = [];

  for (const candidate of topCandidates) {
    const result = await getTradingDecision(geminiCandidates, candidate, context);
    decisions.push({ candidate, ...result });
  }

  return { candidates, decisions };
}
