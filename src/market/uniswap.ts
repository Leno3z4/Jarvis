import type { TokenMarket } from "./types";

const TOKEN_API_URL = "https://trade-api.gateway.uniswap.org/v1/tokens";
const QUOTE_API_URL = "https://trade-api.gateway.uniswap.org/v1/quote";
const CHAIN_ID = 8453;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
const BASE_WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DISCOVERY_WETH_AMOUNT_WEI = 1_000_000_000_000_000n;

interface UniswapToken {
  name?: string;
  address?: string;
  chainId?: string | number;
  symbol?: string;
  decimals?: string | number;
}

interface UniswapResponse { tokens?: UniswapToken[]; }

interface QuoteOutput {
  amount?: string;
  token?: string;
}

interface QuotePayload {
  quote?: {
    output?: { amount?: string; token?: string };
    outputs?: QuoteOutput[];
  };
  routing?: string;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

function isErc20Address(value: string): boolean {
  const lower = value.toLowerCase();
  return lower !== NATIVE_SENTINEL.toLowerCase() && lower !== ZERO_ADDRESS.toLowerCase();
}

function positiveBigInt(value: unknown): bigint {
  try {
    const parsed = BigInt(String(value ?? "0"));
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

async function quoteToken(
  apiKey: string,
  swapper: `0x${string}`,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amount: bigint
): Promise<bigint> {
  const response = await fetch(QUOTE_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      accept: "application/json",
      "content-type": "application/json",
      "x-universal-router-version": "2.0",
      "x-erc20eth-enabled": "false",
      "x-permit2-disabled": "false"
    },
    body: JSON.stringify({
      type: "EXACT_INPUT",
      amount: amount.toString(),
      tokenInChainId: CHAIN_ID,
      tokenOutChainId: CHAIN_ID,
      tokenIn,
      tokenOut,
      swapper,
      slippageTolerance: 0.5,
      routingPreference: "BEST_PRICE",
      protocols: ["V2", "V3", "V4"]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Uniswap quote failed (${response.status}): ${body.slice(0, 220)}`);
  }

  const data = (await response.json()) as QuotePayload;
  const output = positiveBigInt(data.quote?.output?.amount ?? data.quote?.outputs?.[0]?.amount);
  if (output <= 0n) throw new Error("Uniswap quote returned no positive output.");
  return output;
}

export class UniswapTokenProvider {
  constructor(
    private readonly apiKey: string,
    private readonly swapper: `0x${string}`
  ) {}

  async discoverBaseTokenAddresses(limit = 5): Promise<TokenMarket[]> {
    if (!this.apiKey) throw new Error("Uniswap API key is not configured.");

    const url = new URL(TOKEN_API_URL);
    url.searchParams.set("sort", "volume_24h");
    url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 20)));
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
        return isErc20Address(token.address!) &&
          address !== BASE_USDC.toLowerCase() &&
          address !== BASE_WETH.toLowerCase();
      })
      .slice(0, Math.min(limit, 5))
      .map((token) => ({
        address: token.address as `0x${string}`,
        symbol: token.symbol ?? token.name ?? "UNKNOWN",
        decimals: Number(token.decimals ?? 18),
        priceUsd: 0,
        liquidityUsd: 0,
        volume24hUsd: 0,
        change24hPct: 0,
        observedAt: Date.now(),
        dataCompleteness: "quote-only"
      }));
  }

  async discoverBaseMarkets(limit = 5): Promise<TokenMarket[]> {
    const tokens = await this.discoverBaseTokenAddresses(Math.min(limit, 5));
    const markets: TokenMarket[] = [];
    const failures: string[] = [];
    const usdcForWeth = await quoteToken(
      this.apiKey,
      this.swapper,
      BASE_WETH,
      BASE_USDC,
      DISCOVERY_WETH_AMOUNT_WEI
    ).catch((error) => {
      failures.push(`WETH/USDC:${error instanceof Error ? error.message : "unknown"}`);
      return 0n;
    });

    if (usdcForWeth <= 0n) {
      throw new Error(`Uniswap quote discovery failed. ${failures.join(" | ")}`);
    }

    const usdcAmount = Number(usdcForWeth) / 1e6;
    const wethAmount = Number(DISCOVERY_WETH_AMOUNT_WEI) / 1e18;
    const wethPriceUsd = usdcAmount / wethAmount;

    for (const token of tokens) {
      try {
        const tokenAmount = await quoteToken(
          this.apiKey,
          this.swapper,
          BASE_WETH,
          token.address,
          DISCOVERY_WETH_AMOUNT_WEI
        );
        const tokenUnits = Number(tokenAmount) / 10 ** token.decimals;
        if (!Number.isFinite(tokenUnits) || tokenUnits <= 0) continue;

        const priceUsd = wethPriceUsd * (wethAmount / tokenUnits);
        if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;

        markets.push({
          ...token,
          priceUsd,
          liquidityUsd: 0,
          volume24hUsd: 0,
          change24hPct: 0,
          observedAt: Date.now(),
          dataCompleteness: "quote-only"
        });
      } catch (error) {
        failures.push(`${token.symbol}:${error instanceof Error ? error.message : "unknown"}`);
      }
    }

    if (markets.length === 0) {
      throw new Error(`No Base Uniswap quote markets discovered. Sample quote errors: ${failures.slice(0, 3).join(" | ")}`);
    }

    return markets;
  }
}
