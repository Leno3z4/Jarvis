import { DexScreenerMarketProvider } from "../market/dexscreener";
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

  const marketProvider = new DexScreenerMarketProvider();
  const markets = await marketProvider.discoverBaseMarkets(config.limit ?? 30);
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
