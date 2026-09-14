import baseWorker from "./worker";
import { getConfig, type Env } from "./config";
import { evaluateAutomation } from "./strategy/automation";
import { ZeroExQuoteProvider } from "./market/zeroex";
import { createPublicClient, erc20Abi, http } from "viem";
import { base } from "viem/chains";
import { LiveExecutor } from "./trading/executor";
import { validateTrade } from "./trading/risk";
import type { TradeRequest } from "./trading/types";

export { TradingBotState, RiskState } from "./worker";
export { LiveTradingState } from "./state/live-state";

const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as `0x${string}`;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("access-control-allow-origin", "*");
  return Response.json(body, { ...init, headers });
}

function liveStateStub(env: Env) {
  return env.LIVE_STATE.get(env.LIVE_STATE.idFromName("main"));
}

async function trackedTokens(env: Env): Promise<`0x${string}`[]> {
  const response = await liveStateStub(env).fetch("https://jarvis-live/tokens");
  if (!response.ok) throw new Error("Live state unavailable.");
  const body = await response.json() as { tokens?: string[] };
  return (body.tokens ?? []).filter((token) => /^0x[a-fA-F0-9]{40}$/.test(token)).map((token) => token as `0x${string}`);
}

async function heldPositions(env: Env, config: ReturnType<typeof getConfig>): Promise<Record<string, string>> {
  if (!config.liveWalletAddress) return {};
  const client = createPublicClient({ chain: base, transport: http(config.baseRpcUrl) });
  const positions: Record<string, string> = {};
  const cashToken = config.liveCashToken.toLowerCase();
  for (const token of await trackedTokens(env)) {
    if (token.toLowerCase() === cashToken || token.toLowerCase() === NATIVE_ETH.toLowerCase()) continue;
    try {
      const balance = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [config.liveWalletAddress] });
      if (balance > 0n) positions[token.toLowerCase()] = balance.toString();
    } catch {
      // Ignore stale tracked tokens.
    }
  }
  return positions;
}

async function liveExposure(env: Env, config: ReturnType<typeof getConfig>, positions: Record<string, string>): Promise<{ exposureWei: bigint; tokenExposureByAddress: Record<string, bigint> }> {
  if (!config.zeroExApiKey || !config.liveWalletAddress) return { exposureWei: 0n, tokenExposureByAddress: {} };
  const provider = new ZeroExQuoteProvider(config.zeroExApiKey, config.liveWalletAddress, 8453, true);
  const tokenExposureByAddress: Record<string, bigint> = {};
  let exposureWei = 0n;
  for (const [token, amount] of Object.entries(positions)) {
    try {
      const quote = await provider.getQuote({ tokenIn: token as `0x${string}`, tokenOut: config.liveCashToken, amountInWei: BigInt(amount), slippageBps: config.strategy.slippageBps });
      if (quote.amountOutWei > 0n) {
        tokenExposureByAddress[token] = quote.amountOutWei;
        exposureWei += quote.amountOutWei;
      }
    } catch {
      return { exposureWei: 0n, tokenExposureByAddress: {} };
    }
  }
  return { exposureWei, tokenExposureByAddress };
}

async function authorizeLiveTrade(env: Env, config: ReturnType<typeof getConfig>, trade: TradeRequest, exposureWei: bigint, tokenExposureWei: bigint, openPositions: number): Promise<Response | null> {
  const limits = config.risk;
  const response = await env.RISK_STATE.get(env.RISK_STATE.idFromName("main")).fetch(new Request("https://jarvis-risk/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cashToken: config.liveCashToken,
      trade: { ...trade, amountInWei: trade.amountInWei.toString(), amountOutWei: trade.amountOutWei.toString() },
      context: { currentExposureWei: exposureWei.toString(), tokenExposureWei: tokenExposureWei.toString(), openPositions, nowMs: Date.now() },
      limits: { maxTradeWei: limits.maxTradeWei.toString(), maxPortfolioExposureWei: limits.maxPortfolioExposureWei.toString(), maxTokenExposureWei: limits.maxTokenExposureWei.toString(), maxOpenPositions: limits.maxOpenPositions, maxTradesPerDay: limits.maxTradesPerDay, cooldownSeconds: limits.cooldownSeconds, maxDailyLossWei: limits.maxDailyLossWei.toString() }
    })
  }));
  return response.ok ? null : response;
}

async function runLiveCycle(env: Env, config: ReturnType<typeof getConfig>) {
  if (config.mode !== "live") return { executed: false, reason: "Live cycle not selected in paper mode." };
  const dryRun = config.liveDryRun;
  const missing: string[] = [];
  if (!dryRun && !config.liveTradingEnabled) missing.push("LIVE_TRADING_ENABLED=true");
  if (!config.zeroExApiKey) missing.push("ZEROEX_API_KEY");
  if (!config.liveWalletAddress) missing.push("LIVE_WALLET_ADDRESS");
  if (!dryRun && !config.livePrivateKey) missing.push("LIVE_PRIVATE_KEY");
  if (!config.gemini.primaryKey) missing.push("GEMINI_API_KEY");
  if (missing.length) return { executed: false, dryRun, reason: "Live automation is not fully configured.", missing };

  const positions = await heldPositions(env, config);
  const exposure = await liveExposure(env, config, positions);
  if (Object.keys(positions).length > 0 && exposure.exposureWei === 0n) return { executed: false, dryRun, reason: "Live exposure valuation failed; refusing to trade without complete position accounting." };

  const automation = await evaluateAutomation({
    gemini: [
      { role: "primary", apiKey: config.gemini.primaryKey, model: config.gemini.primaryModel },
      { role: "fallback1", apiKey: config.gemini.fallback1Key, model: config.gemini.fallback1Model },
      { role: "fallback2", apiKey: config.gemini.fallback2Key, model: config.gemini.fallback2Model }
    ],
    strategy: { ...config.strategy, cashToken: config.liveCashToken, heldPositions: positions },
    zeroExApiKey: config.zeroExApiKey,
    takerAddress: config.liveWalletAddress,
    cashToken: config.liveCashToken,
    quoteAmountWei: config.strategy.quoteAmountWei,
    slippageBps: config.strategy.slippageBps,
    risk: config.risk,
    allowQuoteBalanceIssues: false,
    heldPositions: positions
  });

  if (!automation.trade) return { executed: false, dryRun, reason: automation.blockedReason ?? "No live trade selected." };
  const validation = validateTrade(automation.trade, config.risk, config.liveCashToken);
  if (validation) return { executed: false, dryRun, reason: validation, trade: automation.trade };

  const riskToken = automation.trade.tokenIn.toLowerCase() === config.liveCashToken.toLowerCase() ? automation.trade.tokenOut.toLowerCase() : automation.trade.tokenIn.toLowerCase();
  const tokenExposure = exposure.tokenExposureByAddress[riskToken] ?? 0n;
  const riskResponse = await authorizeLiveTrade(env, config, automation.trade, exposure.exposureWei, tokenExposure, Object.keys(positions).length);
  if (riskResponse) {
    const body = await riskResponse.json() as { reason?: string; error?: string };
    return { executed: false, dryRun, reason: body.reason ?? body.error ?? "Live risk gate blocked trade.", trade: automation.trade };
  }

  if (dryRun) {
    return {
      executed: false,
      dryRun: true,
      validated: true,
      reason: "Live dry-run passed strategy, quote, validation, and risk gates; no transaction was sent.",
      trade: automation.trade
    };
  }

  const executor = new LiveExecutor({ apiKey: config.zeroExApiKey, rpcUrl: config.baseRpcUrl, privateKey: config.livePrivateKey as `0x${string}`, walletAddress: config.liveWalletAddress, enabled: config.liveTradingEnabled });
  const result = await executor.execute(automation.trade);
  if (result.status !== "submitted") return { executed: false, reason: result.message ?? "Live execution rejected.", trade: automation.trade };

  const recordResponse = await liveStateStub(env).fetch(new Request("https://jarvis-live/record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokenIn: automation.trade.tokenIn, tokenOut: automation.trade.tokenOut, amountInWei: automation.trade.amountInWei.toString(), amountOutWei: result.amountOutWei?.toString() ?? automation.trade.amountOutWei.toString(), txHash: result.txHash, reason: automation.trade.reason })
  }));
  if (!recordResponse.ok) return { executed: false, reason: "Live swap submitted but persistent live state could not be recorded; refusing to treat the cycle as complete.", txHash: result.txHash };

  return { executed: true, trade: automation.trade, txHash: result.txHash, message: result.message };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = getConfig(env);
    const url = new URL(request.url);
    if (url.pathname === "/live/trades" && request.method === "GET") return liveStateStub(env).fetch("https://jarvis-live/trades");
    if (config.mode === "live" && url.pathname === "/strategy/run" && request.method === "POST") {
      try { return json({ ok: true, ...(await runLiveCycle(env, config)) }); }
      catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "Live strategy run failed." }, { status: 503 }); }
    }
    return baseWorker.fetch(request, env);
  },
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const config = getConfig(env);
    if (config.mode === "live") {
      try { await runLiveCycle(env, config); } catch { /* remain fail-closed on scheduled failures */ }
      return;
    }
    await baseWorker.scheduled?.(event, env);
  }
};
