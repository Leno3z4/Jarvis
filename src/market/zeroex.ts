import type { Quote, QuoteProvider, QuoteRequest } from "./types";

const ZEROEX_URL = "https://api.0x.org/swap/allowance-holder/quote";

interface ZeroExQuoteResponse {
  blockNumber?: string | null;
  buyAmount: string;
  buyToken: string;
  sellAmount: string;
  sellToken: string;
  gas?: string;
  gasPrice?: string;
  transaction?: {
    to: string;
    data: string;
    value: string;
    gas?: string;
    gasPrice?: string;
  };
  liquidityAvailable?: boolean;
  allowanceTarget?: string;
  issues?: {
    allowance?: { actual: string; spender: string; required?: string } | null;
    balance?: { token: string; actual: string; expected: string } | null;
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

export class ZeroExQuoteProvider implements QuoteProvider {
  constructor(
    private readonly apiKey: string,
    private readonly taker?: `0x${string}`,
    private readonly chainId = 8453
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
    if (data.issues?.balance) {
      throw new Error("Wallet balance is insufficient for the requested trade.");
    }
    if (!data.transaction?.to || !data.transaction.data) {
      throw new Error("0x returned no executable transaction.");
    }

    const allowance = data.issues?.allowance ?? null;
    const spender = allowance?.spender ?? data.allowanceTarget;

    return {
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountInWei: BigInt(data.sellAmount),
      amountOutWei: BigInt(data.buyAmount),
      priceImpactBps: 0,
      estimatedGasWei: data.gas && data.gasPrice ? BigInt(data.gas) * BigInt(data.gasPrice) : undefined,
      provider: "0x",
      observedAt: Date.now(),
      transaction: {
        to: data.transaction.to as `0x${string}`,
        data: data.transaction.data as `0x${string}`,
        value: BigInt(data.transaction.value ?? "0"),
        gas: data.transaction.gas ? BigInt(data.transaction.gas) : undefined,
        gasPrice: data.transaction.gasPrice ? BigInt(data.transaction.gasPrice) : undefined
      },
      allowanceTarget: spender as `0x${string}` | undefined,
      allowanceRequired: allowance?.required ? BigInt(allowance.required) : undefined,
      balanceIssue: Boolean(data.issues?.balance),
      simulationIncomplete: Boolean(data.issues?.simulationIncomplete)
    };
  }
}
