import type { TokenMarket } from "./types";

const DEFAULT_SUBGRAPH_ID = "GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz";
const GATEWAY_BASE = "https://gateway.thegraph.com/api";

interface GraphHourData {
  periodStartUnix?: number | string;
  volumeUSD?: string | number;
  priceUSD?: string | number;
  close?: string | number;
}

interface GraphResponse {
  data?: {
    tokenHourDatas?: GraphHourData[];
  };
  errors?: Array<{ message?: string }>;
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class TheGraphMarketDataProvider {
  private readonly endpoint: string;

  constructor(
    private readonly apiKey: string,
    subgraphId = DEFAULT_SUBGRAPH_ID
  ) {
    this.endpoint = `${GATEWAY_BASE}/${encodeURIComponent(apiKey)}/subgraphs/id/${subgraphId}`;
  }

  async enrichMarkets(markets: TokenMarket[]): Promise<TokenMarket[]> {
    if (!this.apiKey || markets.length === 0) return markets;

    return Promise.all(markets.map(async (market) => {
      try {
        const query = `query TokenHours($token: String!) {
          tokenHourDatas(
            first: 25
            where: { token: $token }
            orderBy: periodStartUnix
            orderDirection: desc
          ) {
            periodStartUnix
            volumeUSD
            priceUSD
            close
          }
        }`;

        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            operationName: "TokenHours",
            query,
            variables: { token: market.address.toLowerCase() }
          })
        });

        if (!response.ok) return market;
        const payload = (await response.json()) as GraphResponse;
        if (payload.errors?.length) return market;

        const rows = (payload.data?.tokenHourDatas ?? [])
          .map((row) => ({
            time: numeric(row.periodStartUnix),
            volume: numeric(row.volumeUSD),
            price: numeric(row.priceUSD || row.close)
          }))
          .filter((row) => row.time > 0)
          .sort((a, b) => b.time - a.time);

        if (rows.length === 0) return market;

        const cutoff = Date.now() / 1000 - 24 * 60 * 60;
        const last24h = rows.filter((row) => row.time >= cutoff);
        const volume24hUsd = last24h.reduce((sum, row) => sum + row.volume, 0);
        const latest = rows[0];
        const older = rows[Math.min(24, rows.length - 1)];
        const change24hPct = older.price > 0
          ? ((latest.price - older.price) / older.price) * 100
          : 0;

        return {
          ...market,
          volume24hUsd,
          change24hPct,
          priceUsd: latest.price > 0 ? latest.price : market.priceUsd,
          observedAt: Date.now(),
          dataCompleteness: volume24hUsd > 0 && latest.price > 0 ? "full" : market.dataCompleteness
        };
      } catch {
        return market;
      }
    }));
  }
}
