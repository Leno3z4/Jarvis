# Jarvis

Autonomous Base trading agent with interchangeable paper and live execution.

## Modes

The same strategy, risk, quote, and execution pipeline is used for both modes. Switch with one environment variable:

```env
TRADING_MODE=paper
```

or:

```env
TRADING_MODE=live
```

Paper mode persists balances and executed paper fills in the SQLite-backed Durable Object. Live execution is implemented through 0x Swap API v2 + viem, but remains disabled unless `LIVE_TRADING_ENABLED=true` is explicitly set.

## Pipeline

```text
market scanner
    -> deterministic liquidity / volume / momentum filters
    -> Gemini structured decision
    -> deterministic risk validation
    -> paper or live executor
```

Gemini only recommends `BUY`, `SELL`, `HOLD`, or `SKIP`. It does not sign transactions, choose transaction calldata, or bypass risk controls. The Gemini client automatically fails over across the configured primary, fallback 1, and fallback 2 candidates on quota/transient failures.

## API

```text
GET  /health
POST /ai/generate
POST /quote
GET  /portfolio
POST /paper/reset
POST /trade
```

`POST /quote` uses a server-side 0x API key and the configured wallet address to request a firm Base quote.

`POST /trade` expects integer amounts as strings because JSON does not support `bigint`:

```json
{
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "amountInWei": "1000000",
  "amountOutWei": "950000000000000",
  "slippageBps": 100,
  "reason": "strategy signal"
}
```

## Live safety

Live mode requires all of the following:

```env
TRADING_MODE=live
LIVE_TRADING_ENABLED=true
ZEROEX_API_KEY=...
BASE_RPC_URL=https://mainnet.base.org
LIVE_WALLET_ADDRESS=0x...
LIVE_PRIVATE_KEY=0x...
```

The private key must be stored as a Cloudflare secret in deployment, never committed to Git. The executor verifies that the configured address matches the private key, checks the 0x quote for balance/validation issues, sets only the allowance target returned by 0x when needed, and then submits the swap transaction.

## Development

```bash
npm install
npm run types
npm run check
npm run dev
```

Never commit private keys or funded-wallet credentials. Paper mode is the default development mode.
