import type { TradeRequest, TradeResult } from "./types";

export interface TradeExecutor {
  execute(request: TradeRequest): Promise<TradeResult>;
}

export class PaperExecutor implements TradeExecutor {
  async execute(request: TradeRequest): Promise<TradeResult> {
    return {
      mode: "paper",
      status: "simulated",
      request,
      message: "Paper trade simulated; no blockchain transaction was submitted."
    };
  }
}

export class LiveExecutor implements TradeExecutor {
  async execute(request: TradeRequest): Promise<TradeResult> {
    // Intentionally fail closed until the live wallet + router are wired.
    // This prevents an accidental live transaction during development.
    return {
      mode: "live",
      status: "rejected",
      request,
      message: "Live execution is not enabled yet."
    };
  }
}

export function createExecutor(mode: "paper" | "live"): TradeExecutor {
  return mode === "paper" ? new PaperExecutor() : new LiveExecutor();
}
