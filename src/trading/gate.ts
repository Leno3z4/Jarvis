import type { RiskLimits } from "./types";
import type { StrategyDecision } from "../strategy/decision";

export interface ExecutionGateInput {
  decision: StrategyDecision;
  amountInWei: bigint;
  currentExposureWei: bigint;
  cashToken?: `0x${string}`;
}

export function evaluateExecutionGate(input: ExecutionGateInput, limits: RiskLimits): string | null {
  if (input.decision.decision !== "BUY" && input.decision.decision !== "SELL") return "Decision is not executable.";
  if (input.decision.confidence < 0.7) return "Confidence below hard execution floor.";
  if (input.decision.risk === "HIGH") return "High-risk decisions are blocked by the hard gate.";
  if (input.amountInWei <= 0n) return "Execution amount must be positive.";

  const isSell = input.decision.decision === "SELL" && input.cashToken !== undefined;
  if (isSell) return null;

  if (input.amountInWei > limits.maxTradeWei) return "Execution amount exceeds max trade size.";
  if (input.currentExposureWei + input.amountInWei > limits.maxPortfolioExposureWei) return "Portfolio exposure limit would be exceeded.";
  return null;
}
