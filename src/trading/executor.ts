import { BaseLiveExecutor, type LiveExecutionConfig } from "./live";
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
      amountOutWei: request.amountOutWei,
      message: "Paper execution is handled by the persistent portfolio layer."
    };
  }
}

export class LiveExecutor implements TradeExecutor {
  constructor(private readonly config: LiveExecutionConfig) {}

  async execute(request: TradeRequest): Promise<TradeResult> {
    try {
      return await new BaseLiveExecutor().execute(request, this.config);
    } catch (error) {
      return {
        mode: "live",
        status: "rejected",
        request,
        message: error instanceof Error ? error.message : "Live execution failed."
      };
    }
  }
}
