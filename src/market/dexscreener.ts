import type { MarketProvider, TokenMarket } from "./types";

const API_BASE = "https://api.geckoterminal.com/api/v2";
const BASE_NETWORK = "base";

interface GeckoTokenAttributes {
  name?: string;
  symbol?: string;
}

interface GeckoResource {
  id?: string;
  type?: string;
  attributes?: GeckoTokenAttributes;
}

interface GeckoPoolAttributes {
  base_token_price_usd?: string | null;
  reserve_in_usd?: string | null;
  volume_usd?: Record<string, string | number>;
  price_change_percentage?: Record<string, string | number>;
  name?: string;
}

interface GeckoPool {
  id?: string;
  type?: string;
  attributes?: GeckoPoolAttributes;
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
  };
}

interface GeckoResponse {
  data?: GeckoPool[];
  included?: GeckoResource[];
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function addressFromResourceId(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const candidate = value.includes("_") ? value.slice(value.indexOf("_") + 1) : value;
  return isAddress(candidate) ? candidate : null;
}

function marketFromPool(
  pool: GeckoPool,
  token: `0x${string}`,
  symbol: string
): TokenMarket {
  const attributes = pool.attributes ?? {};
  return {
    address: token,
    symbol,
    decimals: 18,
    priceUsd: num(attributes.base_token_price_usd),
    liquidityUsd: num(attributes.reserve_in_usd),
    volume24hUsd: num(attributes.volume_usd?.h24),
    change24hPct: num(attributes.price_change_percentage?.h24),
    observedAt: Date.now()
  };
}

function tokenSymbol(
  resourceId: string | undefined,
  included: Map<string, GeckoResource>,
  poolName?: string
): string {
  const symbol = resourceId ? included.get(resourceId)?.attributes?.symbol : undefined;
  if (symbol) return symbol;
  const name = resourceId ? included.get(resourceId)?.attributes?.name : undefined;
  if (name) return name;
  const fromPool = poolName?.split("/")[0]?.trim();
  return fromPool || "UNKNOWN";
}

export class DexScreenerMarketProvider implements MarketProvider {
  async getToken(address: `0x${string}`): Promise<TokenMarket> {
    const response = await fetch(
      `${API_BASE}/networks/${BASE_NETWORK}/tokens/${encodeURIComponent(address)}/pools`,
      { headers: { accept: "application/json;version=20230203" } }
    );

    if (!response.ok) {
      throw new Error(`GeckoTerminal token lookup failed (${response.status}).`);
    }

    const data = (await response.json()) as GeckoResponse;
    const pool = (data.data ?? [])[0];
    if (!pool) throw new Error(`No Base market found for ${address}.`);

    const included = new Map((data.included ?? []).map((item) => [item.id ?? "", item]));
    const baseId = pool.relationships?.base_token?.data?.id;
    const baseAddress = addressFromResourceId(baseId);
    if (baseAddress?.toLowerCase() === address.toLowerCase()) {
      return marketFromPool(pool, address, tokenSymbol(baseId, included, pool.attributes?.name));
    }

    return {
      address,
      symbol: tokenSymbol(baseId, included, pool.attributes?.name),
      decimals: 18,
      priceUsd: num(pool.attributes?.base_token_price_usd),
      liquidityUsd: num(pool.attributes?.reserve_in_usd),
      volume24hUsd: num(pool.attributes?.volume_usd?.h24),
      change24hPct: num(pool.attributes?.price_change_percentage?.h24),
      observedAt: Date.now()
    };
  }

  async getTokens(addresses: `0x${string}`[]): Promise<TokenMarket[]> {
    const wanted = new Set(
      addresses
        .filter(isAddress)
        .map((address) => address.toLowerCase())
    );
    if (wanted.size === 0) return [];

    const response = await fetch(
      `${API_BASE}/networks/${BASE_NETWORK}/pools?sort=h24_volume_usd_desc&page=1&include=base_token,quote_token`,
      { headers: { accept: "application/json;version=20230203" } }
    );

    if (!response.ok) {
      throw new Error(`GeckoTerminal pool discovery failed (${response.status}).`);
    }

    const data = (await response.json()) as GeckoResponse;
    const included = new Map((data.included ?? []).map((item) => [item.id ?? "", item]));
    const bestByToken = new Map<string, { market: TokenMarket; liquidity: number }>();

    for (const pool of data.data ?? []) {
      const baseId = pool.relationships?.base_token?.data?.id;
      const baseAddress = addressFromResourceId(baseId);
      if (!baseAddress) continue;

      const key = baseAddress.toLowerCase();
      if (!wanted.has(key)) continue;

      const market = marketFromPool(
        pool,
        baseAddress,
        tokenSymbol(baseId, included, pool.attributes?.name)
      );
      const current = bestByToken.get(key);
      if (!current || market.liquidityUsd > current.liquidity) {
        bestByToken.set(key, { market, liquidity: market.liquidityUsd });
      }
    }

    return [...bestByToken.values()]
      .sort((a, b) => b.liquidity - a.liquidity)
      .map((entry) => entry.market)
      .slice(0, Math.min(addresses.length, 30));
  }

  async discoverBaseMarkets(limit = 30): Promise<TokenMarket[]> {
    const response = await fetch(
      `${API_BASE}/networks/${BASE_NETWORK}/pools?sort=h24_volume_usd_desc&page=1&include=base_token,quote_token`,
      { headers: { accept: "application/json;version=20230203" } }
    );

    if (!response.ok) {
      throw new Error(`GeckoTerminal discovery failed (${response.status}).`);
    }

    const data = (await response.json()) as GeckoResponse;
    const included = new Map((data.included ?? []).map((item) => [item.id ?? "", item]));

    return (data.data ?? [])
      .map((pool) => {
        const baseId = pool.relationships?.base_token?.data?.id;
        const baseAddress = addressFromResourceId(baseId);
        if (!baseAddress) return null;
        return marketFromPool(pool, baseAddress, tokenSymbol(baseId, included, pool.attributes?.name));
      })
      .filter((market): market is TokenMarket => market !== null)
      .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
      .slice(0, Math.min(limit, 30));
  }
}
