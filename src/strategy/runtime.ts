import { UniswapTokenProvider } from "../market/uniswap";
import { TheGraphMarketDataProvider } from "../market/thegraph";
import { ZeroExQuoteProvider } from "../market/zeroex";
import { evaluateMarkets, type StrategyOpportunity, type StrategyLoopConfig } from "./loop";
import type { GeminiCandidate } from "../ai/gemini";

export async function runStrategyScan(config: {
  gemini: GeminiCandidate[];
  strategy: StrategyLoopConfig;
  zeroExApiKey?: string;
  takerAddress?: `0x${string}`;
  limit?: number;
}): Promise<{ opportunities: StrategyOpportunity[]; discovered: number }> {
  if (!config.zeroExApiKey || !config.takerAddress) throw new Error("0x API key and taker address are required for strategy evaluation.");
  const uniswapApiKey = config.strategy.uniswapApiKey;
  if (!uniswapApiKey) throw new Error("Uniswap API key is required for Base token discovery.");

  const limit = Math.min(Math.max(config.limit ?? 20, 10), 10);
  const uniswap = new UniswapTokenProvider(uniswapApiKey, config.takerAddress);
  const heldTokenAddresses = Object.entries(config.strategy.heldPositions ?? {})
    .filter(([, amount]) => amount !== "0")
    .map(([address]) => address as `0x${string}`);

  const discoveredTokens = await uniswap.discoverBaseTokenAddresses(limit, heldTokenAddresses);
  let markets = discoveredTokens.map((token) => ({
    address: token.address as `0x${string}`,
    symbol: token.symbol ?? "UNKNOWN",
    decimals: Number(token.decimals ?? 18),
    priceUsd: 0,
    liquidityUsd: 0,
    volume24hUsd: 0,
    change24hPct: 0,
    observedAt: Date.now(),
    dataCompleteness: "quote-only" as const
  }));

  if (config.strategy.theGraphApiKey && markets.length > 0) {
    const graph = new TheGraphMarketDataProvider(config.strategy.theGraphApiKey, config.strategy.theGraphUniswapV3SubgraphId);
    markets = await graph.enrichMarkets(markets);
  }

  if (markets.length === 0) return { opportunities: [], discovered: 0 };
  const quoteProvider = new ZeroExQuoteProvider(config.zeroExApiKey, config.takerAddress, 8453, !config.strategy.allowQuoteBalanceIssues);
  const opportunities = await evaluateMarkets(markets, config.gemini, config.strategy, quoteProvider, config.strategy.quoteAmountWei, config.strategy.slippageBps);
  return { opportunities, discovered: markets.length };
}
