import type { MarketProvider, TokenMarket } from "./types";

const API_BASE = "https://api.dexscreener.com";
const BASE_CHAIN = "base";

interface TokenProfile {
  chainId?: string;
  tokenAddress?: string;
}

interface Pair {
  chainId?: string;
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string };
  priceUsd?: string | null;
  volume?: Record<string, number>;
  priceChange?: Record<string, number> | null;
  liquidity?: { usd?: number | null } | null;
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toMarket(pair: Pair): TokenMarket {
  return {
    address: pair.baseToken!.address as `0x${string}`,
    symbol: pair.baseToken?.symbol ?? "UNKNOWN",
    decimals: 18,
    priceUsd: Number(pair.priceUsd ?? 0),
    liquidityUsd: num(pair.liquidity?.usd),
    volume24hUsd: num(pair.volume?.h24),
    change24hPct: num(pair.priceChange?.h24),
    observedAt: Date.now()
  };
}

function bestBasePairs(pairs: Pair[], limit: number): TokenMarket[] {
  const bestByToken = new Map<string, Pair>();

  for (const pair of pairs) {
    if (pair.chainId !== BASE_CHAIN || !isAddress(pair.baseToken?.address)) continue;
    const address = pair.baseToken!.address!.toLowerCase();
    const current = bestByToken.get(address);
    if (!current || num(pair.liquidity?.usd) > num(current.liquidity?.usd)) {
      bestByToken.set(address, pair);
    }
  }

  return [...bestByToken.values()]
    .sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))
    .slice(0, Math.min(limit, 30))
    .map(toMarket);
}

export class DexScreenerMarketProvider implements MarketProvider {
  async getToken(address: `0x${string}`): Promise<TokenMarket> {
    const response = await fetch(
      `${API_BASE}/latest/dex/tokens/${encodeURIComponent(address)}`,
      { headers: { accept: "application/json" } }
    );

    if (!response.ok) {
      throw new Error(`DexScreener token lookup failed (${response.status}).`);
    }

    const data = (await response.json()) as { pairs?: Pair[] };
    const pairs = (data.pairs ?? []).filter(
      (pair) => pair.chainId === BASE_CHAIN && pair.baseToken?.address?.toLowerCase() === address.toLowerCase()
    );

    if (pairs.length === 0) throw new Error(`No Base market found for ${address}.`);

    const pair = pairs.sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))[0];
    const change24h = num(pair.priceChange?.h24);

    return {
      address,
      symbol: pair.baseToken?.symbol ?? "UNKNOWN",
      decimals: 18,
      priceUsd: Number(pair.priceUsd ?? 0),
      liquidityUsd: num(pair.liquidity?.usd),
      volume24hUsd: num(pair.volume?.h24),
      change24hPct: change24h,
      observedAt: Date.now()
    };
  }

  private async discoverFromSearch(limit: number): Promise<TokenMarket[]> {
    const queries = ["WETH", "USDC"];
    const pairs: Pair[] = [];

    for (const query of queries) {
      const response = await fetch(
        `${API_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`,
        { headers: { accept: "application/json" } }
      );
      if (!response.ok) continue;
      const data = (await response.json()) as { pairs?: Pair[] };
      pairs.push(...(data.pairs ?? []));
    }

    return bestBasePairs(pairs, limit);
  }

  async discoverBaseMarkets(limit = 30): Promise<TokenMarket[]> {
    const profilesResponse = await fetch(`${API_BASE}/token-profiles/latest/v1`, {
      headers: { accept: "application/json" }
    });

    if (profilesResponse.ok) {
      const profiles = (await profilesResponse.json()) as TokenProfile[];
      const addresses = profiles
        .filter((profile) => profile.chainId === BASE_CHAIN && isAddress(profile.tokenAddress))
        .map((profile) => profile.tokenAddress as `0x${string}`)
        .slice(0, Math.min(limit, 30));

      if (addresses.length === 0) return [];

      const response = await fetch(
        `${API_BASE}/latest/dex/tokens/${addresses.join(",")}`,
        { headers: { accept: "application/json" } }
      );

      if (!response.ok) {
        throw new Error(`DexScreener batch lookup failed (${response.status}).`);
      }

      const data = (await response.json()) as { pairs?: Pair[] };
      return bestBasePairs(data.pairs ?? [], limit);
    }

    if (profilesResponse.status === 429) {
      const fallback = await this.discoverFromSearch(limit);
      if (fallback.length > 0) return fallback;
      throw new Error("DexScreener discovery is rate limited; search fallback returned no Base markets.");
    }

    throw new Error(`DexScreener profile discovery failed (${profilesResponse.status}).`);
  }
}