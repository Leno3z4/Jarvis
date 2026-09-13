# Jarvis

Autonomous Base trading agent with interchangeable paper and live execution.

## Architecture

```text
Base discovery
  -> deterministic scanner
  -> Gemini structured decision
  -> executable 0x quote
  -> deterministic risk gate
  -> paper/live executor
  -> Durable Object SQLite state

                    └── dashboard/ -> Vercel
```

The backend remains Cloudflare-native. The `dashboard/` directory is a separate Next.js application that reads backend telemetry.

## Modes

Switch the same strategy/execution pipeline with one environment variable:

```env
TRADING_MODE=paper
```

or:

```env
TRADING_MODE=live
```

Paper mode is the default. Live execution additionally requires `LIVE_TRADING_ENABLED=true`.

## Risk controls

Risk limits are persistent configuration rather than in-memory Worker state:

```env
MAX_TRADE_WEI=100000000000000000
MAX_EXPOSURE_WEI=500000000000000000
MAX_TOKEN_EXPOSURE_WEI=200000000000000000
MAX_OPEN_POSITIONS=5
MAX_TRADES_PER_DAY=24
TRADE_COOLDOWN_SECONDS=900
MAX_DAILY_LOSS_WEI=100000000000000000
```

The risk layer provides a kill switch, daily trade limits, per-token cooldowns, portfolio/token exposure checks, position-count checks, idempotency support, and daily-loss accounting. Paper accounting now carries token cost basis so realized PnL is derived from entries and exits rather than raw balance differences.

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

`GET /portfolio` and `GET /trades` power the Vercel dashboard.

## Gemini

Gemini only recommends `BUY`, `SELL`, `HOLD`, or `SKIP`. It never signs transactions, supplies calldata, or bypasses deterministic risk controls. The client fails over across the configured primary/fallback candidates on transient or quota failures.

## Dashboard / Vercel

The frontend lives in `dashboard/` and is intended to be deployed as its own Vercel project using this repository.

Set **Root Directory** to `dashboard` and configure:

```env
NEXT_PUBLIC_JARVIS_API_URL=https://YOUR-JARVIS-WORKER.workers.dev
NEXT_PUBLIC_CASH_DECIMALS=18
```

The dashboard provides live mode/status cards, current cash/positions, realized-PnL history, and trade history. The PnL chart is rendered without an additional charting dependency.

The dashboard API is currently telemetry-oriented and publicly readable. Before exposing a live-control surface, add authentication and restrict mutation endpoints separately from read-only telemetry.

## Live safety

```env
TRADING_MODE=live
LIVE_TRADING_ENABLED=true
ZEROEX_API_KEY=...
BASE_RPC_URL=https://mainnet.base.org
LIVE_WALLET_ADDRESS=0x...
LIVE_PRIVATE_KEY=0x...
```

Keep the private key as a Cloudflare secret. Never commit funded-wallet credentials.

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
