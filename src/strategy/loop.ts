import type { GeminiCandidate } from "../ai/gemini";
import type { QuoteProvider, TokenMarket } from "../market/types";
import { scanMarkets, type StrategyConfig } from "./engine";
import { analyzeCandidate, type StrategyDecision } from "./decision";

export interface StrategyLoopConfig extends StrategyConfig {
  maxCandidates: number;
  minGeminiConfidence: number;
  maxGeminiRisk: "LOW" | "MEDIUM" | "HIGH";
}

export interface StrategyOpportunity {
  market: TokenMarket;
  scannerScore: number;
  scannerReasons: string[];
  decision: StrategyDecision;
  quoteAmountInWei?: bigint;
  quoteAmountOutWei?: bigint;
  provider?: { role: string; model: string };
  executable: boolean;
  rejectionReason?: string;
}

const riskRank = { LOW: 1, MEDIUM: 2, HIGH: 3 } as const;

export async function evaluateMarkets(
  markets: TokenMarket[],
  geminiCandidates: GeminiCandidate[],
  config: StrategyLoopConfig,
  quoteProvider?: QuoteProvider,
  quoteAmountInWei?: bigint,
  slippageBps = 100
): Promise<StrategyOpportunity[]> {
  const candidates = scanMarkets(markets, config).slice(0, Math.max(1, config.maxCandidates));
  const results: StrategyOpportunity[] = [];

  for (const candidate of candidates) {
    const analyzed = await analyzeCandidate(candidate, geminiCandidates);
    const decision = analyzed.decision;
    let executable = decision.decision === "BUY" || decision.decision === "SELL";
    let rejectionReason: string | undefined;

    if (decision.confidence < config.minGeminiConfidence) {
      executable = false;
      rejectionReason = "Gemini confidence below execution threshold.";
    } else if (riskRank[decision.risk] > riskRank[config.maxGeminiRisk]) {
      executable = false;
      rejectionReason = "Gemini risk above configured threshold.";
    }

    let quotedIn: bigint | undefined;
    let quotedOut: bigint | undefined;

    if (executable && quoteProvider && quoteAmountInWei) {
      const quote = await quoteProvider.getQuote({
        tokenIn: candidate.market.address,
        tokenOut: candidate.market.address,
        amountInWei: quoteAmountInWei,
        slippageBps
      }).catch(() => null);

      if (!quote || quote.amountOutWei <= 0n) {
        executable = false;
        rejectionReason = "No valid execution quote available.";
      } else {
        quotedIn = quote.amountInWei;
        quotedOut = quote.amountOutWei;
      }
    }

    results.push({
      market: candidate.market,
      scannerScore: candidate.score,
      scannerReasons: candidate.reasons,
      decision,
      quoteAmountInWei: quotedIn,
      quoteAmountOutWei: quotedOut,
      provider: analyzed.provider,
      executable,
      rejectionReason
    });
  }

  return results.sort((a, b) => Number(b.executable) - Number(a.executable) || b.scannerScore - a.scannerScore);
}
