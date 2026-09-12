# Jarvis

Autonomous Base trading agent with interchangeable paper and live execution.

## Modes

The same API and risk pipeline are used for both modes. Switch with one environment variable:

```env
TRADING_MODE=paper
```

or:

```env
TRADING_MODE=live
```

Paper mode now persists balances and executed paper fills in the SQLite-backed Durable Object. Live execution remains fail-closed until the wallet, router/quote, transaction confirmation, and final safety gates are implemented.

## Paper API

```text
GET  /health
GET  /portfolio
POST /paper/reset
POST /trade
```

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

## Development

```bash
npm install
npm run dev
```

Run `npm run types` after installing Wrangler to generate `worker-configuration.d.ts`.

Never commit private keys or funded-wallet credentials. Paper mode is the default development mode.
