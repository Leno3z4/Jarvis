import type { GeminiCandidate } from "../ai/gemini";
import type { TokenMarket, QuoteProvider } from "../market/types";
import { scanMarkets, type StrategyConfig, type CandidateScore } from "./engine";
import { analyzeCandidate, type StrategyDecision } from "./decision";

export interface StrategyLoopConfig extends StrategyConfig {
  maxCandidates: number;
  minGeminiConfidence: number;
  maxGeminiRisk: "LOW" | "MEDIUM" | "HIGH";
  cashToken: `0x${string}`;
  quoteAmountWei: bigint;
  slippageBps: number;
  allowQuoteBalanceIssues?: boolean;
  uniswapApiKey?: string;
  theGraphApiKey?: string;
  theGraphUniswapV3SubgraphId?: string;
  heldPositions?: Record<string, string>;
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
  const scanned = scanMarkets(markets, config);
  const heldCandidates: CandidateScore[] = markets
    .filter((market) => (config.heldPositions?.[market.address.toLowerCase()] ?? "0") !== "0")
    .map((market) => {
      const existing = scanned.find((candidate) => candidate.market.address.toLowerCase() === market.address.toLowerCase());
      return existing ?? { market, score: 100, reasons: ["existing position eligible for exit analysis"], eligible: true };
    });
  const byAddress = new Map<string, CandidateScore>();
  for (const candidate of [...heldCandidates, ...scanned]) byAddress.set(candidate.market.address.toLowerCase(), candidate);
  const candidates = [...byAddress.values()].slice(0, Math.max(1, config.maxCandidates));
  const results: StrategyOpportunity[] = [];

  for (const candidate of candidates) {
    const positionHeld = (config.heldPositions?.[candidate.market.address.toLowerCase()] ?? "0") !== "0";
    const analyzed = await analyzeCandidate(candidate, geminiCandidates, { positionHeld });
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
    const heldAmount = BigInt(config.heldPositions?.[candidate.market.address.toLowerCase()] ?? "0");
    const amountForQuote = decision.decision === "SELL" ? heldAmount : quoteAmountInWei;

    if (executable && quoteProvider && amountForQuote && amountForQuote > 0n && candidate.market.address.toLowerCase() !== config.cashToken.toLowerCase()) {
      try {
        const quote = await quoteProvider.getQuote({
          tokenIn: decision.decision === "BUY" ? config.cashToken : candidate.market.address,
          tokenOut: decision.decision === "BUY" ? candidate.market.address : config.cashToken,
          amountInWei: amountForQuote,
          slippageBps
        });

        if (quote.amountOutWei <= 0n) {
          executable = false;
          rejectionReason = "0x returned a zero output amount.";
        } else {
          quotedIn = quote.amountInWei;
          quotedOut = quote.amountOutWei;
        }
      } catch (error) {
        executable = false;
        rejectionReason = error instanceof Error
          ? `Execution quote rejected: ${error.message}`
          : "Execution quote rejected: unknown 0x error.";
      }
    } else if (executable && decision.decision === "SELL" && heldAmount <= 0n) {
      executable = false;
      rejectionReason = "Sell decision has no held position to close.";
    } else if (executable && (!quoteProvider || !amountForQuote)) {
      executable = false;
      rejectionReason = "Execution quote is not configured.";
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
