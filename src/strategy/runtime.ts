import { UniswapTokenProvider } from "../market/uniswap";
import { DexScreenerMarketProvider } from "../market/dexscreener";
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
  const addresses = discoveredTokens.map((token) => token.address as `0x${string}`);
  const marketProvider = new DexScreenerMarketProvider();
  let markets = await marketProvider.getTokens(addresses);

  const known = new Set(markets.map((market) => market.address.toLowerCase()));
  const missingHeld = heldTokenAddresses.filter((address) => !known.has(address.toLowerCase()));
  if (missingHeld.length > 0) {
    const heldMarkets = await Promise.all(missingHeld.slice(0, 3).map((address) => marketProvider.getToken(address)));
    markets = [...markets, ...heldMarkets];
  }

  if (config.strategy.theGraphApiKey && markets.length > 0) {
    const graph = new TheGraphMarketDataProvider(config.strategy.theGraphApiKey, config.strategy.theGraphUniswapV3SubgraphId);
    markets = await graph.enrichMarkets(markets.slice(0, 10));
  }

  if (markets.length === 0) return { opportunities: [], discovered: 0 };
  const quoteProvider = new ZeroExQuoteProvider(config.zeroExApiKey, config.takerAddress, 8453, !config.strategy.allowQuoteBalanceIssues);
  const opportunities = await evaluateMarkets(markets, config.gemini, config.strategy, quoteProvider, config.strategy.quoteAmountWei, config.strategy.slippageBps);
  return { opportunities, discovered: markets.length };
}
