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
    return `No low-cap opportunities passed the deterministic scanner (low-cap markets discovered: ${discovered}). The current entry filter requires $10k-$250k liquidity, >=$2.5k 24h volume, >=1.15x hourly volume expansion, fresh data, non-negative 24h momentum, and a short-term breakout/momentum trigger.`;
  }

  const top = opportunities.slice(0, 5).map((item) => {
    const geminiDetail = `Gemini ${item.decision.decision} confidence=${item.decision.confidence.toFixed(2)} risk=${item.decision.risk}: ${item.decision.reason}`;
    const reason = item.rejectionReason ? `${item.rejectionReason} ${geminiDetail}` : geminiDetail;
    return `${item.market.symbol} score=${item.scannerScore}: ${reason}`;
  }).join(" | ");
  return `No executable low-cap opportunity found (discovered ${discovered}). ${top}`;
}

export async function evaluateAutomation(config: AutomationConfig): Promise<AutomationResult> {
  const result = await runStrategyScan({
    gemini: config.gemini,
    strategy: { ...config.strategy, heldPositions: config.heldPositions },
    zeroExApiKey: config.zeroExApiKey,
    takerAddress: config.takerAddress,
    allowQuoteBalanceIssues: config.allowQuoteBalanceIssues,
    // Discover a broad low-cap universe first. The deterministic scanner still
    // caps the number of candidates passed to Gemini at strategy.maxCandidates.
    limit: Math.min(Math.max(config.strategy.maxCandidates, 30), 50)
  });

  const best = result.opportunities.find((item) => item.executable);
  if (!best) return { discovered: result.discovered, opportunities: result.opportunities, blockedReason: rejectionSummary(result.discovered, result.opportunities) };

  const decision = best.decision;
  const amountInWei = best.quoteAmountInWei ?? 0n;
  const gateError = evaluateExecutionGate({ decision, amountInWei, currentExposureWei: 0n, cashToken: config.cashToken }, config.risk);
  if (gateError) return { discovered: result.discovered, opportunities: result.opportunities, blockedReason: gateError };

  const trade: TradeRequest = {
    tokenIn: decision.decision === "BUY" ? config.cashToken : best.market.address,
    tokenOut: decision.decision === "BUY" ? best.market.address : config.cashToken,
    amountInWei,
    amountOutWei: best.quoteAmountOutWei ?? 0n,
    slippageBps: config.slippageBps,
    reason: `strategy:${decision.decision.toLowerCase()} score=${best.scannerScore} confidence=${decision.confidence.toFixed(2)} ${decision.reason}`
  };

  return { discovered: result.discovered, opportunities: result.opportunities, trade };
}

export function isPaperAutomationSafe(mode: "paper" | "live"): boolean {
  return mode === "paper";
}

export type { QuoteProvider };
