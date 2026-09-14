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
  LIVE_CASH_TOKEN?: `0x${string}`;
  PAPER_STARTING_CASH_WEI?: string;
  PAPER_TAKER_ADDRESS?: `0x${string}`;
  LIVE_DRY_RUN?: string;
  ZEROEX_API_KEY?: string;
  UNISWAP_API_KEY?: string;
  THE_GRAPH_API_KEY?: string;
  THE_GRAPH_UNISWAP_V3_SUBGRAPH_ID?: string;
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
  STRATEGY_LOW_CAP_MIN_LIQUIDITY_USD?: string;
  STRATEGY_LOW_CAP_MAX_LIQUIDITY_USD?: string;
  STRATEGY_LOW_CAP_MIN_VOLUME_USD?: string;
  STRATEGY_LOW_CAP_MIN_VOLUME_LIQUIDITY?: string;
  BOT_STATE: DurableObjectNamespace;
  RISK_STATE: DurableObjectNamespace;
  LIVE_STATE: DurableObjectNamespace;
}

export interface JarvisConfig {
  mode: TradingMode;
  risk: RiskLimits;
  paperCashToken: `0x${string}`;
  liveCashToken: `0x${string}`;
  paperStartingCashWei: bigint;
  paperTakerAddress?: `0x${string}`;
  liveDryRun: boolean;
  zeroExApiKey?: string;
  baseRpcUrl: string;
  liveWalletAddress?: `0x${string}`;
  livePrivateKey?: `0x${string}`;
  liveTradingEnabled: boolean;
  gemini: { primaryKey: string; fallback1Key: string; fallback2Key: string; primaryModel: string; fallback1Model: string; fallback2Model: string };
  strategy: {
    minLiquidityUsd: number; minVolume24hUsd: number; minChange24hPct: number; maxChange24hPct: number;
    minScore: number; maxCandidates: number; minGeminiConfidence: number; maxGeminiRisk: "LOW" | "MEDIUM" | "HIGH";
    quoteAmountWei: bigint; slippageBps: number; allowQuoteBalanceIssues: boolean;
    lowCapMinLiquidityUsd: number; lowCapMaxLiquidityUsd: number; lowCapMinVolume24hUsd: number; lowCapMinVolumeToLiquidity: number;
    uniswapApiKey?: string; theGraphApiKey?: string; theGraphApiKeySource: "env" | "process.env" | "missing"; theGraphUniswapV3SubgraphId?: string;
  };
}

const DEFAULT_PAPER_CASH_TOKEN = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
const DEFAULT_UNISWAP_V3_SUBGRAPH_ID = "GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz";
const numberEnv = (value: string | undefined, fallback: number): number => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const intEnv = (value: string | undefined, fallback: number): number => Math.max(0, Math.floor(numberEnv(value, fallback)));
function bigintEnv(value: string | undefined, fallback: bigint, name: string): bigint { if (value === undefined || value === "") return fallback; try { return BigInt(value); } catch { throw new Error(`Invalid ${name}: expected an integer string.`); } }
type ProcessLike = { env?: Record<string, string | undefined> };
function resolveSecret(env: Env, key: "THE_GRAPH_API_KEY"): { value?: string; source: "env" | "process.env" | "missing" } { const direct = env[key]; if (direct) return { value: direct, source: "env" }; const processValue = (globalThis as { process?: ProcessLike }).process?.env?.[key]; if (processValue) return { value: processValue, source: "process.env" }; return { source: "missing" }; }

export function getConfig(env: Env): JarvisConfig {
  const mode = env.TRADING_MODE === "live" ? "live" : "paper";
  const graphSecret = resolveSecret(env, "THE_GRAPH_API_KEY");
  const paperCashToken = env.PAPER_CASH_TOKEN ?? DEFAULT_PAPER_CASH_TOKEN;
  return {
    mode,
    risk: {
      maxTradeWei: bigintEnv(env.MAX_TRADE_WEI, 100000000000000000n, "MAX_TRADE_WEI"),
      maxPortfolioExposureWei: bigintEnv(env.MAX_EXPOSURE_WEI, 500000000000000000n, "MAX_EXPOSURE_WEI"),
      maxTokenExposureWei: bigintEnv(env.MAX_TOKEN_EXPOSURE_WEI, 200000000000000000n, "MAX_TOKEN_EXPOSURE_WEI"),
      maxOpenPositions: Math.max(1, intEnv(env.MAX_OPEN_POSITIONS, 5)), maxTradesPerDay: Math.max(1, intEnv(env.MAX_TRADES_PER_DAY, 24)), cooldownSeconds: intEnv(env.TRADE_COOLDOWN_SECONDS, 900), maxDailyLossWei: bigintEnv(env.MAX_DAILY_LOSS_WEI, 100000000000000000n, "MAX_DAILY_LOSS_WEI")
    },
    paperCashToken,
    liveCashToken: env.LIVE_CASH_TOKEN ?? paperCashToken,
    paperStartingCashWei: bigintEnv(env.PAPER_STARTING_CASH_WEI, 1000000000000000000n, "PAPER_STARTING_CASH_WEI"),
    paperTakerAddress: env.PAPER_TAKER_ADDRESS,
    liveDryRun: env.LIVE_DRY_RUN === "true",
    zeroExApiKey: env.ZEROEX_API_KEY, baseRpcUrl: env.BASE_RPC_URL ?? DEFAULT_BASE_RPC_URL,
    liveWalletAddress: env.LIVE_WALLET_ADDRESS, livePrivateKey: env.LIVE_PRIVATE_KEY, liveTradingEnabled: env.LIVE_TRADING_ENABLED === "true",
    gemini: {
      primaryKey: env.GEMINI_API_KEY ?? "", fallback1Key: env.GEMINI_API_KEY_FALLBACK_1 ?? "", fallback2Key: env.GEMINI_API_KEY_FALLBACK_2 ?? "",
      primaryModel: env.GEMINI_MODEL ?? "gemini-3.6-flash", fallback1Model: env.GEMINI_MODEL_FALLBACK_1 ?? "gemini-3.6-flash", fallback2Model: env.GEMINI_MODEL_FALLBACK_2 ?? "gemini-3.5-flash-lite"
    },
    strategy: {
      minLiquidityUsd: numberEnv(env.STRATEGY_MIN_LIQUIDITY_USD, 50_000), minVolume24hUsd: numberEnv(env.STRATEGY_MIN_VOLUME_USD, 10_000), minChange24hPct: numberEnv(env.STRATEGY_MIN_CHANGE_PCT, 2), maxChange24hPct: numberEnv(env.STRATEGY_MAX_CHANGE_PCT, 50), minScore: numberEnv(env.STRATEGY_MIN_SCORE, 60),
      maxCandidates: Math.max(1, intEnv(env.STRATEGY_MAX_CANDIDATES, 10)), minGeminiConfidence: numberEnv(env.STRATEGY_MIN_CONFIDENCE, 0.70), maxGeminiRisk: env.STRATEGY_MAX_RISK ?? "MEDIUM",
      quoteAmountWei: bigintEnv(env.STRATEGY_QUOTE_AMOUNT_WEI, 10000000000000000n, "STRATEGY_QUOTE_AMOUNT_WEI"), slippageBps: Math.max(1, Math.min(500, intEnv(env.STRATEGY_SLIPPAGE_BPS, 100))), allowQuoteBalanceIssues: mode === "paper",
      lowCapMinLiquidityUsd: numberEnv(env.STRATEGY_LOW_CAP_MIN_LIQUIDITY_USD, 10_000), lowCapMaxLiquidityUsd: numberEnv(env.STRATEGY_LOW_CAP_MAX_LIQUIDITY_USD, 250_000), lowCapMinVolume24hUsd: numberEnv(env.STRATEGY_LOW_CAP_MIN_VOLUME_USD, 2_500), lowCapMinVolumeToLiquidity: numberEnv(env.STRATEGY_LOW_CAP_MIN_VOLUME_LIQUIDITY, 0.10),
      uniswapApiKey: env.UNISWAP_API_KEY, theGraphApiKey: graphSecret.value, theGraphApiKeySource: graphSecret.source, theGraphUniswapV3SubgraphId: env.THE_GRAPH_UNISWAP_V3_SUBGRAPH_ID ?? DEFAULT_UNISWAP_V3_SUBGRAPH_ID
    }
  };
}
