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
DexScreener Base discovery
    -> deterministic liquidity / volume / momentum filters
    -> Gemini structured decision
    -> 0x execution quote
    -> deterministic risk validation
    -> paper or live executor
```

The strategy scan runs from Cron every five minutes when its required credentials are configured and persists the latest opportunities in the Durable Object. Autonomous paper cycles can execute paper fills; live mode remains guarded separately.

Gemini only recommends `BUY`, `SELL`, `HOLD`, or `SKIP`. It does not sign transactions, choose transaction calldata, or bypass risk controls. The Gemini client automatically fails over across the configured primary, fallback 1, and fallback 2 candidates on quota/transient failures.

## API

```text
GET  /health
POST /ai/generate
POST /strategy/scan
POST /strategy/run
GET  /strategy/latest
POST /quote
GET  /portfolio
GET  /trades
POST /paper/reset
POST /trade
```

`GET /portfolio` and `GET /trades` are used by the Vercel dashboard to render current portfolio state and the realized-PnL history.

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

## Dashboard / Vercel

The frontend lives in `dashboard/` and is designed to deploy as a separate Vercel project using this repository.

In Vercel, set **Root Directory** to `dashboard`. The dashboard uses Next.js 16 and has no chart dependency; the PnL chart is rendered as SVG.

Set these Vercel environment variables:

```env
NEXT_PUBLIC_JARVIS_API_URL=https://YOUR-JARVIS-WORKER.workers.dev
NEXT_PUBLIC_CASH_DECIMALS=18
```

Set `NEXT_PUBLIC_CASH_DECIMALS` to the decimals of the configured `PAPER_CASH_TOKEN` (for example, a 6-decimal stablecoin uses `6`).

The Worker API currently exposes read-only dashboard telemetry without authentication. Before making a live trading dashboard public, add dashboard authentication or an origin/token gate.

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

Bot:

```bash
npm install
npm run types
npm run check
npm run dev
```

Dashboard:

```bash
cd dashboard
npm install
npm run dev
```

Never commit private keys or funded-wallet credentials. Paper mode is the default development mode.
