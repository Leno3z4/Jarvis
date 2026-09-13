import legacy from "./index";
import { TradingBotState } from "./state/bot-state";
import { RiskState } from "./state/risk-state";
import { getConfig, type Env } from "./config";
import { evaluateAutomation } from "./strategy/automation";
import { validateTrade } from "./trading/risk";
import type { TradeRequest } from "./trading/types";

interface TradePayload {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInWei: string;
  amountOutWei: string;
  slippageBps: number;
  reason: string;
  idempotencyKey?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization"
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return Response.json(body, { ...init, headers });
}

function parseTrade(body: TradePayload): TradeRequest {
  return {
    tokenIn: body.tokenIn,
    tokenOut: body.tokenOut,
    amountInWei: BigInt(body.amountInWei),
    amountOutWei: BigInt(body.amountOutWei),
    slippageBps: body.slippageBps,
    reason: body.reason,
    idempotencyKey: body.idempotencyKey
  };
}

function stateStub(env: Env) {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName("main"));
}

function riskStub(env: Env) {
  return env.RISK_STATE.get(env.RISK_STATE.idFromName("main"));
}

async function getPaperPortfolio(env: Env, config: ReturnType<typeof getConfig>) {
  const response = await stateStub(env).fetch(
    `https://jarvis.internal/portfolio?cashToken=${config.paperCashToken}&startingCashWei=${config.paperStartingCashWei}`
  );
  if (!response.ok) throw new Error("Portfolio state unavailable.");
  return response.json() as Promise<{
    cashWei: string;
    positions: Record<string, string>;
    costBasisWei?: Record<string, string>;
    realizedPnlWei: string;
  }>;
}

async function authorizePaperTrade(
  env: Env,
  config: ReturnType<typeof getConfig>,
  trade: TradeRequest
): Promise<Response | null> {
  const portfolio = await getPaperPortfolio(env, config);
  const exposure = Object.values(portfolio.positions).reduce(
    (sum, value) => sum + BigInt(value),
    0n
  );
  const tokenExposure = BigInt(
    portfolio.positions[trade.tokenOut.toLowerCase()] ?? "0"
  );
  const limits = config.risk;

  const response = await riskStub(env).fetch(
    new Request("https://jarvis-risk/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trade: {
          ...trade,
          amountInWei: trade.amountInWei.toString(),
          amountOutWei: trade.amountOutWei.toString()
        },
        context: {
          currentExposureWei: exposure.toString(),
          tokenExposureWei: tokenExposure.toString(),
          openPositions: Object.keys(portfolio.positions).length,
          nowMs: Date.now()
        },
        limits: {
          maxTradeWei: limits.maxTradeWei.toString(),
          maxPortfolioExposureWei:
            limits.maxPortfolioExposureWei.toString(),
          maxTokenExposureWei: limits.maxTokenExposureWei.toString(),
          maxOpenPositions: limits.maxOpenPositions,
          maxTradesPerDay: limits.maxTradesPerDay,
          cooldownSeconds: limits.cooldownSeconds,
          maxDailyLossWei: limits.maxDailyLossWei.toString()
        }
      })
    })
  );

  return response.ok ? null : response;
}

async function runPaperCycle(
  env: Env,
  config: ReturnType<typeof getConfig>
) {
  if (
    config.mode !== "paper" ||
    !config.zeroExApiKey ||
    !config.paperTakerAddress ||
    !config.gemini.primaryKey
  ) {
    return {
      executed: false,
      reason: "Paper automation is not fully configured."
    };
  }

  const result = await evaluateAutomation({
    gemini: [
      {
        role: "primary",
        apiKey: config.gemini.primaryKey,
        model: config.gemini.primaryModel
      },
      {
        role: "fallback1",
        apiKey: config.gemini.fallback1Key,
        model: config.gemini.fallback1Model
      },
      {
        role: "fallback2",
        apiKey: config.gemini.fallback2Key,
        model: config.gemini.fallback2Model
      }
    ],
    strategy: {
      ...config.strategy,
      cashToken: config.paperCashToken
    },
    zeroExApiKey: config.zeroExApiKey,
    takerAddress: config.paperTakerAddress,
    cashToken: config.paperCashToken,
    quoteAmountWei: config.strategy.quoteAmountWei,
    slippageBps: config.strategy.slippageBps,
    risk: config.risk
  });

  if (!result.trade) {
    return {
      executed: false,
      reason: result.blockedReason ?? "No trade selected."
    };
  }

  const validation = validateTrade(result.trade, config.risk);
  if (validation) return { executed: false, reason: validation };

  const riskResponse = await authorizePaperTrade(
    env,
    config,
    result.trade
  );
  if (riskResponse) {
    return {
      executed: false,
      reason:
        (await riskResponse.json() as { reason?: string }).reason ??
        "Risk gate blocked trade."
    };
  }

  const response = await stateStub(env).fetch(
    new Request(
      `https://jarvis.internal/paper/trade?cashToken=${config.paperCashToken}&startingCashWei=${config.paperStartingCashWei}`,
      {
        method: "POST",
        body: JSON.stringify(
          result.trade,
          (_, value) => typeof value === "bigint" ? value.toString() : value
        ),
        headers: { "content-type": "application/json" }
      }
    )
  );
  return { executed: response.ok, trade: result.trade };
}

export { TradingBotState, RiskState };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return json({ ok: true });

    const url = new URL(request.url);
    const config = getConfig(env);

    if (
      url.pathname === "/risk/state" &&
      request.method === "GET"
    ) {
      return riskStub(env).fetch("https://jarvis-risk/state");
    }

    if (
      url.pathname === "/risk/kill-switch" &&
      request.method === "POST"
    ) {
      return riskStub(env).fetch(
        new Request("https://jarvis-risk/kill-switch", request)
      );
    }

    if (
      url.pathname === "/strategy/run" &&
      request.method === "POST"
    ) {
      try {
        return json({
          ok: true,
          ...(await runPaperCycle(env, config))
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Strategy run failed."
          },
          { status: 503 }
        );
      }
    }

    if (url.pathname === "/trade" && request.method === "POST") {
      try {
        if (config.mode === "live") {
          return json(
            {
              ok: false,
              error:
                "Live execution is fail-closed until wallet-level persistent exposure accounting is enabled."
            },
            { status: 503 }
          );
        }

        const trade = parseTrade(
          await request.json() as TradePayload
        );
        const basic = validateTrade(trade, config.risk);
        if (basic) {
          return json({ ok: false, error: basic }, { status: 400 });
        }

        const riskResponse = await authorizePaperTrade(
          env,
          config,
          trade
        );
        if (riskResponse) return riskResponse;

        return legacy.fetch(
          new Request(request, {
            body: JSON.stringify({
              ...trade,
              amountInWei: trade.amountInWei.toString(),
              amountOutWei: trade.amountOutWei.toString()
            }),
            headers: request.headers
          } as Request),
          env
        );
      } catch {
        return json(
          { ok: false, error: "Invalid trade payload." },
          { status: 400 }
        );
      }
    }

    return legacy.fetch(request, env);
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env
  ): Promise<void> {
    const config = getConfig(env);
    if (config.mode === "paper") {
      await runPaperCycle(env, config);
    }
  }
};
