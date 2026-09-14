import type { TokenMarket } from "./types";

const DEFAULT_SUBGRAPH_ID = "GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz";
const DEFAULT_TEST_TOKEN = "0x4200000000000000000000000000000000000006";
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
  errors?: Array<{ message?: string; locations?: unknown; path?: unknown }>;
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface GraphDiagnostics {
  configured: boolean;
  subgraphId: string;
  gateway: string;
  testToken: string;
  httpStatus?: number;
  rows?: number;
  latestPeriodStartUnix?: number;
  latestPriceUsd?: number;
  graphErrors?: string[];
  ok: boolean;
  error?: string;
}

export class TheGraphMarketDataProvider {
  private readonly endpoint: string;
  private readonly subgraphId: string;

  constructor(
    private readonly apiKey: string,
    subgraphId = DEFAULT_SUBGRAPH_ID
  ) {
    this.subgraphId = subgraphId;
    this.endpoint = `${GATEWAY_BASE}/${encodeURIComponent(apiKey)}/subgraphs/id/${subgraphId}`;
  }

  async diagnose(testToken = DEFAULT_TEST_TOKEN): Promise<GraphDiagnostics> {
    if (!this.apiKey) {
      return {
        configured: false,
        subgraphId: this.subgraphId,
        gateway: GATEWAY_BASE,
        testToken,
        ok: false,
        error: "THE_GRAPH_API_KEY is not configured in the Worker environment."
      };
    }

    const query = `query TokenHours($token: String!) {
      tokenHourDatas(
        first: 3
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

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          operationName: "TokenHours",
          query,
          variables: { token: testToken.toLowerCase() }
        })
      });

      const text = await response.text();
      let payload: GraphResponse = {};
      try {
        payload = JSON.parse(text) as GraphResponse;
      } catch {
        return {
          configured: true,
          subgraphId: this.subgraphId,
          gateway: GATEWAY_BASE,
          testToken,
          httpStatus: response.status,
          ok: false,
          error: `Graph gateway returned non-JSON response: ${text.slice(0, 180)}`
        };
      }

      const errors = payload.errors?.map((item) => item.message ?? "Unknown GraphQL error") ?? [];
      const rows = payload.data?.tokenHourDatas ?? [];
      const latest = rows
        .map((row) => ({
          time: numeric(row.periodStartUnix),
          price: numeric(row.priceUSD || row.close)
        }))
        .filter((row) => row.time > 0)
        .sort((a, b) => b.time - a.time)[0];

      const ok = response.ok && errors.length === 0 && rows.length > 0;
      return {
        configured: true,
        subgraphId: this.subgraphId,
        gateway: GATEWAY_BASE,
        testToken,
        httpStatus: response.status,
        rows: rows.length,
        latestPeriodStartUnix: latest?.time,
        latestPriceUsd: latest?.price,
        graphErrors: errors.length ? errors : undefined,
        ok,
        error: ok ? undefined : `Graph diagnostics failed with HTTP ${response.status}.`
      };
    } catch (error) {
      return {
        configured: true,
        subgraphId: this.subgraphId,
        gateway: GATEWAY_BASE,
        testToken,
        ok: false,
        error: error instanceof Error ? error.message : "The Graph diagnostic request failed."
      };
    }
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
