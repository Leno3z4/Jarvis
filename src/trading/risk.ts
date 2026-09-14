import type { RiskLimits, RiskState, TradeRequest } from "./types";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface TradeContext {
  currentExposureWei: bigint;
  tokenExposureWei: bigint;
  openPositions: number;
  nowMs?: number;
}

export interface RiskCheckResult {
  ok: boolean;
  reason?: string;
}

export function validateTrade(request: TradeRequest, limits: RiskLimits, cashToken?: `0x${string}`): string | null {
  if (!ADDRESS_RE.test(request.tokenIn) || !ADDRESS_RE.test(request.tokenOut)) return "tokenIn and tokenOut must be valid EVM addresses.";
  if (request.tokenIn.toLowerCase() === request.tokenOut.toLowerCase()) return "tokenIn and tokenOut must be different.";
  if (request.amountInWei <= 0n || request.amountOutWei <= 0n) return "Trade amounts must be positive.";
  const isSell = cashToken !== undefined && request.tokenOut.toLowerCase() === cashToken.toLowerCase();
  const riskAmountWei = isSell ? request.amountOutWei : request.amountInWei;
  if (riskAmountWei > limits.maxTradeWei) return "Trade exceeds max trade size.";
  if (request.slippageBps < 1 || request.slippageBps > 500) return "Slippage must be between 1 and 500 bps.";
  return null;
}

export function evaluateRisk(
  request: TradeRequest,
  limits: RiskLimits,
  state: RiskState,
  context: TradeContext,
  cashToken: `0x${string}`
): RiskCheckResult {
  const basic = validateTrade(request, limits, cashToken);
  if (basic) return { ok: false, reason: basic };
  if (state.killSwitch) return { ok: false, reason: "Kill switch is active." };
  if (state.dailyLossWei >= limits.maxDailyLossWei) return { ok: false, reason: "Daily loss limit reached." };
  if (state.dailyTrades >= limits.maxTradesPerDay) return { ok: false, reason: "Daily trade limit reached." };

  const isBuy = request.tokenIn.toLowerCase() === cashToken.toLowerCase();
  const projectedExposure = isBuy
    ? context.currentExposureWei + request.amountInWei
    : context.currentExposureWei;
  const projectedTokenExposure = isBuy
    ? context.tokenExposureWei + request.amountInWei
    : context.tokenExposureWei;

  if (projectedExposure > limits.maxPortfolioExposureWei) return { ok: false, reason: "Portfolio exposure limit would be exceeded." };
  if (projectedTokenExposure > limits.maxTokenExposureWei) return { ok: false, reason: "Token exposure limit would be exceeded." };
  if (isBuy && context.openPositions >= limits.maxOpenPositions && context.tokenExposureWei === 0n) return { ok: false, reason: "Maximum open positions reached." };

  const token = (isBuy ? request.tokenOut : request.tokenIn).toLowerCase();
  const lastTradeAt = state.lastTradeAtByToken[token];
  if (lastTradeAt !== undefined) {
    const elapsed = ((context.nowMs ?? Date.now()) - lastTradeAt) / 1000;
    if (elapsed < limits.cooldownSeconds) return { ok: false, reason: `Token cooldown active for ${Math.ceil(limits.cooldownSeconds - elapsed)}s.` };
  }
  return { ok: true };
}

export function dayKeyUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
