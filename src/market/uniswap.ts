import type { TokenMarket } from "./types";

const TOKEN_API_URL = "https://trade-api.gateway.uniswap.org/v1/tokens";
const POOL_API_URL = "https://liquidity.api.uniswap.org/lp/pool_info";
const CHAIN_ID = 8453;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
const BASE_WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;

interface UniswapToken {
  name?: string;
  address?: string;
  chainId?: string | number;
  symbol?: string;
  decimals?: string | number;
}

interface UniswapResponse {
  tokens?: UniswapToken[];
}

interface PoolInfo {
  tokenAddressA?: string;
  tokenAddressB?: string;
  tokenAmountA?: string;
  tokenAmountB?: string;
  tokenDecimalsA?: number | string;
  tokenDecimalsB?: number | string;
  poolLiquidity?: string;
  poolProtocol?: string;
}

interface PoolResponse {
  pools?: PoolInfo[];
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

function positiveNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function poolInfo(
  apiKey: string,
  token: `0x${string}`,
  quoteToken: `0x${string}`
): Promise<PoolInfo[]> {
  const response = await fetch(POOL_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      protocol: "V3",
      chainId: CHAIN_ID,
      poolParameters: {
        tokenAddressA: token,
        tokenAddressB: quoteToken
      },
      pageSize: 20,
      currentPage: 1
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Uniswap pool lookup failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as PoolResponse;
  return data.pools ?? [];
}

function marketFromPool(
  token: UniswapToken,
  pool: PoolInfo,
  quoteToken: `0x${string}`
): TokenMarket | null {
  const tokenA = pool.tokenAddressA?.toLowerCase();
  const tokenB = pool.tokenAddressB?.toLowerCase();
  const tokenLower = token.address!.toLowerCase();
  const quoteLower = quoteToken.toLowerCase();

  if (![tokenA, tokenB].includes(tokenLower) || ![tokenA, tokenB].includes(quoteLower)) return null;

  const tokenIsA = tokenA === tokenLower;
  const rawToken = positiveNumber(tokenIsA ? pool.tokenAmountA : pool.tokenAmountB);
  const rawQuote = positiveNumber(tokenIsA ? pool.tokenAmountB : pool.tokenAmountA);
  const tokenDecimals = Number(tokenIsA ? pool.tokenDecimalsA : pool.tokenDecimalsB) || Number(token.decimals ?? 18);
  const quoteDecimals = Number(tokenIsA ? pool.tokenDecimalsB : pool.tokenDecimalsA) || (quoteLower === BASE_USDC.toLowerCase() ? 6 : 18);

  if (rawToken <= 0 || rawQuote <= 0) return null;

  const tokenAmount = rawToken / 10 ** tokenDecimals;
  const quoteAmount = rawQuote / 10 ** quoteDecimals;
  const priceUsd = quoteLower === BASE_USDC.toLowerCase()
    ? quoteAmount / tokenAmount
    : 0;

  const liquidityUsd = quoteLower === BASE_USDC.toLowerCase()
    ? quoteAmount * 2
    : 0;

  return {
    address: token.address as `0x${string}`,
    symbol: token.symbol ?? token.name ?? "UNKNOWN",
    decimals: tokenDecimals,
    priceUsd,
    liquidityUsd,
    volume24hUsd: 0,
    change24hPct: 0,
    observedAt: Date.now(),
    dataCompleteness: "liquidity-price-only"
  };
}

export class UniswapTokenProvider {
  constructor(private readonly apiKey: string) {}

  async discoverBaseTokenAddresses(limit = 30): Promise<TokenMarket[]> {
    if (!this.apiKey) throw new Error("Uniswap API key is not configured.");

    const url = new URL(TOKEN_API_URL);
    url.searchParams.set("sort", "volume_24h");
    url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 100)));
    url.searchParams.set("chainId", String(CHAIN_ID));

    const response = await fetch(url, {
      headers: {
        "x-api-key": this.apiKey,
        accept: "application/json"
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Uniswap token discovery failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as UniswapResponse;
    return (data.tokens ?? [])
      .filter((token) => Number(token.chainId) === CHAIN_ID && isAddress(token.address))
      .map((token) => ({
        address: token.address as `0x${string}`,
        symbol: token.symbol ?? token.name ?? "UNKNOWN",
        decimals: Number(token.decimals ?? 18),
        priceUsd: 0,
        liquidityUsd: 0,
        volume24hUsd: 0,
        change24hPct: 0,
        observedAt: Date.now()
      }));
  }

  async discoverBaseMarkets(limit = 15): Promise<TokenMarket[]> {
    const tokens = (await this.discoverBaseTokenAddresses(Math.min(limit, 20))).slice(0, Math.min(limit, 20));
    const markets: TokenMarket[] = [];

    for (let index = 0; index < tokens.length; index += 3) {
      const batch = tokens.slice(index, index + 3);
      const results = await Promise.all(batch.map(async (token) => {
        try {
          const usdcPools = await poolInfo(this.apiKey, token.address, BASE_USDC);
          const usdcMarkets = usdcPools
            .map((pool) => marketFromPool(token, pool, BASE_USDC))
            .filter((market): market is TokenMarket => market !== null)
            .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
          if (usdcMarkets[0]) return usdcMarkets[0];

          const wethPools = await poolInfo(this.apiKey, token.address, BASE_WETH);
          const wethMarkets = wethPools
            .map((pool) => marketFromPool(token, pool, BASE_WETH))
            .filter((market): market is TokenMarket => market !== null)
            .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
          return wethMarkets[0] ?? null;
        } catch {
          return null;
        }
      }));

      markets.push(...results.filter((market): market is TokenMarket => market !== null));
    }

    return markets;
  }
}
