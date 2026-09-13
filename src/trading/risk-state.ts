import { dayKeyUtc, evaluateRisk } from "./risk";
import type { RiskLimits, RiskState, TradeRequest } from "./types";

export interface RiskStateStore {
  getRiskState(): RiskState;
  checkTrade(trade: TradeRequest, cashToken: `0x${string}`, limits: RiskLimits, currentExposureWei: bigint, tokenExposureWei: bigint, openPositions: number): ReturnType<typeof evaluateRisk>;
  recordTrade(trade: TradeRequest): void;
  setKillSwitch(enabled: boolean): void;
}

export function normalizeRiskState(raw: Partial<RiskState> | null | undefined, realizedPnlWei: bigint): RiskState {
  const day = dayKeyUtc();
  if (!raw || raw.dayKey !== day) {
    return { killSwitch: raw?.killSwitch ?? false, dayKey: day, dailyLossWei: 0n, dailyTrades: 0, lastTradeAtByToken: {} };
  }
  return {
    killSwitch: Boolean(raw.killSwitch),
    dayKey: day,
    dailyLossWei: raw.dailyLossWei ?? (realizedPnlWei < 0n ? -realizedPnlWei : 0n),
    dailyTrades: raw.dailyTrades ?? 0,
    lastTradeAtByToken: raw.lastTradeAtByToken ?? {}
  };
}
