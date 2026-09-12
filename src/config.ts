import type { RiskLimits, TradingMode } from "./trading/types";

export interface Env {
  TRADING_MODE?: TradingMode;
  MAX_TRADE_WEI?: string;
  MAX_EXPOSURE_WEI?: string;
  PAPER_CASH_TOKEN?: `0x${string}`;
  PAPER_STARTING_CASH_WEI?: string;
  ZEROEX_API_KEY?: string;
  LIVE_WALLET_ADDRESS?: `0x${string}`;
  BOT_STATE: DurableObjectNamespace;
}

export interface JarvisConfig {
  mode: TradingMode;
  risk: RiskLimits;
  paperCashToken: `0x${string}`;
  paperStartingCashWei: bigint;
  zeroExApiKey?: string;
  liveWalletAddress?: `0x${string}`;
}

const DEFAULT_PAPER_CASH_TOKEN = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export function getConfig(env: Env): JarvisConfig {
  const mode = env.TRADING_MODE === "live" ? "live" : "paper";
  return {
    mode,
    risk: {
      maxTradeWei: BigInt(env.MAX_TRADE_WEI ?? "100000000000000000"),
      maxPortfolioExposureWei: BigInt(env.MAX_EXPOSURE_WEI ?? "500000000000000000")
    },
    paperCashToken: env.PAPER_CASH_TOKEN ?? DEFAULT_PAPER_CASH_TOKEN,
    paperStartingCashWei: BigInt(env.PAPER_STARTING_CASH_WEI ?? "1000000000000000000"),
    zeroExApiKey: env.ZEROEX_API_KEY,
    liveWalletAddress: env.LIVE_WALLET_ADDRESS
  };
}
