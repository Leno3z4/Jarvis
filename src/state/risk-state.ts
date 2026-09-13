import type { RiskLimits, RiskState, TradeRequest } from "../trading/types";
import { evaluateRisk, dayKeyUtc, type TradeContext } from "../trading/risk";

interface RiskPayload {
  trade: {
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    amountInWei: string;
    amountOutWei: string;
    slippageBps: number;
    reason: string;
    idempotencyKey?: string;
  };
  context: {
    currentExposureWei: string;
    tokenExposureWei: string;
    openPositions: number;
    nowMs: number;
  };
  limits: {
    maxTradeWei: string;
    maxPortfolioExposureWei: string;
    maxTokenExposureWei: string;
    maxOpenPositions: number;
    maxTradesPerDay: number;
    cooldownSeconds: number;
    maxDailyLossWei: string;
  };
}

function defaultState(): RiskState {
  return {
    killSwitch: false,
    dayKey: dayKeyUtc(),
    dailyLossWei: 0n,
    dailyTrades: 0,
    lastTradeAtByToken: {}
  };
}

function resetDay(state: RiskState, nowMs: number): RiskState {
  const key = dayKeyUtc(new Date(nowMs));
  if (state.dayKey === key) return state;
  return { ...defaultState(), dayKey: key, killSwitch: state.killSwitch };
}

function readState(sql: SqlStorage, nowMs: number): RiskState {
  const rows = sql.exec<{ key: string; value: string }>("SELECT key, value FROM risk_meta").toArray();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const cooldowns = JSON.parse(values.get("last_trade_at_by_token") ?? "{}") as Record<string, number>;
  return {
    killSwitch: values.get("kill_switch") === "1",
    dayKey: values.get("day_key") ?? dayKeyUtc(new Date(nowMs)),
    dailyLossWei: BigInt(values.get("daily_loss_wei") ?? "0"),
    dailyTrades: Number(values.get("daily_trades") ?? "0"),
    lastTradeAtByToken: cooldowns
  };
}

function writeState(sql: SqlStorage, state: RiskState): void {
  sql.exec("INSERT OR REPLACE INTO risk_meta(key, value) VALUES ('kill_switch', ?)", state.killSwitch ? "1" : "0");
  sql.exec("INSERT OR REPLACE INTO risk_meta(key, value) VALUES ('day_key', ?)", state.dayKey);
  sql.exec("INSERT OR REPLACE INTO risk_meta(key, value) VALUES ('daily_loss_wei', ?)", state.dailyLossWei.toString());
  sql.exec("INSERT OR REPLACE INTO risk_meta(key, value) VALUES ('daily_trades', ?)", String(state.dailyTrades));
  sql.exec("INSERT OR REPLACE INTO risk_meta(key, value) VALUES ('last_trade_at_by_token', ?)", JSON.stringify(state.lastTradeAtByToken));
}

function parseLimits(value: RiskPayload["limits"]): RiskLimits {
  return {
    maxTradeWei: BigInt(value.maxTradeWei),
    maxPortfolioExposureWei: BigInt(value.maxPortfolioExposureWei),
    maxTokenExposureWei: BigInt(value.maxTokenExposureWei),
    maxOpenPositions: value.maxOpenPositions,
    maxTradesPerDay: value.maxTradesPerDay,
    cooldownSeconds: value.cooldownSeconds,
    maxDailyLossWei: BigInt(value.maxDailyLossWei)
  };
}

function parseTrade(value: RiskPayload["trade"]): TradeRequest {
  return {
    tokenIn: value.tokenIn,
    tokenOut: value.tokenOut,
    amountInWei: BigInt(value.amountInWei),
    amountOutWei: BigInt(value.amountOutWei),
    slippageBps: value.slippageBps,
    reason: value.reason,
    idempotencyKey: value.idempotencyKey
  };
}

export class RiskState {
  private readonly sql: SqlStorage;

  constructor(state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS risk_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS risk_idempotency (
        key TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
    `);
    writeState(this.sql, readState(this.sql, Date.now()));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const nowMs = Date.now();
    let state = resetDay(readState(this.sql, nowMs), nowMs);
    if (state.dayKey !== readState(this.sql, nowMs).dayKey) writeState(this.sql, state);

    if (url.pathname === "/health") return Response.json({ ok: true, killSwitch: state.killSwitch });

    if (url.pathname === "/state" && request.method === "GET") {
      return Response.json({
        killSwitch: state.killSwitch,
        dayKey: state.dayKey,
        dailyLossWei: state.dailyLossWei.toString(),
        dailyTrades: state.dailyTrades,
        lastTradeAtByToken: state.lastTradeAtByToken
      });
    }

    if (url.pathname === "/kill-switch" && request.method === "POST") {
      const body = await request.json() as { enabled: boolean };
      state = { ...state, killSwitch: Boolean(body.enabled) };
      writeState(this.sql, state);
      return Response.json({ ok: true, killSwitch: state.killSwitch });
    }

    if (url.pathname === "/authorize" && request.method === "POST") {
      const payload = await request.json() as RiskPayload;
      const trade = parseTrade(payload);
      const limits = parseLimits(payload.limits);
      const context: TradeContext = payload.context;
      const check = evaluateRisk(trade, limits, state, context);
      if (!check.ok) return Response.json({ ok: false, reason: check.reason }, { status: 409 });

      if (trade.idempotencyKey) {
        const existing = this.sql.exec("SELECT key FROM risk_idempotency WHERE key = ?", trade.idempotencyKey).one();
        if (existing) return Response.json({ ok: false, reason: "Duplicate idempotency key." }, { status: 409 });
        this.sql.exec("INSERT INTO risk_idempotency(key, created_at) VALUES (?, ?)", trade.idempotencyKey, nowMs);
      }

      const token = trade.tokenOut.toLowerCase();
      state = {
        ...state,
        dailyTrades: state.dailyTrades + 1,
        lastTradeAtByToken: { ...state.lastTradeAtByToken, [token]: nowMs }
      };
      writeState(this.sql, state);
      return Response.json({ ok: true, state: { dailyTrades: state.dailyTrades } });
    }

    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }
}
