import { TheGraphMarketDataProvider } from "../market/thegraph";
import { DexScreenerMarketProvider } from "../market/dexscreener";
import { ZeroExQuoteProvider } from "../market/zeroex";
import { evaluateMarkets, type StrategyOpportunity, type StrategyLoopConfig } from "./loop";
import type { GeminiCandidate } from "../ai/gemini";
import type { TokenMarket } from "../market/types";

function heldMarket(address: `0x${string}`): TokenMarket {
  return { address, symbol: "HELD", decimals: 18, priceUsd: 0, liquidityUsd: 0, volume24hUsd: 0, change24hPct: 0, observedAt: Date.now(), dataCompleteness: "quote-only" };
}

export async function runStrategyScan(config: { gemini: GeminiCandidate[]; strategy: StrategyLoopConfig; zeroExApiKey?: string; takerAddress?: `0x${string}`; limit?: number }): Promise<{ opportunities: StrategyOpportunity[]; discovered: number }> {
  if (!config.zeroExApiKey || !config.takerAddress) throw new Error("0x API key and taker address are required for strategy evaluation.");

  const limit = Math.min(Math.max(config.limit ?? 30, 30), 50);
  const heldTokenAddresses = Object.entries(config.strategy.heldPositions ?? {}).filter(([, amount]) => amount !== "0").map(([address]) => address as `0x${string}`);
  const dex = new DexScreenerMarketProvider();

  // DexScreener is the primary discovery source because its public API exposes
  // live Base pair liquidity, volume and short-term price-change fields directly.
  // The Graph remains available as a fallback if DexScreener returns nothing.
  let discoveredTokens: TokenMarket[] = await dex.discoverLowCapMemes(
    config.strategy.lowCapMinLiquidityUsd,
    config.strategy.lowCapMaxLiquidityUsd,
    Math.min(Math.max(limit * 2, 40), 100)
  );

  if (discoveredTokens.length === 0 && config.strategy.theGraphApiKey) {
    const graph = new TheGraphMarketDataProvider(config.strategy.theGraphApiKey, config.strategy.theGraphUniswapV3SubgraphId);
    discoveredTokens = await graph.discoverLowCapMarkets(config.strategy.lowCapMinLiquidityUsd, config.strategy.lowCapMaxLiquidityUsd, Math.min(Math.max(limit * 2, 40), 100));
    if (discoveredTokens.length > 0) discoveredTokens = await graph.enrichMarkets(discoveredTokens);
  }

  const heldMarkets = heldTokenAddresses.map(heldMarket);
  const unique = new Map<string, TokenMarket>();
  for (const market of [...heldMarkets, ...discoveredTokens]) unique.set(market.address.toLowerCase(), market);
  const markets = [...unique.values()];
  if (markets.length === 0) return { opportunities: [], discovered: 0 };

  const quoteProvider = new ZeroExQuoteProvider(config.zeroExApiKey, config.takerAddress, 8453, !config.strategy.allowQuoteBalanceIssues);
  const opportunities = await evaluateMarkets(enrichedForStrategy(markets), config.gemini, config.strategy, quoteProvider, config.strategy.quoteAmountWei, config.strategy.slippageBps);
  return { opportunities, discovered: markets.length };
}

function enrichedForStrategy(markets: TokenMarket[]): TokenMarket[] {
  // DexScreener already supplies the live price/liquidity/volume/momentum fields
  // needed by the deterministic scanner, so do not make another enrichment API call.
  return markets;
}
