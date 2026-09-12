export type TradingMode = "paper" | "live";
export type Side = "buy" | "sell";

export interface TradeRequest {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInWei: bigint;
  slippageBps: number;
  reason: string;
}

export interface TradeResult {
  mode: TradingMode;
  status: "simulated" | "submitted" | "rejected";
  txHash?: `0x${string}`;
  request: TradeRequest;
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
}
