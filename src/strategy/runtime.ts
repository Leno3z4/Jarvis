import { TheGraphMarketDataProvider } from "../market/thegraph";
import { evaluateMarkets, type StrategyOpportunity, type StrategyLoopConfig } from "./loop";
import type { GeminiCandidate } from "../ai/gemini";
import type { TokenMarket } from "../market/types";

function heldMarket(address: `0x${string}`): TokenMarket {
  return {
    address,
    symbol: "HELD",
    decimals: 18,
    priceUsd: 0,
    liquidityUsd: 0,
    volume24hUsd: 0,
    change24hPct: 0,
    observedAt: Date.now(),
    dataCompleteness: "quote-only"
  };
}

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

  const limit = Math.min(Math.max(config.limit ?? 30, 30), 50);
  const heldTokenAddresses = Object.entries(config.strategy.heldPositions ?? {})
    .filter(([, amount]) => amount !== "0")
    .map(([address]) => address as `0x${string}`);

  const graph = config.strategy.theGraphApiKey
    ? new TheGraphMarketDataProvider(config.strategy.theGraphApiKey, config.strategy.theGraphUniswapV3SubgraphId)
    : undefined;

  // New entries come exclusively from the low-cap universe. Do not fall back
  // to broad Uniswap volume/TVL leaderboards, because that defeats the low-cap
  // requirement whenever The Graph has no qualifying results.
  let discoveredTokens: TokenMarket[] = graph
    ? await graph.discoverLowCapMarkets(
        config.strategy.lowCapMinLiquidityUsd,
        config.strategy.lowCapMaxLiquidityUsd,
        Math.min(Math.max(limit * 2, 40), 100)
      )
    : [];

  const heldMarkets = heldTokenAddresses.map((address) => heldMarket(address));
  const unique = new Map<string, TokenMarket>();
  for (const market of [...heldMarkets, ...discoveredTokens]) {
    unique.set(market.address.toLowerCase(), market);
  }
  let markets = [...unique.values()];

  // No The Graph low-cap data means no new-entry universe. Existing held
  // positions can still proceed to exit analysis.
  if (markets.length === 0) return { opportunities: [], discovered: 0 };

  if (graph && discoveredTokens.length > 0) {
    markets = await graph.enrichMarkets(markets);
  }

  if (discoveredTokens.length === 0 && heldMarkets.length > 0) {
    // Held-only evaluation deliberately remains possible for exits.
    markets = heldMarkets;
  }

  const quoteProvider = new (await import("../market/zeroex")).ZeroExQuoteProvider(
    config.zeroExApiKey,
    config.takerAddress,
    8453,
    !config.strategy.allowQuoteBalanceIssues
  );
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
