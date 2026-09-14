import legacy from "./index";
import { TradingBotState } from "./state/bot-state";
import { RiskState } from "./state/risk-state";
import { getConfig, type Env } from "./config";
import { TheGraphMarketDataProvider } from "./market/thegraph";
import { evaluateAutomation } from "./strategy/automation";
import { validateTrade } from "./trading/risk";
import type { TradeRequest } from "./trading/types";

interface TradePayload { tokenIn: `0x${string}`; tokenOut: `0x${string}`; amountInWei: string; amountOutWei: string; slippageBps: number; reason: string; idempotencyKey?: string; }
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type,authorization" };
function json(body: unknown, init: ResponseInit = {}): Response { const headers = new Headers(init.headers); for (const [key, value] of Object.entries(CORS)) headers.set(key, value); return Response.json(body, { ...init, headers }); }
function parseTrade(body: TradePayload): TradeRequest { return { tokenIn: body.tokenIn, tokenOut: body.tokenOut, amountInWei: BigInt(body.amountInWei), amountOutWei: BigInt(body.amountOutWei), slippageBps: body.slippageBps, reason: body.reason, idempotencyKey: body.idempotencyKey }; }
function stateStub(env: Env) { return env.BOT_STATE.get(env.BOT_STATE.idFromName("main")); }
function riskStub(env: Env) { return env.RISK_STATE.get(env.RISK_STATE.idFromName("main")); }
async function getPaperPortfolio(env: Env, config: ReturnType<typeof getConfig>) {
  const response = await stateStub(env).fetch(`https://jarvis.internal/portfolio?cashToken=${config.paperCashToken}&startingCashWei=${config.paperStartingCashWei}`);
  if (!response.ok) throw new Error("Portfolio state unavailable.");
  return response.json() as Promise<{ cashWei: string; positions: Record<string, string>; costBasisWei?: Record<string, string>; realizedPnlWei: string }>;
}
async function getPaperTrades(env: Env) {
  const response = await stateStub(env).fetch("https://jarvis.internal/trades?limit=500");
  if (!response.ok) throw new Error("Trade history unavailable.");
  return response.json() as Promise<{ trades: Array<{ tokenIn: string; tokenOut: string; amountInWei: string; amountOutWei: string }> }>;
}
function deriveExposureFromTrades(
  trades: Array<{ tokenIn: string; tokenOut: string; amountInWei: string; amountOutWei: string }>,
  cashToken: `0x${string}`,
  positions: Record<string, string>
) {
  const cashKey = cashToken.toLowerCase();
  const held: Record<string, bigint> = {};
  const basis: Record<string, bigint> = {};
  for (const row of trades) {
    const tokenIn = row.tokenIn.toLowerCase();
    const tokenOut = row.tokenOut.toLowerCase();
    const amountIn = BigInt(row.amountInWei);
    const amountOut = BigInt(row.amountOutWei);
    if (tokenIn === cashKey && tokenOut !== cashKey) {
      held[tokenOut] = (held[tokenOut] ?? 0n) + amountOut;
      basis[tokenOut] = (basis[tokenOut] ?? 0n) + amountIn;
      continue;
    }
    if (tokenOut === cashKey && tokenIn !== cashKey) {
      const currentHeld = held[tokenIn] ?? 0n;
      const currentBasis = basis[tokenIn] ?? 0n;
      const soldBasis = currentHeld > 0n ? (currentBasis * amountIn) / currentHeld : 0n;
      const remaining = currentHeld > amountIn ? currentHeld - amountIn : 0n;
      const remainingBasis = currentBasis > soldBasis ? currentBasis - soldBasis : 0n;
      if (remaining === 0n) {
        delete held[tokenIn];
        delete basis[tokenIn];
      } else {
        held[tokenIn] = remaining;
        basis[tokenIn] = remainingBasis;
      }
    }
  }
  const tokenExposureByToken: Record<string, bigint> = {};
  let totalExposure = 0n;
  for (const [token, amountText] of Object.entries(positions)) {
    const amount = BigInt(amountText);
    if (amount <= 0n) continue;
    const reconstructedAmount = held[token] ?? 0n;
    const reconstructedBasis = basis[token] ?? 0n;
    if (reconstructedAmount === amount && reconstructedBasis > 0n) {
      tokenExposureByToken[token] = reconstructedBasis;
      totalExposure += reconstructedBasis;
    }
  }
  return { totalExposure, tokenExposureByToken };
}
async function authorizePaperTrade(env: Env, config: ReturnType<typeof getConfig>, trade: TradeRequest): Promise<Response | null> {
  const portfolio = await getPaperPortfolio(env, config);
  const history = await getPaperTrades(env);
  const derived = deriveExposureFromTrades(history.trades, config.paperCashToken, portfolio.positions);
  const isBuy = trade.tokenIn.toLowerCase() === config.paperCashToken.toLowerCase();
  const riskToken = (isBuy ? trade.tokenOut : trade.tokenIn).toLowerCase();
  const tokenExposure = derived.tokenExposureByToken[riskToken] ?? 0n;
  const limits = config.risk;
  const response = await riskStub(env).fetch(new Request("https://jarvis-risk/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cashToken: config.paperCashToken,
      trade: { ...trade, amountInWei: trade.amountInWei.toString(), amountOutWei: trade.amountOutWei.toString() },
      context: {
        currentExposureWei: derived.totalExposure.toString(),
        tokenExposureWei: tokenExposure.toString(),
        openPositions: Object.keys(portfolio.positions).length,
        nowMs: Date.now()
      },
      limits: {
        maxTradeWei: limits.maxTradeWei.toString(), maxPortfolioExposureWei: limits.maxPortfolioExposureWei.toString(), maxTokenExposureWei: limits.maxTokenExposureWei.toString(),
        maxOpenPositions: limits.maxOpenPositions, maxTradesPerDay: limits.maxTradesPerDay, cooldownSeconds: limits.cooldownSeconds, maxDailyLossWei: limits.maxDailyLossWei.toString()
      }
    })
  }));
  return response.ok ? null : response;
}
async function runPaperCycle(env: Env, config: ReturnType<typeof getConfig>) {
  const missing: string[] = [];
  if (config.mode !== "paper") missing.push("TRADING_MODE=paper");
  if (!config.zeroExApiKey) missing.push("ZEROEX_API_KEY");
  if (!config.paperTakerAddress) missing.push("PAPER_TAKER_ADDRESS");
  if (!config.gemini.primaryKey) missing.push("GEMINI_API_KEY");
  if (missing.length > 0) return { executed: false, reason: "Paper automation is not fully configured.", missing };
  let result: Awaited<ReturnType<typeof evaluateAutomation>>;
  try {
    result = await evaluateAutomation({
      gemini: [{ role: "primary", apiKey: config.gemini.primaryKey, model: config.gemini.primaryModel }, { role: "fallback1", apiKey: config.gemini.fallback1Key, model: config.gemini.fallback1Model }, { role: "fallback2", apiKey: config.gemini.fallback2Key, model: config.gemini.fallback2Model }],
      strategy: { ...config.strategy, cashToken: config.paperCashToken, uniswapApiKey: env.UNISWAP_API_KEY, theGraphApiKey: config.strategy.theGraphApiKey, theGraphUniswapV3SubgraphId: config.strategy.theGraphUniswapV3SubgraphId },
      zeroExApiKey: config.zeroExApiKey, takerAddress: config.paperTakerAddress, cashToken: config.paperCashToken, quoteAmountWei: config.strategy.quoteAmountWei,
      slippageBps: config.strategy.slippageBps, risk: config.risk, allowQuoteBalanceIssues: config.strategy.allowQuoteBalanceIssues
    });
  } catch (error) { throw new Error(`strategy/evaluateAutomation: ${error instanceof Error ? error.message : "unknown error"}`); }
  if (!result.trade) return { executed: false, reason: result.blockedReason ?? "No trade selected." };
  const validation = validateTrade(result.trade, config.risk); if (validation) return { executed: false, reason: validation };
  let riskResponse: Response | null;
  try { riskResponse = await authorizePaperTrade(env, config, result.trade); } catch (error) { throw new Error(`paper/authorizeRisk: ${error instanceof Error ? error.message : "unknown error"}`); }
  if (riskResponse) { const body = await riskResponse.json() as { reason?: string; error?: string }; return { executed: false, reason: body.reason ?? body.error ?? "Risk gate blocked trade." }; }
  let response: Response;
  try {
    response = await stateStub(env).fetch(new Request(`https://jarvis.internal/paper/trade?cashToken=${config.paperCashToken}&startingCashWei=${config.paperStartingCashWei}`, {
      method: "POST", body: JSON.stringify(result.trade, (_, value) => typeof value === "bigint" ? value.toString() : value), headers: { "content-type": "application/json" }
    }));
  } catch (error) { throw new Error(`paper/execute: ${error instanceof Error ? error.message : "unknown error"}`); }
  return { executed: response.ok, trade: result.trade };
}

export { TradingBotState, RiskState };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return json({ ok: true });
    const url = new URL(request.url);
    if (url.pathname === "/strategy/run" && request.method === "POST") {
      try { const config = getConfig(env); return json({ ok: true, ...(await runPaperCycle(env, config)) }); }
      catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "Strategy run failed." }, { status: 503 }); }
    }
    try {
      const config = getConfig(env);
      if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, mode: config.mode, liveTradingEnabled: config.liveTradingEnabled, geminiFallbacksConfigured: [Boolean(config.gemini.primaryKey), Boolean(config.gemini.fallback1Key), Boolean(config.gemini.fallback2Key)].filter(Boolean).length, configuration: { geminiPrimaryConfigured: Boolean(config.gemini.primaryKey), geminiFallback1Configured: Boolean(config.gemini.fallback1Key), geminiFallback2Configured: Boolean(config.gemini.fallback2Key), zeroExConfigured: Boolean(config.zeroExApiKey), paperTakerConfigured: Boolean(config.paperTakerAddress), theGraphConfigured: Boolean(config.strategy.theGraphApiKey), theGraphSecretSource: config.strategy.theGraphApiKeySource } });
      if (url.pathname === "/diagnostics/graph" && request.method === "GET") { const provider = new TheGraphMarketDataProvider(config.strategy.theGraphApiKey ?? "", config.strategy.theGraphUniswapV3SubgraphId); return json(await provider.diagnose()); }
      if (url.pathname === "/risk/state" && request.method === "GET") return riskStub(env).fetch("https://jarvis-risk/state");
      if (url.pathname === "/risk/kill-switch" && request.method === "POST") return riskStub(env).fetch(new Request("https://jarvis-risk/kill-switch", request));
      if (url.pathname === "/trade" && request.method === "POST") {
        if (config.mode === "live") return json({ ok: false, error: "Live execution is fail-closed until wallet-level persistent exposure accounting is enabled." }, { status: 503 });
        try { const trade = parseTrade(await request.json() as TradePayload); const basic = validateTrade(trade, config.risk); if (basic) return json({ ok: false, error: basic }, { status: 400 }); const riskResponse = await authorizePaperTrade(env, config, trade); if (riskResponse) return riskResponse; return legacy.fetch(new Request(request, { body: JSON.stringify({ ...trade, amountInWei: trade.amountInWei.toString(), amountOutWei: trade.amountOutWei.toString() }), headers: request.headers } as Request), env); }
        catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "Invalid trade payload." }, { status: 400 }); }
      }
      return legacy.fetch(request, env);
    } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "Worker request failed." }, { status: 503 }); }
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> { const config = getConfig(env); if (config.mode === "paper") await runPaperCycle(env, config); }
};