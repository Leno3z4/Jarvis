import type { Portfolio, TradeRequest } from "./types";

export interface PortfolioState {
  cashToken: `0x${string}`;
  cashWei: bigint;
  positions: Record<string, bigint>;
  realizedPnlWei: bigint;
}

function addressKey(address: `0x${string}`): string {
  return address.toLowerCase();
}

export function toPortfolio(state: PortfolioState): Portfolio {
  return {
    cashWei: state.cashWei,
    positions: { ...state.positions },
    realizedPnlWei: state.realizedPnlWei
  };
}

export function applyPaperFill(
  state: PortfolioState,
  request: TradeRequest,
  amountOutWei: bigint
): PortfolioState {
  if (amountOutWei <= 0n) throw new Error("Paper fill amount must be positive.");

  const inputKey = addressKey(request.tokenIn);
  const outputKey = addressKey(request.tokenOut);
  const inputBalance = inputKey === addressKey(state.cashToken)
    ? state.cashWei
    : (state.positions[inputKey] ?? 0n);

  if (inputBalance < request.amountInWei) {
    throw new Error("Insufficient paper balance.");
  }

  const next: PortfolioState = {
    cashToken: state.cashToken,
    cashWei: state.cashWei,
    positions: { ...state.positions },
    realizedPnlWei: state.realizedPnlWei
  };

  if (inputKey === addressKey(next.cashToken)) {
    next.cashWei -= request.amountInWei;
  } else {
    next.positions[inputKey] = inputBalance - request.amountInWei;
    if (next.positions[inputKey] === 0n) delete next.positions[inputKey];
  }

  if (outputKey === addressKey(next.cashToken)) {
    next.cashWei += amountOutWei;
    if (inputKey !== addressKey(next.cashToken)) {
      next.realizedPnlWei += amountOutWei - request.amountInWei;
    }
  } else {
    next.positions[outputKey] = (next.positions[outputKey] ?? 0n) + amountOutWei;
  }

  return next;
}
