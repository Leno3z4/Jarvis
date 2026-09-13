import type { RiskLimits, TradingMode } from "./trading/types";

export interface Env {
  TRADING_MODE?: TradingMode;
  MAX_TRADE_WEI?: string;
  MAX_EXPOSURE_WEI?: string;
  PAPER_CASH_TOKEN?: `0x${string}`;
  PAPER_STARTING_CASH_WEI?: string;
  ZEROEX_API_KEY?: string;
  BASE_RPC_URL?: string;
  LIVE_WALLET_ADDRESS?: `0x${string}`;
  LIVE_PRIVATE_KEY?: `0x${string}`;
  LIVE_TRADING_ENABLED?: string;
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_FALLBACK_1?: string;
  GEMINI_API_KEY_FALLBACK_2?: string;
  GEMINI_MODEL?: string;
  GEMINI_MODEL_FALLBACK_1?: string;
  GEMINI_MODEL_FALLBACK_2?: string;
  BOT_STATE: DurableObjectNamespace;
}

export interface JarvisConfig {
  mode: TradingMode;
  risk: RiskLimits;
  paperCashToken: `0x${string}`;
  paperStartingCashWei: bigint;
  zeroExApiKey?: string;
  baseRpcUrl: string;
  liveWalletAddress?: `0x${string}`;
  livePrivateKey?: `0x${string}`;
  liveTradingEnabled: boolean;
  gemini: {
    primaryKey: string;
    fallback1Key: string;
    fallback2Key: string;
    primaryModel: string;
    fallback1Model: string;
    fallback2Model: string;
  };
}

const DEFAULT_PAPER_CASH_TOKEN = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";

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
    baseRpcUrl: env.BASE_RPC_URL ?? DEFAULT_BASE_RPC_URL,
    liveWalletAddress: env.LIVE_WALLET_ADDRESS,
    livePrivateKey: env.LIVE_PRIVATE_KEY,
    liveTradingEnabled: env.LIVE_TRADING_ENABLED === "true",
    gemini: {
      primaryKey: env.GEMINI_API_KEY ?? "",
      fallback1Key: env.GEMINI_API_KEY_FALLBACK_1 ?? "",
      fallback2Key: env.GEMINI_API_KEY_FALLBACK_2 ?? "",
      primaryModel: env.GEMINI_MODEL ?? "gemini-2.5-flash",
      fallback1Model: env.GEMINI_MODEL_FALLBACK_1 ?? "gemini-2.5-flash-lite",
      fallback2Model: env.GEMINI_MODEL_FALLBACK_2 ?? "gemini-3.1-flash-lite"
    }
  };
}
