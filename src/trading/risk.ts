import type { RiskLimits, TradeRequest } from "./types";

export function validateTrade(request: TradeRequest, limits: RiskLimits): string | null {
  if (request.amountInWei <= 0n) return "Trade amount must be positive.";
  if (request.amountInWei > limits.maxTradeWei) return "Trade exceeds max trade size.";
  if (request.slippageBps < 1 || request.slippageBps > 500) {
    return "Slippage must be between 1 and 500 bps.";
  }
  return null;
}
