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
}

export interface AutomationResult {
  discovered: number;
  opportunities: Awaited<ReturnType<typeof runStrategyScan>>["opportunities"];
  trade?: TradeRequest;
  blockedReason?: string;
}

export async function evaluateAutomation(config: AutomationConfig): Promise<AutomationResult> {
  const result = await runStrategyScan({
    gemini: config.gemini,
    strategy: config.strategy,
    zeroExApiKey: config.zeroExApiKey,
    takerAddress: config.takerAddress,
    limit: config.strategy.maxCandidates * 6
  });

  const best = result.opportunities.find((item) => item.executable);
  if (!best) {
    return {
      discovered: result.discovered,
      opportunities: result.opportunities,
      blockedReason: result.opportunities[0]?.rejectionReason ?? "No executable opportunity found."
    };
  }

  const decision = best.decision;
  const amountInWei = best.quoteAmountInWei ?? 0n;
  const gateError = evaluateExecutionGate(
    {
      decision,
      amountInWei,
      currentExposureWei: 0n
    },
    config.risk
  );

  if (gateError) {
    return {
      discovered: result.discovered,
      opportunities: result.opportunities,
      blockedReason: gateError
    };
  }

  const trade: TradeRequest = {
    tokenIn: decision.decision === "BUY" ? config.cashToken : best.market.address,
    tokenOut: decision.decision === "BUY" ? best.market.address : config.cashToken,
    amountInWei,
    amountOutWei: best.quoteAmountOutWei ?? 0n,
    slippageBps: config.slippageBps,
    reason: `strategy:${decision.decision.toLowerCase()} score=${best.scannerScore} confidence=${decision.confidence.toFixed(2)}`
  };

  return {
    discovered: result.discovered,
    opportunities: result.opportunities,
    trade
  };
}

export function isPaperAutomationSafe(mode: "paper" | "live"): boolean {
  return mode === "paper";
}

export type { QuoteProvider };
