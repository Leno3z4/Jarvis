import type { MarketProvider, TokenMarket } from "./types";

const API_BASE = "https://api.dexscreener.com";
const BASE_NETWORK = "base";
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const NON_TARGET = new Set(["ETH","WETH","STETH","WSTETH","RETH","WEETH","CBETH","METH","OETH","FRXETH","SFRXETH","EETH","WRSETH","ANKRETH","WBTC","BTC","XBTC","USDC","USDT","DAI","USDBC","USDE","USDS","CBUSD"]);
const NON_MEME = ["wrapped","staked","restaked","liquid staking","yield","vault","index","governance","oracle","exchange","router","bridge","infrastructure","synthetic","stablecoin","ethereum","bitcoin","chainlink","aave","uniswap","compound","lido","rocket pool","maker","curve"];
const MEME = [
  "pepe","doge","shib","floki","bonk","brett","mog","wojak","degen","turbo","toshi","bobo","andy","ponke","neiro","mfer","meme","inu","dog","cat","frog","ape","monkey","penguin","chad","giga","ladys","normie","keycat","npc","higher","keyboard","hamster","goat","panda","bear","bull","duck","mouse","rat","capy","pug","shit","clown","based","blob","ninja","wolf","ski","mochi","bald","tybg","doginme","aerobud","spx","mister","harold","harambe","wojak","smurf","corgi","shark","seal","frog","banana","pizza","fish","trump","maga","elon","grok","kek","cult","degen","higher","chog","tate","simpsons"
];

interface DexPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string | null;
  liquidity?: { usd?: number | string | null; base?: number | string | null; quote?: number | string | null };
  volume?: Record<string, number | string>;
  priceChange?: Record<string, number | string> | null;
  fdv?: number | null;
  marketCap?: number | null;
  boosts?: { active?: number | null } | null;
}
interface DexResponse { pairs?: DexPair[] | null; }
interface Profile { chainId?: string; tokenAddress?: string; description?: string | null }

function isAddress(value: unknown): value is `0x${string}` { return typeof value === "string" && ADDRESS_RE.test(value); }
function num(value: unknown): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function text(name = "", symbol = "", description = ""): string { return `${name} ${symbol} ${description}`.toLowerCase().replace(/[^a-z0-9]+/g, " "); }
function excluded(name = "", symbol = "", description = ""): boolean { const upper = symbol.trim().toUpperCase(); if (NON_TARGET.has(upper)) return true; const t = text(name, symbol, description); return NON_MEME.some((term) => t.includes(term)); }
function meme(name = "", symbol = "", description = ""): boolean { const t = text(name, symbol, description); return !NON_MEME.some((term) => t.includes(term)) && MEME.some((term) => t.includes(term)); }

function marketFromPair(pair: DexPair, address: `0x${string}`): TokenMarket {
  const tokenIsBase = pair.baseToken?.address?.toLowerCase() === address.toLowerCase();
  const token = tokenIsBase ? pair.baseToken : pair.quoteToken;
  const priceUsd = num(pair.priceUsd);
  const liquidityUsd = num(pair.liquidity?.usd);
  const volume24hUsd = num(pair.volume?.h24);
  const volume1hUsd = num(pair.volume?.h1);
  const avgHourlyVolumeUsd = volume24hUsd / 24;
  const change1hPct = num(pair.priceChange?.h1);
  const change6hPct = num(pair.priceChange?.h6);
  const change24hPct = num(pair.priceChange?.h24);
  return {
    address,
    symbol: token?.symbol ?? token?.name ?? "UNKNOWN",
    name: token?.name ?? token?.symbol ?? "UNKNOWN",
    decimals: 18,
    priceUsd,
    liquidityUsd,
    volume24hUsd,
    change24hPct,
    observedAt: Date.now(),
    volume1hUsd,
    avgHourlyVolumeUsd,
    volumeSpikeRatio: avgHourlyVolumeUsd > 0 ? volume1hUsd / avgHourlyVolumeUsd : 0,
    change1hPct,
    change6hPct,
    // DexScreener does not provide a recent-high series here; leave this unset
    // rather than deriving a misleading "near recent high" signal from 1h change.
    dataCompleteness: priceUsd > 0 && liquidityUsd > 0 && volume24hUsd > 0 ? "full" : "liquidity-price-only"
  };
}

async function json<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    return await response.json() as T;
  } catch { return undefined; }
}

export class DexScreenerMarketProvider implements MarketProvider {
  async getToken(address: `0x${string}`): Promise<TokenMarket> {
    if (!isAddress(address)) throw new Error(`Invalid token address: ${address}`);
    const pairs = await json<DexPair[]>(`${API_BASE}/token-pairs/v1/${BASE_NETWORK}/${address}`);
    const basePairs = (pairs ?? []).filter((pair) => pair.chainId === BASE_NETWORK && num(pair.liquidity?.usd) > 0);
    if (basePairs.length === 0) throw new Error(`No Base market found for ${address}.`);
    const best = [...basePairs].sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))[0];
    return marketFromPair(best, address);
  }

  async getTokens(addresses: `0x${string}`[]): Promise<TokenMarket[]> {
    const unique = [...new Set(addresses.filter(isAddress).map((address) => address.toLowerCase()))].slice(0, 30);
    if (unique.length === 0) return [];
    const pairs = await json<DexPair[]>(`${API_BASE}/tokens/v1/${BASE_NETWORK}/${unique.join(",")}`) ?? [];
    const bestByToken = new Map<string, { market: TokenMarket; liquidity: number }>();
    for (const pair of pairs) {
      if (pair.chainId !== BASE_NETWORK) continue;
      const base = pair.baseToken?.address;
      const quote = pair.quoteToken?.address;
      const address = isAddress(base) && unique.includes(base.toLowerCase()) ? base : isAddress(quote) && unique.includes(quote.toLowerCase()) ? quote : undefined;
      if (!address) continue;
      const market = marketFromPair(pair, address);
      const liquidity = market.liquidityUsd;
      const old = bestByToken.get(address.toLowerCase());
      if (!old || liquidity > old.liquidity) bestByToken.set(address.toLowerCase(), { market, liquidity });
    }
    return unique.map((address) => bestByToken.get(address)?.market).filter((market): market is TokenMarket => Boolean(market));
  }

  async discoverBaseMarkets(limit = 30): Promise<TokenMarket[]> {
    const payload = await json<DexResponse>(`${API_BASE}/latest/dex/search?q=base`);
    return (payload?.pairs ?? []).filter((pair) => pair.chainId === BASE_NETWORK && isAddress(pair.baseToken?.address)).map((pair) => marketFromPair(pair, pair.baseToken!.address as `0x${string}`)).sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, Math.min(limit, 30));
  }

  async discoverLowCapMemes(minLiquidityUsd: number, maxLiquidityUsd: number, limit = 50): Promise<TokenMarket[]> {
    const pairs: DexPair[] = [];
    const profilePayload = await json<Profile[]>(`${API_BASE}/token-profiles/latest/v1`);
    const profileAddresses = (profilePayload ?? []).filter((p) => p.chainId === BASE_NETWORK && isAddress(p.tokenAddress)).map((p) => p.tokenAddress!.toLowerCase()).slice(0, 30);
    if (profileAddresses.length > 0) {
      const profilePairs = await json<DexPair[]>(`${API_BASE}/tokens/v1/${BASE_NETWORK}/${profileAddresses.join(",")}`);
      pairs.push(...(profilePairs ?? []).filter((p) => p.chainId === BASE_NETWORK));
    }

    // Search many Base meme/narrative terms so discovery is not dominated by only
    // the handful of memes returned by one generic query. Keep this under the
    // Worker subrequest budget while still covering emerging meme vocabulary.
    const terms = [
      "base","meme","pepe","doge","dog","cat","frog","ape","monkey","brett","mog","degen","toshi","based","chad","bonk","inu","wojak","mfer","higher","keycat","normie","npc","bobo","andy","ponke","neiro","floki","turbo","ninja"
    ];
    const searchResults = await Promise.all(terms.map((term) => json<DexResponse>(`${API_BASE}/latest/dex/search?q=${encodeURIComponent(term)}`)));
    for (const result of searchResults) pairs.push(...(result?.pairs ?? []).filter((p) => p.chainId === BASE_NETWORK));

    const best = new Map<string, DexPair>();
    for (const pair of pairs) {
      const token = pair.baseToken;
      if (!isAddress(token?.address)) continue;
      const name = token.name ?? "";
      const symbol = token.symbol ?? "";
      const liquidity = num(pair.liquidity?.usd);
      const volume24h = num(pair.volume?.h24);
      if (excluded(name, symbol) || !meme(name, symbol) || liquidity < minLiquidityUsd || liquidity > maxLiquidityUsd || volume24h <= 0) continue;
      const key = token.address.toLowerCase();
      const old = best.get(key);
      if (!old || liquidity > num(old.liquidity?.usd) || volume24h > num(old.volume?.h24)) best.set(key, pair);
    }

    return [...best.values()]
      .map((pair) => marketFromPair(pair, pair.baseToken!.address as `0x${string}`))
      .filter((market) => market.dataCompleteness === "full")
      .sort((a, b) => (
        ((b.change1hPct ?? 0) * 3) + ((b.change6hPct ?? 0) * 2) + b.change24hPct + Math.min(b.volume24hUsd / Math.max(b.liquidityUsd, 1), 3) * 5
      ) - (
        ((a.change1hPct ?? 0) * 3) + ((a.change6hPct ?? 0) * 2) + a.change24hPct + Math.min(a.volume24hUsd / Math.max(a.liquidityUsd, 1), 3) * 5
      ) || b.volume24hUsd - a.volume24hUsd)
      .slice(0, Math.min(Math.max(limit, 1), 100));
  }
}
