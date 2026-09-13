import { UniswapTokenProvider } from "../market/uniswap";
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
  if (!config.zeroExApiKey || !config.takerAddress) {
    throw new Error("0x API key and taker address are required for strategy evaluation.");
  }
  const uniswapApiKey = config.strategy.uniswapApiKey;
  if (!uniswapApiKey) {
    throw new Error("Uniswap API key is required for Base token discovery.");
  }

  const limit = Math.min(config.limit ?? 15, 15);
  const uniswap = new UniswapTokenProvider(uniswapApiKey);
  const markets = await uniswap.discoverBaseMarkets(limit);
  if (markets.length === 0) return { opportunities: [], discovered: 0 };

  const quoteProvider = new ZeroExQuoteProvider(config.zeroExApiKey, config.takerAddress);
  const opportunities = await evaluateMarkets(
    markets,
    config.gemini,
    config.strategy,
    quoteProvider,
    config.strategy.quoteAmountWei,
    config.strategy.slippageBps
  );

  return { opportunities, discovered: markets.length };
}
