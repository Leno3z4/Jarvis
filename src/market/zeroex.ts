import type { Quote, QuoteProvider, QuoteRequest } from "./types";

const ZEROEX_URL = "https://api.0x.org/swap/allowance-holder/quote";

interface ZeroExQuoteResponse {
  blockNumber?: string | null;
  buyAmount?: string | null;
  buyToken?: string | null;
  sellAmount?: string | null;
  sellToken?: string | null;
  gas?: string | null;
  gasPrice?: string | null;
  transaction?: {
    to?: string | null;
    data?: string | null;
    value?: string | null;
    gas?: string | null;
    gasPrice?: string | null;
  };
  liquidityAvailable?: boolean;
  allowanceTarget?: string;
  issues?: {
    allowance?: { actual: string; spender: string; required?: string } | null;
    balance?: { token: string; actual: string; expected: string } | null;
    simulationIncomplete?: boolean;
  };
}

function parsePositiveBigInt(value: string | null | undefined, field: string): bigint {
  if (value == null || value.trim() === "") {
    throw new Error(`0x quote missing ${field}.`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`0x quote returned invalid ${field}: ${value}.`);
  }
}

function parseOptionalBigInt(value: string | null | undefined, field: string): bigint | undefined {
  if (value == null || value.trim() === "") return undefined;
  try {
    return BigInt(value);
  } catch {
    throw new Error(`0x quote returned invalid ${field}: ${value}.`);
  }
}

export interface ExecutableQuote extends Quote {
  transaction: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
    gas?: bigint;
    gasPrice?: bigint;
  };
  allowanceTarget?: `0x${string}`;
  allowanceRequired?: bigint;
  balanceIssue?: boolean;
  simulationIncomplete?: boolean;
}

export class ZeroExQuoteProvider implements QuoteProvider {
  constructor(
    private readonly apiKey: string,
    private readonly taker?: `0x${string}`,
    private readonly chainId = 8453,
    private readonly rejectBalanceIssue = true
  ) {}

  async getQuote(request: QuoteRequest): Promise<ExecutableQuote> {
    if (!this.apiKey) throw new Error("0x API key is not configured.");
    if (!this.taker) throw new Error("0x taker address is required for firm quotes.");

    const params = new URLSearchParams({
      chainId: String(this.chainId),
      sellToken: request.tokenIn,
      buyToken: request.tokenOut,
      sellAmount: request.amountInWei.toString(),
      taker: this.taker,
      slippageBps: String(request.slippageBps)
    });

    const response = await fetch(`${ZEROEX_URL}?${params.toString()}`, {
      headers: {
        "0x-api-key": this.apiKey,
        "0x-version": "v2",
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`0x quote failed (${response.status}): ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as ZeroExQuoteResponse;
    if (data.liquidityAvailable === false) {
      throw new Error("0x reports no liquidity for this route.");
    }
    if (this.rejectBalanceIssue && data.issues?.balance) {
      throw new Error(
        `0x reports insufficient taker balance (actual=${data.issues.balance.actual}, expected=${data.issues.balance.expected}).`
      );
    }

    const buyAmount = parsePositiveBigInt(data.buyAmount, "buyAmount");
    const sellAmount = parsePositiveBigInt(data.sellAmount, "sellAmount");
    const transactionTo = data.transaction?.to;
    const transactionData = data.transaction?.data;
    if (!transactionTo || !transactionData) {
      throw new Error("0x returned no executable transaction.");
    }

    const gas = parseOptionalBigInt(data.transaction?.gas, "transaction.gas");
    const gasPrice = parseOptionalBigInt(data.transaction?.gasPrice, "transaction.gasPrice");
    const topGas = parseOptionalBigInt(data.gas, "gas");
    const topGasPrice = parseOptionalBigInt(data.gasPrice, "gasPrice");
    const transactionValue = parseOptionalBigInt(data.transaction?.value, "transaction.value") ?? 0n;

    const allowance = data.issues?.allowance ?? null;
    const spender = allowance?.spender ?? data.allowanceTarget;

    return {
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountInWei: sellAmount,
      amountOutWei: buyAmount,
      priceImpactBps: 0,
      estimatedGasWei: gas && gasPrice
        ? gas * gasPrice
        : topGas && topGasPrice
          ? topGas * topGasPrice
          : undefined,
      provider: "0x",
      observedAt: Date.now(),
      transaction: {
        to: transactionTo as `0x${string}`,
        data: transactionData as `0x${string}`,
        value: transactionValue,
        gas,
        gasPrice
      },
      allowanceTarget: spender as `0x${string}` | undefined,
      allowanceRequired: allowance?.required
        ? parsePositiveBigInt(allowance.required, "allowance.required")
        : undefined,
      balanceIssue: Boolean(data.issues?.balance),
      simulationIncomplete: Boolean(data.issues?.simulationIncomplete)
    };
  }
}
