import type { GeminiCandidate } from "../ai/gemini";
import type { QuoteProvider } from "../market/types";
import type { RiskLimits, TradeRequest } from "../trading/types";
import { evaluateExecutionGate } from "../trading/gate";
import { runStrategyScan } from "./runtime";

export interface AutomationConfig {
  gemini: GeminiCandidate[];
  strategy: Parameters<typeof runStrategyScan>[0]["strategy"];
  zeroExApiKey: string;
  takerAddress: `0x${string}`;
  cashToken: `0x${string}`;
  quoteAmountWei: bigint;
  slippageBps: number;
  risk: RiskLimits;
  allowQuoteBalanceIssues?: boolean;
  heldPositions?: Record<string, string>;
}

export interface AutomationResult {
  discovered: number;
  opportunities: Awaited<ReturnType<typeof runStrategyScan>>["opportunities"];
  trade?: TradeRequest;
  blockedReason?: string;
}

function rejectionSummary(discovered: number, opportunities: AutomationResult["opportunities"]): string {
  if (opportunities.length === 0) {
    return `No low-cap meme setup passed the deterministic scanner (meme markets discovered: ${discovered}). Jarvis requires a meme-token identity, $10k-$250k liquidity, active low-cap volume, fresh price data, non-extended momentum, and a minimum scanner score.`;
  }

  const top = opportunities.slice(0, 5).map((item) => {
    const geminiDetail = `Gemini ${item.decision.decision} confidence=${item.decision.confidence.toFixed(2)} risk=${item.decision.risk}: ${item.decision.reason}`;
    const reason = item.rejectionReason ? `${item.rejectionReason} ${geminiDetail}` : geminiDetail;
    return `${item.market.symbol} score=${item.scannerScore}: ${reason}`;
  }).join(" | ");
  return `No executable low-cap meme opportunity found (discovered ${discovered}). ${top}`;
}

function jsonSafeTrade(trade: TradeRequest): TradeRequest {
  return Object.assign(trade, {
    toJSON() {
      return {
        tokenIn: trade.tokenIn,
        tokenOut: trade.tokenOut,
        amountInWei: trade.amountInWei.toString(),
        amountOutWei: trade.amountOutWei.toString(),
        slippageBps: trade.slippageBps,
        reason: trade.reason
      };
    }
  }) as TradeRequest;
}

export async function evaluateAutomation(config: AutomationConfig): Promise<AutomationResult> {
  const result = await runStrategyScan({
    gemini: config.gemini,
    strategy: { ...config.strategy, heldPositions: config.heldPositions, allowQuoteBalanceIssues: config.allowQuoteBalanceIssues ?? config.strategy.allowQuoteBalanceIssues },
    zeroExApiKey: config.zeroExApiKey,
    takerAddress: config.takerAddress,
    limit: Math.min(Math.max(config.strategy.maxCandidates, 30), 50)
  });

  const best = result.opportunities.find((item) => item.executable);
  if (!best) return { discovered: result.discovered, opportunities: result.opportunities, blockedReason: rejectionSummary(result.discovered, result.opportunities) };

  const decision = best.decision;
  const amountInWei = best.quoteAmountInWei ?? 0n;
  const gateError = evaluateExecutionGate({ decision, amountInWei, currentExposureWei: 0n, cashToken: config.cashToken }, config.risk);
  if (gateError) return { discovered: result.discovered, opportunities: result.opportunities, blockedReason: gateError };

  const trade: TradeRequest = jsonSafeTrade({
    tokenIn: decision.decision === "BUY" ? config.cashToken : best.market.address,
    tokenOut: decision.decision === "BUY" ? best.market.address : config.cashToken,
    amountInWei,
    amountOutWei: best.quoteAmountOutWei ?? 0n,
    slippageBps: config.slippageBps,
    reason: `strategy:${decision.decision.toLowerCase()} score=${best.scannerScore} confidence=${decision.confidence.toFixed(2)} ${decision.reason}`
  });

  return { discovered: result.discovered, opportunities: result.opportunities, trade };
}

export function isPaperAutomationSafe(mode: "paper" | "live"): boolean {
  return mode === "paper";
}

export type { QuoteProvider };
