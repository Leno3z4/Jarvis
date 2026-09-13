import type { Portfolio, TradeRequest } from "./types";

export interface PortfolioState {
  cashToken: `0x${string}`;
  cashWei: bigint;
  positions: Record<string, bigint>;
  costBasisWei: Record<string, bigint>;
  realizedPnlWei: bigint;
}

const key = (address: `0x${string}`) => address.toLowerCase();

export function toPortfolio(state: PortfolioState): Portfolio {
  return {
    cashWei: state.cashWei,
    positions: { ...state.positions },
    costBasisWei: { ...state.costBasisWei },
    realizedPnlWei: state.realizedPnlWei
  };
}

export function applyPaperFill(state: PortfolioState, request: TradeRequest, amountOutWei: bigint): PortfolioState {
  if (amountOutWei <= 0n) throw new Error("Paper fill amount must be positive.");

  const inputKey = key(request.tokenIn);
  const outputKey = key(request.tokenOut);
  const cashKey = key(state.cashToken);
  const inputBalance = inputKey === cashKey ? state.cashWei : (state.positions[inputKey] ?? 0n);
  if (inputBalance < request.amountInWei) throw new Error("Insufficient paper balance.");

  const next: PortfolioState = {
    cashToken: state.cashToken,
    cashWei: state.cashWei,
    positions: { ...state.positions },
    costBasisWei: { ...state.costBasisWei },
    realizedPnlWei: state.realizedPnlWei
  };

  if (inputKey === cashKey) {
    next.cashWei -= request.amountInWei;
    next.positions[outputKey] = (next.positions[outputKey] ?? 0n) + amountOutWei;
    next.costBasisWei[outputKey] = (next.costBasisWei[outputKey] ?? 0n) + request.amountInWei;
    return next;
  }

  next.positions[inputKey] = inputBalance - request.amountInWei;
  const totalCost = next.costBasisWei[inputKey] ?? 0n;
  const positionCost = inputBalance === 0n ? 0n : (totalCost * request.amountInWei) / inputBalance;
  next.costBasisWei[inputKey] = totalCost - positionCost;
  if (next.positions[inputKey] === 0n) {
    delete next.positions[inputKey];
    delete next.costBasisWei[inputKey];
  }

  if (outputKey === cashKey) {
    next.cashWei += amountOutWei;
    next.realizedPnlWei += amountOutWei - positionCost;
  } else {
    next.positions[outputKey] = (next.positions[outputKey] ?? 0n) + amountOutWei;
    next.costBasisWei[outputKey] = (next.costBasisWei[outputKey] ?? 0n) + request.amountInWei;
  }

  return next;
}
