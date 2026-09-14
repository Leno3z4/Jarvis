import type { TokenMarket } from "../market/types";

export interface StrategyConfig {
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  maxChange24hPct: number;
  minChange24hPct: number;
  minScore: number;
  lowCapMinLiquidityUsd?: number;
  lowCapMaxLiquidityUsd?: number;
  lowCapMinVolume24hUsd?: number;
  lowCapMinVolumeToLiquidity?: number;
}

export interface CandidateScore { market: TokenMarket; score: number; reasons: string[]; eligible: boolean; }

const DEFAULT_CONFIG: StrategyConfig = {
  minLiquidityUsd: 50_000,
  minVolume24hUsd: 10_000,
  maxChange24hPct: 50,
  minChange24hPct: 2,
  minScore: 60,
  lowCapMinLiquidityUsd: 10_000,
  lowCapMaxLiquidityUsd: 250_000,
  lowCapMinVolume24hUsd: 2_500,
  lowCapMinVolumeToLiquidity: 0.1
};

const NON_TARGET_SYMBOLS = new Set([
  "ETH", "WETH", "USDC", "USDT", "DAI", "USDBC", "USDE", "USDS",
  "CBUSD", "CBBTC", "CBETH", "WBTC", "BTC", "XBTC"
]);

function isNonTargetAsset(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  if (NON_TARGET_SYMBOLS.has(normalized)) return true;
  return /^(USD|USDC|USDT|DAI|EUR|GBP|JPY)[A-Z0-9]*$/.test(normalized);
}

export function scoreMarket(market: TokenMarket, config: StrategyConfig = DEFAULT_CONFIG): CandidateScore {
  const reasons: string[] = [];
  let score = 0;
  const lowCapMinLiquidity = config.lowCapMinLiquidityUsd ?? 10_000;
  const lowCapMaxLiquidity = config.lowCapMaxLiquidityUsd ?? 250_000;
  const lowCapMinVolume = config.lowCapMinVolume24hUsd ?? 2_500;
  const lowCapVolumeRatio = config.lowCapMinVolumeToLiquidity ?? 0.1;
  const nonTargetAsset = isNonTargetAsset(market.symbol);
  const isLowCapCandidate = market.liquidityUsd >= lowCapMinLiquidity
    && market.liquidityUsd <= lowCapMaxLiquidity
    && market.volume24hUsd >= lowCapMinVolume
    && market.liquidityUsd > 0
    && market.volume24hUsd / market.liquidityUsd >= lowCapVolumeRatio;

  if (nonTargetAsset) reasons.push("non-target settlement/blue-chip asset");

  if (market.dataCompleteness === "quote-only") {
    reasons.push("market data incomplete");
  } else {
    if (isLowCapCandidate) {
      score += 25;
      reasons.push("low-cap liquidity tier");
    } else {
      reasons.push("outside low-cap liquidity band");
    }

    if (market.volume24hUsd >= config.minVolume24hUsd) {
      score += 25;
      reasons.push("sufficient 24h volume");
    } else if (isLowCapCandidate && market.volume24hUsd >= lowCapMinVolume) {
      score += 15;
      reasons.push("active low-cap volume");
    } else {
      reasons.push("volume below low-cap floor");
    }

    if (market.change24hPct >= config.minChange24hPct && market.change24hPct <= config.maxChange24hPct) {
      score += 25;
      reasons.push("positive momentum");
    } else if (isLowCapCandidate && market.change24hPct >= 0 && market.change24hPct < config.minChange24hPct) {
      score += 10;
      reasons.push("early low-cap momentum");
    } else if (market.change24hPct < 0) {
      score -= 10;
      reasons.push("negative momentum");
    } else if (market.change24hPct > config.maxChange24hPct) {
      score -= 25;
      reasons.push("momentum too extended");
    }
  }

  const staleMs = Date.now() - market.observedAt;
  if (staleMs <= 60_000) { score += 10; reasons.push("fresh market data"); }
  else reasons.push("stale market data");

  const hasValidPrice = Number.isFinite(market.priceUsd) && market.priceUsd > 0;
  if (hasValidPrice) { score += 10; reasons.push("valid price"); }
  else reasons.push("price unavailable");

  if (market.volumeSpikeRatio !== undefined && market.volumeSpikeRatio >= 2) {
    score += 10;
    reasons.push("volume spike vs hourly baseline");
  }
  if (market.change6hPct !== undefined && market.change6hPct >= 3 && market.change6hPct <= 30) {
    score += 8;
    reasons.push("healthy 6h impulse");
  }
  if (market.change1hPct !== undefined && market.change1hPct >= 0.5 && market.change1hPct <= 12) {
    score += 5;
    reasons.push("positive short-term impulse");
  }
  if (market.nearRecentHighPct !== undefined && market.nearRecentHighPct >= 97) {
    score += 7;
    reasons.push("pressing recent high");
  }
  if (isLowCapCandidate) reasons.push("low-cap momentum candidate");

  // New entries stay low-cap-only, but Gemini should see the viable low-cap
  // universe instead of being blocked by multiple simultaneous momentum gates.
  // The deterministic layer handles hard market-data/safety constraints;
  // Gemini decides whether the candidate is actually worth buying.
  const lowCapEligible = market.dataCompleteness === "full"
    && !nonTargetAsset
    && isLowCapCandidate
    && hasValidPrice
    && staleMs <= 60_000
    && market.change24hPct <= config.maxChange24hPct
    && score >= 45;

  return { market, score, reasons, eligible: lowCapEligible };
}

export function scanMarkets(markets: TokenMarket[], config: StrategyConfig = DEFAULT_CONFIG): CandidateScore[] {
  return markets
    .map((market) => scoreMarket(market, config))
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => b.score - a.score);
}
