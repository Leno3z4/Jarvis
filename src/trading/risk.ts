import type { RiskLimits, TradeRequest } from "./types";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function validateTrade(request: TradeRequest, limits: RiskLimits): string | null {
  if (!ADDRESS_RE.test(request.tokenIn) || !ADDRESS_RE.test(request.tokenOut)) {
    return "tokenIn and tokenOut must be valid EVM addresses.";
  }
  if (request.tokenIn.toLowerCase() === request.tokenOut.toLowerCase()) {
    return "tokenIn and tokenOut must be different.";
  }
  if (request.amountInWei <= 0n || request.amountOutWei <= 0n) {
    return "Trade amounts must be positive.";
  }
  if (request.amountInWei > limits.maxTradeWei) {
    return "Trade exceeds max trade size.";
  }
  if (request.slippageBps < 1 || request.slippageBps > 500) {
    return "Slippage must be between 1 and 500 bps.";
  }
  return null;
}
