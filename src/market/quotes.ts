import type { Quote, QuoteProvider, QuoteRequest } from "./types";
import type { MarketProvider } from "./types";

export class PriceBasedQuoteProvider implements QuoteProvider {
  constructor(private readonly market: MarketProvider) {}

  async getQuote(request: QuoteRequest): Promise<Quote> {
    const [input, output] = await Promise.all([
      this.market.getToken(request.tokenIn),
      this.market.getToken(request.tokenOut)
    ]);

    if (input.priceUsd <= 0 || output.priceUsd <= 0) {
      throw new Error("Market prices must be positive before quoting.");
    }

    const numerator = request.amountInWei * BigInt(Math.round(input.priceUsd * 1_000_000));
    const denominator = BigInt(Math.round(output.priceUsd * 1_000_000));
    const amountOutWei = numerator / denominator;

    return {
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountInWei: request.amountInWei,
      amountOutWei,
      priceImpactBps: 0,
      provider: "price-based",
      observedAt: Date.now()
    };
  }
}
