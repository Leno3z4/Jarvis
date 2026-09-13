export type TradingMode = "paper" | "live";
export type Side = "buy" | "sell";

export interface TradeRequest {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInWei: bigint;
  amountOutWei: bigint;
  slippageBps: number;
  reason: string;
  idempotencyKey?: string;
}

export interface TradeResult {
  mode: TradingMode;
  status: "simulated" | "submitted" | "rejected";
  txHash?: `0x${string}`;
  request: TradeRequest;
  amountOutWei?: bigint;
  message?: string;
}

export interface Portfolio {
  cashWei: bigint;
  positions: Record<string, bigint>;
  realizedPnlWei: bigint;
}

export interface RiskLimits {
  maxTradeWei: bigint;
  maxPortfolioExposureWei: bigint;
  maxTokenExposureWei: bigint;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  cooldownSeconds: number;
  maxDailyLossWei: bigint;
}

export interface RiskState {
  killSwitch: boolean;
  dayKey: string;
  dailyLossWei: bigint;
  dailyTrades: number;
  lastTradeAtByToken: Record<string, number>;
}
