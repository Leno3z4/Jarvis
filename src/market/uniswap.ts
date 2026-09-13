import type { TokenMarket } from "./types";

const API_URL = "https://trade-api.gateway.uniswap.org/v1/tokens";
const CHAIN_ID = 8453;

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

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

export class UniswapTokenProvider {
  constructor(private readonly apiKey: string) {}

  async discoverBaseTokenAddresses(limit = 30): Promise<TokenMarket[]> {
    if (!this.apiKey) throw new Error("Uniswap API key is not configured.");

    const url = new URL(API_URL);
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
}
