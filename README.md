# Jarvis

Autonomous Base trading agent with interchangeable paper and live execution.

## Runtime architecture

```text
Cloudflare Worker (src/worker.ts)
  -> API routing / CORS / execution boundary
  -> Strategy modules
  -> Market providers
  -> AI decision layer
  -> Persistent BotState Durable Object
  -> Persistent RiskState Durable Object
  -> Paper or live executor

Vercel dashboard (dashboard/)
  -> read-only telemetry from Worker API
```

The Worker entrypoint is intentionally thin. Trading logic, market discovery, Gemini decisions, portfolio accounting, and persistent risk state live in separate modules.

## Modes

Switch the shared backend between paper and live with:

```env
TRADING_MODE=paper
```

or:

```env
TRADING_MODE=live
```

Paper mode persists balances, cost basis, realized PnL, and fills in the SQLite-backed Durable Object. Live execution remains fail-closed until wallet-level persistent exposure accounting is complete.

## Risk controls

Persistent risk state includes:

- max trade size
- max portfolio exposure
- max token exposure
- maximum open positions
- daily trade cap
- per-token cooldown
- daily realized-loss cap
- persistent kill switch
- trade idempotency keys

Every paper trade passes the deterministic risk gate before the executor. Realized paper PnL is fed back into the risk state so the daily loss limit is meaningful.

## Pipeline

```text
DexScreener Base discovery
    -> deterministic scanner
    -> Gemini structured decision
    -> 0x executable quote
    -> deterministic risk gate
    -> paper executor
```

Gemini only recommends `BUY`, `SELL`, `HOLD`, or `SKIP`. It cannot sign transactions, choose calldata, or bypass deterministic risk controls.

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
GET  /risk/state
POST /risk/kill-switch
POST /paper/reset
POST /trade
```

## Dashboard / Vercel

The dashboard lives in `dashboard/` and is deployed as a separate Vercel project with the repository root directory set to `dashboard`.

```env
NEXT_PUBLIC_JARVIS_API_URL=https://YOUR-JARVIS-WORKER.workers.dev
NEXT_PUBLIC_CASH_DECIMALS=18
```

It displays portfolio values, realized PnL history, execution history, and bot/risk status.

## Development

Backend:

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

Never commit private keys or funded-wallet credentials.
