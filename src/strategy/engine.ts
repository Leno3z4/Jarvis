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
  lowCapMinVolume24hUsd: 1_500,
  lowCapMinVolumeToLiquidity: 0.04
};

const NON_TARGET_SYMBOLS = new Set([
  "ETH", "WETH", "STETH", "WSTETH", "RETH", "WEETH", "CBETH", "METH", "OETH",
  "FRXETH", "SFRXETH", "EETH", "WRSETH", "ANKRETH", "USDC", "USDT", "DAI", "USDBC", "USDE", "USDS",
  "CBUSD", "CBBTC", "WBTC", "BTC", "XBTC"
]);

const MEME_TERMS = [
  "pepe", "doge", "shib", "floki", "bonk", "brett", "mog", "wojak", "degen",
  "turbo", "toshi", "bobo", "andy", "ponke", "neiro", "mfer", "meme", "inu",
  "dog", "cat", "frog", "ape", "monkey", "penguin", "chad", "giga", "ladys",
  "normie", "keycat", "npc", "higher", "keyboard", "hamster", "goat", "panda",
  "bear", "bull", "duck", "mouse", "rat", "capy", "pug", "shit", "clown",
  "ski", "mochi", "bald", "tybg", "blob", "based", "aerobud", "wolf", "mister",
  "spx", "ninja", "chog", "doginme"
];

const NON_MEME_TERMS = [
  "wrapped", "staked", "restaked", "liquid staking", "yield", "vault", "index",
  "governance", "oracle", "exchange", "router", "bridge", "infrastructure", "synthetic",
  "stablecoin", "usd", "usdc", "usdt", "ethereum", "bitcoin", "chainlink", "aave", "uniswap",
  "compound", "lido", "rocket pool", "maker", "curve"
];

function isNonTargetAsset(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  if (NON_TARGET_SYMBOLS.has(normalized)) return true;
  if (/^(USD|USDC|USDT|DAI|EUR|GBP|JPY)[A-Z0-9]*$/.test(normalized)) return true;
  return normalized.includes("WSTETH")
    || normalized.includes("WEETH")
    || normalized.includes("STETH")
    || normalized.includes("RETH")
    || normalized.includes("CBETH")
    || normalized.includes("FRXETH")
    || normalized.includes("SFRXETH")
    || normalized.includes("WBTC")
    || normalized.includes("BTC");
}

function isMemeToken(market: TokenMarket): boolean {
  const text = `${market.name ?? ""} ${market.symbol}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (NON_MEME_TERMS.some((term) => text.includes(term))) return false;
  return MEME_TERMS.some((term) => text.includes(term));
}

export function scoreMarket(market: TokenMarket, config: StrategyConfig = DEFAULT_CONFIG): CandidateScore {
  const reasons: string[] = [];
  let score = 0;
  const lowCapMinLiquidity = config.lowCapMinLiquidityUsd ?? 10_000;
  const lowCapMaxLiquidity = config.lowCapMaxLiquidityUsd ?? 250_000;
  const lowCapMinVolume = config.lowCapMinVolume24hUsd ?? 1_500;
  const nonTargetAsset = isNonTargetAsset(market.symbol);
  const memeToken = isMemeToken(market);
  const isLowCapCandidate = market.liquidityUsd >= lowCapMinLiquidity
    && market.liquidityUsd <= lowCapMaxLiquidity
    && market.volume24hUsd >= lowCapMinVolume
    && market.liquidityUsd > 0;

  if (nonTargetAsset) reasons.push("non-target settlement/blue-chip asset");
  if (memeToken) { score += 20; reasons.push("meme-token identity"); }
  else reasons.push("not identified as a meme token");

  if (market.dataCompleteness === "quote-only") {
    reasons.push("market data incomplete");
  } else {
    if (isLowCapCandidate) { score += 25; reasons.push("low-cap liquidity tier"); }
    else reasons.push("outside low-cap liquidity band");

    if (market.volume24hUsd >= config.minVolume24hUsd) { score += 25; reasons.push("sufficient 24h volume"); }
    else if (isLowCapCandidate && market.volume24hUsd >= lowCapMinVolume) { score += 15; reasons.push("active low-cap volume"); }
    else reasons.push("volume below low-cap floor");

    if (market.change24hPct >= config.minChange24hPct && market.change24hPct <= config.maxChange24hPct) { score += 25; reasons.push("positive 24h momentum"); }
    else if (isLowCapCandidate && market.change24hPct >= 0 && market.change24hPct < config.minChange24hPct) { score += 10; reasons.push("early low-cap momentum"); }
    else if (market.change24hPct < 0) { score -= 10; reasons.push("negative 24h momentum"); }
    else if (market.change24hPct > config.maxChange24hPct) { score -= 25; reasons.push("momentum too extended"); }
  }

  const staleMs = Date.now() - market.observedAt;
  if (staleMs <= 60_000) { score += 10; reasons.push("fresh market data"); }
  else reasons.push("stale market data");

  const hasValidPrice = Number.isFinite(market.priceUsd) && market.priceUsd > 0;
  if (hasValidPrice) { score += 10; reasons.push("valid price"); }
  else reasons.push("price unavailable");

  if (market.volumeSpikeRatio !== undefined && market.volumeSpikeRatio >= 1.25) { score += 10; reasons.push("above-baseline hourly volume"); }
  if (market.volumeSpikeRatio !== undefined && market.volumeSpikeRatio >= 2) { score += 5; reasons.push("strong volume expansion"); }
  if (market.change6hPct !== undefined && market.change6hPct >= 2 && market.change6hPct <= 30) { score += 10; reasons.push("healthy 6h momentum"); }
  if (market.change1hPct !== undefined && market.change1hPct >= 0.3 && market.change1hPct <= 12) { score += 10; reasons.push("positive 1h momentum"); }
  if (market.change1hPct !== undefined && market.change1hPct >= -1 && market.change6hPct !== undefined && market.change6hPct >= 0) { score += 4; reasons.push("controlled short-term pullback"); }
  if (market.nearRecentHighPct !== undefined && market.nearRecentHighPct >= 97) { score += 7; reasons.push("pressing recent high"); }
  if (isLowCapCandidate) reasons.push("low-cap meme candidate");

  const lowCapEligible = market.dataCompleteness === "full"
    && !nonTargetAsset
    && memeToken
    && isLowCapCandidate
    && hasValidPrice
    && staleMs <= 60_000
    && market.change24hPct <= config.maxChange24hPct
    && score >= 35;

  return { market, score, reasons, eligible: lowCapEligible };
}

export function scanMarkets(markets: TokenMarket[], config: StrategyConfig = DEFAULT_CONFIG): CandidateScore[] {
  return markets.map((market) => scoreMarket(market, config)).filter((candidate) => candidate.eligible).sort((a, b) => b.score - a.score);
}
