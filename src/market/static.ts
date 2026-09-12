import type { MarketProvider, TokenMarket } from "./types";

const token = (address: `0x${string}`, symbol: string, decimals: number, priceUsd: number): TokenMarket => ({
  address,
  symbol,
  decimals,
  priceUsd,
  liquidityUsd: 0,
  volume24hUsd: 0,
  change24hPct: 0,
  observedAt: Date.now()
});

export class StaticMarketProvider implements MarketProvider {
  constructor(private readonly tokens: Record<string, TokenMarket>) {}

  async getToken(address: `0x${string}`): Promise<TokenMarket> {
    const market = this.tokens[address.toLowerCase()];
    if (!market) throw new Error(`No market data configured for ${address}.`);
    return { ...market, observedAt: Date.now() };
  }
}

export function createStaticMarketProvider(): StaticMarketProvider {
  const weth = token(
    "0x4200000000000000000000000000000000000006",
    "WETH",
    18,
    0
  );

  return new StaticMarketProvider({
    [weth.address.toLowerCase()]: weth
  });
}
