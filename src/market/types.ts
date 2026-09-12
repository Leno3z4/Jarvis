export interface TokenMarket {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  change24hPct: number;
  observedAt: number;
}

export interface MarketProvider {
  getToken(address: `0x${string}`): Promise<TokenMarket>;
}

export interface QuoteRequest {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInWei: bigint;
  slippageBps: number;
}

export interface Quote {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInWei: bigint;
  amountOutWei: bigint;
  priceImpactBps: number;
  estimatedGasWei?: bigint;
  provider: string;
  observedAt: number;
}

export interface QuoteProvider {
  getQuote(request: QuoteRequest): Promise<Quote>;
}
