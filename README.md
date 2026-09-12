# Jarvis

Autonomous Base trading agent with interchangeable paper and live execution.

## Trading mode

The same strategy and risk pipeline is used for both modes. Switch with one environment variable:

```env
TRADING_MODE=paper
```

or:

```env
TRADING_MODE=live
```

Live execution is currently fail-closed until the wallet, quote/router, and transaction confirmation layers are implemented.

## Development

```bash
npm install
npm run dev
```

Never commit private keys or funded-wallet credentials. Paper mode is the default development mode.
