import { getConfig, type Env } from "./config";
import { createExecutor } from "./trading/executor";
import { applyPaperFill } from "./trading/portfolio";
import { validateTrade } from "./trading/risk";
import type { Portfolio, TradeRequest } from "./trading/types";

interface TradePayload {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInWei: string;
  amountOutWei: string;
  slippageBps: number;
  reason: string;
}

function parseTradePayload(value: TradePayload): TradeRequest {
  return {
    tokenIn: value.tokenIn,
    tokenOut: value.tokenOut,
    amountInWei: BigInt(value.amountInWei),
    amountOutWei: BigInt(value.amountOutWei),
    slippageBps: value.slippageBps,
    reason: value.reason
  };
}

function serializeTrade(request: TradeRequest): TradePayload {
  return {
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountInWei: request.amountInWei.toString(),
    amountOutWei: request.amountOutWei.toString(),
    slippageBps: request.slippageBps,
    reason: request.reason
  };
}

function getStateStub(env: Env) {
  return env.BOT_STATE.get(env.BOT_STATE.idFromName("main"));
}

export class TradingBotState {
  private readonly state: DurableObjectState;
  private readonly sql: SqlStorage;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS balances (
        token TEXT PRIMARY KEY,
        amount TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_in TEXT NOT NULL,
        token_out TEXT NOT NULL,
        amount_in TEXT NOT NULL,
        amount_out TEXT NOT NULL,
        slippage_bps INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  private ensurePaperAccount(cashToken: `0x${string}`, startingCashWei: bigint): void {
    const existing = this.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'cash_token'")
      .one();

    if (!existing) {
      this.sql.exec(
        "INSERT INTO meta(key, value) VALUES ('cash_token', ?)",
        cashToken.toLowerCase()
      );
      this.sql.exec(
        "INSERT INTO balances(token, amount) VALUES (?, ?)",
        cashToken.toLowerCase(),
        startingCashWei.toString()
      );
      this.sql.exec("INSERT INTO meta(key, value) VALUES ('realized_pnl_wei', '0')");
    }
  }

  private portfolio(cashToken: `0x${string}`, startingCashWei: bigint): Portfolio {
    this.ensurePaperAccount(cashToken, startingCashWei);
    const balanceRows = this.sql
      .exec<{ token: string; amount: string }>("SELECT token, amount FROM balances")
      .toArray();
    const pnl = this.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'realized_pnl_wei'")
      .one();

    const positions: Record<string, bigint> = {};
    let cashWei = 0n;
    for (const row of balanceRows) {
      const amount = BigInt(row.amount);
      if (row.token === cashToken.toLowerCase()) cashWei = amount;
      else if (amount > 0n) positions[row.token] = amount;
    }

    return {
      cashWei,
      positions,
      realizedPnlWei: BigInt(pnl?.value ?? "0")
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cashToken = (url.searchParams.get("cashToken") ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
    const startingCashWei = BigInt(url.searchParams.get("startingCashWei") ?? "0");

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "jarvis-bot-state" });
    }

    if (url.pathname === "/portfolio" && request.method === "GET") {
      return Response.json(this.portfolio(cashToken, startingCashWei,));
    }

    if (url.pathname === "/paper/reset" && request.method === "POST") {
      this.sql.exec("DELETE FROM trades;");
      this.sql.exec("DELETE FROM balances;");
      this.sql.exec("DELETE FROM meta;");
      return Response.json(this.portfolio(cashToken, startingCashWei));
    }

    if (url.pathname === "/paper/trade" && request.method === "POST") {
      const payload = (await request.json()) as TradePayload;
      const trade = parseTradePayload(payload);
      this.ensurePaperAccount(cashToken, startingCashWei);

      const current = this.portfolio(cashToken, startingCashWei);
      const state = {
        cashToken,
        cashWei: current.cashWei,
        positions: current.positions,
        realizedPnlWei: current.realizedPnlWei
      };
      const next = applyPaperFill(state, trade, trade.amountOutWei);

      this.sql.exec("DELETE FROM balances;");
      this.sql.exec(
        "INSERT INTO balances(token, amount) VALUES (?, ?)",
        cashToken.toLowerCase(),
        next.cashWei.toString()
      );
      for (const [token, amount] of Object.entries(next.positions)) {
        this.sql.exec(
          "INSERT INTO balances(token, amount) VALUES (?, ?)",
          token,
          amount.toString()
        );
      }
      this.sql.exec(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('realized_pnl_wei', ?)",
        next.realizedPnlWei.toString()
      );
      this.sql.exec(
        "INSERT INTO trades(token_in, token_out, amount_in, amount_out, slippage_bps, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        trade.tokenIn.toLowerCase(),
        trade.tokenOut.toLowerCase(),
        trade.amountInWei.toString(),
        trade.amountOutWei.toString(),
        trade.slippageBps,
        trade.reason,
        new Date().toISOString()
      );

      return Response.json({
        ok: true,
        result: {
          mode: "paper",
          status: "simulated",
          request: trade,
          amountOutWei: trade.amountOutWei,
          message: "Paper fill persisted in Durable Object SQLite."
        }
      }, { headers: { "content-type": "application/json" } });
    }

    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const config = getConfig(env);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, mode: config.mode });
    }

    if (url.pathname === "/portfolio" && request.method === "GET") {
      return getStateStub(env).fetch(
        `https://jarvis.internal/portfolio?cashToken=${config.paperCashToken}&startingCashWei=${config.paperStartingCashWei}`
      );
    }

    if (url.pathname === "/paper/reset" && request.method === "POST") {
      if (config.mode !== "paper") {
        return Response.json({ ok: false, error: "Paper reset is only available in paper mode." }, { status: 409 });
      }
      return getStateStub(env).fetch(
        new Request(`https://jarvis.internal/paper/reset?cashToken=${config.paperCashToken}&startingCashWei=${config.paperStartingCashWei}`, { method: "POST" })
      );
    }

    if (url.pathname === "/trade" && request.method === "POST") {
      try {
        const trade = parseTradePayload((await request.json()) as TradePayload);
        const riskError = validateTrade(trade, config.risk);
        if (riskError) return Response.json({ ok: false, error: riskError }, { status: 400 });

        if (config.mode === "paper") {
          return getStateStub(env).fetch(
            new Request(
              `https://jarvis.internal/paper/trade?cashToken=${config.paperCashToken}&startingCashWei=${config.paperStartingCashWei}`,
              { method: "POST", body: JSON.stringify(serializeTrade(trade)), headers: { "content-type": "application/json" } }
            )
          );
        }

        const result = await createExecutor("live").execute(trade);
        return Response.json({ ok: result.status !== "rejected", result });
      } catch {
        return Response.json({ ok: false, error: "Invalid trade payload." }, { status: 400 });
      }
    }

    return Response.json({
      service: "Jarvis",
      mode: config.mode,
      endpoints: ["/health", "/portfolio", "POST /paper/reset", "POST /trade"]
    });
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await getStateStub(env).fetch("https://jarvis.internal/health");
  }
};
