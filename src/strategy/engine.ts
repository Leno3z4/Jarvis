import type { TokenMarket } from "../market/types";

export interface StrategyConfig {
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  maxChange24hPct: number;
  minChange24hPct: number;
  minScore: number;
}

export interface CandidateScore {
  market: TokenMarket;
  score: number;
  reasons: string[];
  eligible: boolean;
}

const DEFAULT_CONFIG: StrategyConfig = {
  minLiquidityUsd: 50_000,
  minVolume24hUsd: 10_000,
  maxChange24hPct: 50,
  minChange24hPct: 2,
  minScore: 60
};

export function scoreMarket(market: TokenMarket, config: StrategyConfig = DEFAULT_CONFIG): CandidateScore {
  const reasons: string[] = [];
  let score = 0;

  if (market.liquidityUsd >= config.minLiquidityUsd) {
    score += 30;
    reasons.push("healthy liquidity");
  } else {
    reasons.push("liquidity below floor");
  }

  if (market.volume24hUsd >= config.minVolume24hUsd) {
    score += 25;
    reasons.push("sufficient 24h volume");
  } else {
    reasons.push("volume below floor");
  }

  if (market.change24hPct >= config.minChange24hPct && market.change24hPct <= config.maxChange24hPct) {
    score += 25;
    reasons.push("positive momentum");
  } else if (market.change24hPct < 0) {
    score -= 10;
    reasons.push("negative momentum");
  } else if (market.change24hPct > config.maxChange24hPct) {
    score -= 25;
    reasons.push("momentum too extended");
  }

  const staleMs = Date.now() - market.observedAt;
  if (staleMs <= 60_000) {
    score += 10;
    reasons.push("fresh market data");
  } else {
    reasons.push("stale market data");
  }

  if (Number.isFinite(market.priceUsd) && market.priceUsd > 0) {
    score += 10;
    reasons.push("valid price");
  } else {
    reasons.push("invalid price");
  }

  return {
    market,
    score,
    reasons,
    eligible: score >= config.minScore
  };
}

export function scanMarkets(markets: TokenMarket[], config: StrategyConfig = DEFAULT_CONFIG): CandidateScore[] {
  return markets
    .map((market) => scoreMarket(market, config))
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => b.score - a.score);
}
