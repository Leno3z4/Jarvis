import type { TradingMode, RiskLimits } from "./trading/types";

export interface Env {
  TRADING_MODE?: TradingMode;
  MAX_TRADE_WEI?: string;
  MAX_EXPOSURE_WEI?: string;
  BOT_STATE: DurableObjectNamespace;
}

export function getConfig(env: Env): { mode: TradingMode; risk: RiskLimits } {
  const mode = env.TRADING_MODE === "live" ? "live" : "paper";
  return {
    mode,
    risk: {
      maxTradeWei: BigInt(env.MAX_TRADE_WEI ?? "100000000000000000"),
      maxPortfolioExposureWei: BigInt(env.MAX_EXPOSURE_WEI ?? "500000000000000000")
    }
  };
}
