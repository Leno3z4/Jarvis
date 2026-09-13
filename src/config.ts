import type { RiskLimits, TradingMode } from "./trading/types";

export interface Env {
  TRADING_MODE?: TradingMode;
  MAX_TRADE_WEI?: string;
  MAX_EXPOSURE_WEI?: string;
  MAX_TOKEN_EXPOSURE_WEI?: string;
  MAX_OPEN_POSITIONS?: string;
  MAX_TRADES_PER_DAY?: string;
  TRADE_COOLDOWN_SECONDS?: string;
  MAX_DAILY_LOSS_WEI?: string;
  PAPER_CASH_TOKEN?: `0x${string}`;
  PAPER_STARTING_CASH_WEI?: string;
  PAPER_TAKER_ADDRESS?: `0x${string}`;
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
  STRATEGY_MIN_LIQUIDITY_USD?: string;
  STRATEGY_MIN_VOLUME_USD?: string;
  STRATEGY_MIN_CHANGE_PCT?: string;
  STRATEGY_MAX_CHANGE_PCT?: string;
  STRATEGY_MIN_SCORE?: string;
  STRATEGY_MAX_CANDIDATES?: string;
  STRATEGY_MIN_CONFIDENCE?: string;
  STRATEGY_MAX_RISK?: "LOW" | "MEDIUM" | "HIGH";
  STRATEGY_QUOTE_AMOUNT_WEI?: string;
  STRATEGY_SLIPPAGE_BPS?: string;
  BOT_STATE: DurableObjectNamespace;
}

export interface JarvisConfig {
  mode: TradingMode;
  risk: RiskLimits;
  paperCashToken: `0x${string}`;
  paperStartingCashWei: bigint;
  paperTakerAddress?: `0x${string}`;
  zeroExApiKey?: string;
  baseRpcUrl: string;
  liveWalletAddress?: `0x${string}`;
  livePrivateKey?: `0x${string}`;
  liveTradingEnabled: boolean;
  gemini: {
    primaryKey: string; fallback1Key: string; fallback2Key: string;
    primaryModel: string; fallback1Model: string; fallback2Model: string;
  };
  strategy: {
    minLiquidityUsd: number; minVolume24hUsd: number; minChange24hPct: number; maxChange24hPct: number;
    minScore: number; maxCandidates: number; minGeminiConfidence: number; maxGeminiRisk: "LOW" | "MEDIUM" | "HIGH";
    quoteAmountWei: bigint; slippageBps: number;
  };
}

const DEFAULT_PAPER_CASH_TOKEN = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
const numberEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback;
};
const intEnv = (value: string | undefined, fallback: number): number => Math.max(0, Math.floor(numberEnv(value, fallback)));

export function getConfig(env: Env): JarvisConfig {
  const mode = env.TRADING_MODE === "live" ? "live" : "paper";
  return {
    mode,
    risk: {
      maxTradeWei: BigInt(env.MAX_TRADE_WEI ?? "100000000000000000"),
      maxPortfolioExposureWei: BigInt(env.MAX_EXPOSURE_WEI ?? "500000000000000000"),
      maxTokenExposureWei: BigInt(env.MAX_TOKEN_EXPOSURE_WEI ?? "200000000000000000"),
      maxOpenPositions: Math.max(1, intEnv(env.MAX_OPEN_POSITIONS, 5)),
      maxTradesPerDay: Math.max(1, intEnv(env.MAX_TRADES_PER_DAY, 24)),
      cooldownSeconds: intEnv(env.TRADE_COOLDOWN_SECONDS, 900),
      maxDailyLossWei: BigInt(env.MAX_DAILY_LOSS_WEI ?? "100000000000000000")
    },
    paperCashToken: env.PAPER_CASH_TOKEN ?? DEFAULT_PAPER_CASH_TOKEN,
    paperStartingCashWei: BigInt(env.PAPER_STARTING_CASH_WEI ?? "1000000000000000000"),
    paperTakerAddress: env.PAPER_TAKER_ADDRESS,
    zeroExApiKey: env.ZEROEX_API_KEY,
    baseRpcUrl: env.BASE_RPC_URL ?? DEFAULT_BASE_RPC_URL,
    liveWalletAddress: env.LIVE_WALLET_ADDRESS,
    livePrivateKey: env.LIVE_PRIVATE_KEY,
    liveTradingEnabled: env.LIVE_TRADING_ENABLED === "true",
    gemini: {
      primaryKey: env.GEMINI_API_KEY ?? "", fallback1Key: env.GEMINI_API_KEY_FALLBACK_1 ?? "", fallback2Key: env.GEMINI_API_KEY_FALLBACK_2 ?? "",
      primaryModel: env.GEMINI_MODEL ?? "gemini-2.5-flash", fallback1Model: env.GEMINI_MODEL_FALLBACK_1 ?? "gemini-2.5-flash", fallback2Model: env.GEMINI_MODEL_FALLBACK_2 ?? "gemini-3.1-flash-lite"
    },
    strategy: {
      minLiquidityUsd: numberEnv(env.STRATEGY_MIN_LIQUIDITY_USD, 50_000), minVolume24hUsd: numberEnv(env.STRATEGY_MIN_VOLUME_USD, 10_000),
      minChange24hPct: numberEnv(env.STRATEGY_MIN_CHANGE_PCT, 2), maxChange24hPct: numberEnv(env.STRATEGY_MAX_CHANGE_PCT, 50),
      minScore: numberEnv(env.STRATEGY_MIN_SCORE, 60), maxCandidates: Math.max(1, intEnv(env.STRATEGY_MAX_CANDIDATES, 5)),
      minGeminiConfidence: numberEnv(env.STRATEGY_MIN_CONFIDENCE, 0.70), maxGeminiRisk: env.STRATEGY_MAX_RISK ?? "MEDIUM",
      quoteAmountWei: BigInt(env.STRATEGY_QUOTE_AMOUNT_WEI ?? "10000000000000000"),
      slippageBps: Math.max(1, Math.min(500, intEnv(env.STRATEGY_SLIPPAGE_BPS, 100)))
    }
  };
}
