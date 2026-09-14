import type { MarketProvider, TokenMarket } from "./types";

const API_BASE = "https://api.dexscreener.com";
const BASE_NETWORK = "base";

interface DexPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string | null;
  priceNative?: string | null;
  liquidity?: { usd?: number | string | null; base?: number | string | null; quote?: number | string | null };
  volume?: Record<string, number | string>;
  priceChange?: Record<string, number | string>;
}

interface DexResponse { pairs?: DexPair[] | null; }

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function marketFromPair(pair: DexPair, address: `0x${string}`): TokenMarket {
  const base = pair.baseToken?.address?.toLowerCase() === address.toLowerCase();
  const token = base ? pair.baseToken : pair.quoteToken;
  const priceUsd = num(pair.priceUsd);
  const liquidityUsd = num(pair.liquidity?.usd);
  const volume24hUsd = num(pair.volume?.h24);
  const change24hPct = num(pair.priceChange?.h24);
  return {
    address,
    symbol: token?.symbol ?? token?.name ?? "UNKNOWN",
    decimals: 18,
    priceUsd,
    liquidityUsd,
    volume24hUsd,
    change24hPct,
    observedAt: Date.now()
  };
}

export class DexScreenerMarketProvider implements MarketProvider {
  async getToken(address: `0x${string}`): Promise<TokenMarket> {
    if (!isAddress(address)) throw new Error(`Invalid token address: ${address}`);
    const response = await fetch(`${API_BASE}/token-pairs/v1/${BASE_NETWORK}/${address}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`DexScreener token lookup failed (${response.status}).`);
    const pairs = await response.json() as DexPair[];
    const basePairs = (pairs ?? []).filter((pair) => pair.chainId === BASE_NETWORK);
    if (basePairs.length === 0) throw new Error(`No Base market found for ${address}.`);
    const best = [...basePairs].sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))[0];
    return marketFromPair(best, address);
  }

  async getTokens(addresses: `0x${string}`[]): Promise<TokenMarket[]> {
    const wanted = addresses.filter(isAddress).map((address) => address.toLowerCase());
    if (wanted.length === 0) return [];
    const unique = [...new Set(wanted)].slice(0, 30);
    const response = await fetch(`${API_BASE}/tokens/v1/${BASE_NETWORK}/${unique.join(",")}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`DexScreener batch discovery failed (${response.status}).`);
    const data = await response.json() as DexPair[];
    const bestByToken = new Map<string, { market: TokenMarket; liquidity: number }>();

    for (const pair of data ?? []) {
      if (pair.chainId !== BASE_NETWORK) continue;
      const baseAddress = pair.baseToken?.address;
      const quoteAddress = pair.quoteToken?.address;
      const tokenAddress = isAddress(baseAddress) && wanted.includes(baseAddress.toLowerCase())
        ? baseAddress
        : isAddress(quoteAddress) && wanted.includes(quoteAddress.toLowerCase())
          ? quoteAddress
          : null;
      if (!tokenAddress) continue;
      const market = marketFromPair(pair, tokenAddress);
      const key = tokenAddress.toLowerCase();
      const liquidity = market.liquidityUsd;
      const existing = bestByToken.get(key);
      if (!existing || liquidity > existing.liquidity) bestByToken.set(key, { market, liquidity });
    }

    return unique.map((address) => bestByToken.get(address)?.market).filter((market): market is TokenMarket => Boolean(market));
  }

  async discoverBaseMarkets(limit = 30): Promise<TokenMarket[]> {
    const response = await fetch(`${API_BASE}/latest/dex/search?q=base`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`DexScreener discovery failed (${response.status}).`);
    const payload = await response.json() as DexResponse;
    return (payload.pairs ?? [])
      .filter((pair) => pair.chainId === BASE_NETWORK && isAddress(pair.baseToken?.address))
      .map((pair) => marketFromPair(pair, pair.baseToken!.address as `0x${string}`))
      .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
      .slice(0, Math.min(limit, 30));
  }
}
