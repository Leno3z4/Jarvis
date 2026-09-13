import type { TokenMarket } from "./types";

const TOKEN_API_URL = "https://trade-api.gateway.uniswap.org/v1/tokens";
const POOL_API_URL = "https://liquidity.api.uniswap.org/lp/pool_info";
const CHAIN_ID = 8453;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
const BASE_WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const V3_FEES = [500, 3000] as const;

type Protocol = "V3";

interface UniswapToken {
  name?: string;
  address?: string;
  chainId?: string | number;
  symbol?: string;
  decimals?: string | number;
}

interface UniswapResponse { tokens?: UniswapToken[]; }

interface PoolInfo {
  tokenAddressA?: string;
  tokenAddressB?: string;
  tokenAmountA?: string;
  tokenAmountB?: string;
  tokenDecimalsA?: number | string;
  tokenDecimalsB?: number | string;
  poolLiquidity?: string;
  poolProtocol?: string;
  fee?: string | number;
}

interface PoolResponse { pools?: PoolInfo[]; }

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

function isErc20Address(value: string): boolean {
  const lower = value.toLowerCase();
  return lower !== NATIVE_SENTINEL.toLowerCase() && lower !== ZERO_ADDRESS.toLowerCase();
}

function positiveNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function poolInfo(
  apiKey: string,
  token: `0x${string}`,
  quoteToken: `0x${string}`,
  fee: number
): Promise<PoolInfo[]> {
  if (token.toLowerCase() === quoteToken.toLowerCase()) return [];

  const [tokenAddressA, tokenAddressB] = [token, quoteToken]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

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
        tokenAddressA,
        tokenAddressB,
        fee
      },
      pageSize: 10,
      currentPage: 1
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Uniswap V3 pool lookup failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as PoolResponse;
  return data.pools ?? [];
}

function marketFromPool(
  token: UniswapToken,
  pool: PoolInfo,
  quoteToken: `0x${string}`
): TokenMarket | null {
  if (!token.address) return null;

  const tokenA = pool.tokenAddressA?.toLowerCase();
  const tokenB = pool.tokenAddressB?.toLowerCase();
  const tokenLower = token.address.toLowerCase();
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
  const priceUsd = quoteLower === BASE_USDC.toLowerCase() ? quoteAmount / tokenAmount : 0;
  const liquidityUsd = quoteLower === BASE_USDC.toLowerCase() ? quoteAmount * 2 : 0;

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
      .filter((token) => {
        const address = token.address!.toLowerCase();
        return isErc20Address(token.address!) && address !== BASE_USDC.toLowerCase() && address !== BASE_WETH.toLowerCase();
      })
      .slice(0, 5)
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

  async discoverBaseMarkets(limit = 5): Promise<TokenMarket[]> {
    const tokens = (await this.discoverBaseTokenAddresses(Math.min(limit, 5))).slice(0, 5);
    const markets: TokenMarket[] = [];
    const failures: string[] = [];

    // Keep the Worker well under its default subrequest ceiling.
    // First try USDC on the two most common Base V3 fee tiers.
    for (const token of tokens) {
      for (const fee of V3_FEES) {
        try {
          const pools = await poolInfo(this.apiKey, token.address, BASE_USDC, fee);
          const market = pools
            .map((pool) => marketFromPool(token, pool, BASE_USDC))
            .filter((entry): entry is TokenMarket => entry !== null)
            .filter((entry) => entry.liquidityUsd > 0 && entry.priceUsd > 0)
            .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
          if (market) markets.push(market);
        } catch (error) {
          failures.push(`${token.symbol}:USDC:V3:${fee}:${error instanceof Error ? error.message : "unknown"}`);
        }
      }
    }

    // Only use WETH as a fallback, avoiding a second full scan when USDC works.
    if (markets.length === 0) {
      for (const token of tokens) {
        for (const fee of V3_FEES) {
          try {
            const pools = await poolInfo(this.apiKey, token.address, BASE_WETH, fee);
            const market = pools
              .map((pool) => marketFromPool(token, pool, BASE_WETH))
              .filter((entry): entry is TokenMarket => entry !== null)
              .filter((entry) => entry.liquidityUsd > 0)
              .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
            if (market) markets.push(market);
          } catch (error) {
            failures.push(`${token.symbol}:WETH:V3:${fee}:${error instanceof Error ? error.message : "unknown"}`);
          }
        }
      }
    }

    const bestByToken = new Map<string, TokenMarket>();
    for (const market of markets) {
      const current = bestByToken.get(market.address.toLowerCase());
      if (!current || market.liquidityUsd > current.liquidityUsd) {
        bestByToken.set(market.address.toLowerCase(), market);
      }
    }

    const result = [...bestByToken.values()];
    if (result.length === 0 && failures.length > 0) {
      throw new Error(`No Base Uniswap markets discovered. Sample pool errors: ${failures.slice(0, 3).join(" | ")}`);
    }
    return result;
  }
}
