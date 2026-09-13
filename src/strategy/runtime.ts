import { DexScreenerMarketProvider } from "../market/dexscreener";
import { UniswapTokenProvider } from "../market/uniswap";
import { ZeroExQuoteProvider } from "../market/zeroex";
import { evaluateMarkets, type StrategyOpportunity, type StrategyLoopConfig } from "./loop";
import type { GeminiCandidate } from "../ai/gemini";

export async function runStrategyScan(config: {
  gemini: GeminiCandidate[];
  strategy: StrategyLoopConfig;
  zeroExApiKey?: string;
  uniswapApiKey?: string;
  takerAddress?: `0x${string}`;
  limit?: number;
}): Promise<{ opportunities: StrategyOpportunity[]; discovered: number }> {
  if (!config.zeroExApiKey || !config.takerAddress) {
    throw new Error("0x API key and taker address are required for strategy evaluation.");
  }
  if (!config.uniswapApiKey) {
    throw new Error("Uniswap API key is required for Base token discovery.");
  }

  const limit = config.limit ?? 30;
  const uniswap = new UniswapTokenProvider(config.uniswapApiKey);
  const tokens = await uniswap.discoverBaseTokenAddresses(limit);
  if (tokens.length === 0) return { opportunities: [], discovered: 0 };

  const dex = new DexScreenerMarketProvider();
  const addresses = tokens.map((token) => token.address);
  const markets = await dex.getTokens(addresses);
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
