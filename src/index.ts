import { getConfig, type Env } from "./config";
import { createExecutor } from "./trading/executor";
import { validateTrade } from "./trading/risk";
import type { TradeRequest } from "./trading/types";

export class TradingBotState {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(): Promise<Response> {
    return Response.json({ ok: true, service: "jarvis-bot-state" });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const config = getConfig(env);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, mode: config.mode });
    }

    if (url.pathname === "/trade" && request.method === "POST") {
      const trade = (await request.json()) as TradeRequest;
      const riskError = validateTrade(trade, config.risk);

      if (riskError) {
        return Response.json({ ok: false, error: riskError }, { status: 400 });
      }

      const result = await createExecutor(config.mode).execute(trade);
      return Response.json({ ok: result.status !== "rejected", result });
    }

    return Response.json({
      service: "Jarvis",
      mode: config.mode,
      endpoints: ["/health", "POST /trade"]
    });
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const id = env.BOT_STATE.idFromName("main");
    const stub = env.BOT_STATE.get(id);
    await stub.fetch("https://jarvis.internal/health");
  }
};
