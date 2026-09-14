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
  } | null;
  liquidityAvailable?: boolean;
  allowanceTarget?: string | null;
  issues?: {
    allowance?: { actual?: string; spender?: string; required?: string | null } | null;
    balance?: { token?: string; actual?: string; expected?: string } | null;
    simulationIncomplete?: boolean;
  };
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

function requiredBigInt(value: unknown, field: string): bigint {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`0x response missing ${field}.`);
  }
  const text = String(value).trim();
  if (!text) throw new Error(`0x response missing ${field}.`);
  try {
    return BigInt(text);
  } catch {
    throw new Error(`0x response returned invalid ${field}: ${text.slice(0, 80)}`);
  }
}

function optionalBigInt(value: unknown, field: string): bigint | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredBigInt(value, field);
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
      const actual = data.issues.balance.actual ?? "unknown";
      const expected = data.issues.balance.expected ?? "unknown";
      throw new Error(`0x reports insufficient taker balance (actual=${actual}, expected=${expected}).`);
    }

    const transaction = data.transaction;
    if (!transaction?.to || !transaction.data) {
      throw new Error("0x returned no executable transaction.");
    }

    const sellAmount = requiredBigInt(data.sellAmount, "sellAmount");
    const buyAmount = requiredBigInt(data.buyAmount, "buyAmount");
    if (sellAmount <= 0n) throw new Error("0x returned a non-positive sellAmount.");
    if (buyAmount <= 0n) throw new Error("0x returned a non-positive buyAmount.");

    const allowance = data.issues?.allowance ?? null;
    const spender = allowance?.spender ?? data.allowanceTarget ?? undefined;
    const allowanceRequired = allowance?.required !== undefined && allowance?.required !== null
      ? optionalBigInt(allowance.required, "issues.allowance.required")
      : undefined;

    return {
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountInWei: sellAmount,
      amountOutWei: buyAmount,
      priceImpactBps: 0,
      estimatedGasWei: data.gas && data.gasPrice
        ? requiredBigInt(data.gas, "gas") * requiredBigInt(data.gasPrice, "gasPrice")
        : undefined,
      provider: "0x",
      observedAt: Date.now(),
      transaction: {
        to: transaction.to as `0x${string}`,
        data: transaction.data as `0x${string}`,
        value: requiredBigInt(transaction.value ?? "0", "transaction.value"),
        gas: optionalBigInt(transaction.gas, "transaction.gas"),
        gasPrice: optionalBigInt(transaction.gasPrice, "transaction.gasPrice")
      },
      allowanceTarget: spender as `0x${string}` | undefined,
      allowanceRequired,
      balanceIssue: Boolean(data.issues?.balance),
      simulationIncomplete: Boolean(data.issues?.simulationIncomplete)
    };
  }
}
