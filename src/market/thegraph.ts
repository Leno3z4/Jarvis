import type { TokenMarket } from "./types";

const DEFAULT_SUBGRAPH_ID = "GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz";
const DEFAULT_TEST_TOKEN = "0x4200000000000000000000000000000000000006";
const GATEWAY_BASE = "https://gateway.thegraph.com/api";
const MAX_ENRICH_MARKETS = 20;

interface GraphHourData { periodStartUnix?: number | string; volumeUSD?: string | number; priceUSD?: string | number; close?: string | number; }
interface GraphToken { id?: string; symbol?: string; decimals?: string | number; totalValueLockedUSD?: string | number; derivedETH?: string | number; }
interface GraphResponse { data?: { token?: GraphToken; tokens?: GraphToken[]; tokenHourDatas?: GraphHourData[] }; errors?: Array<{ message?: string; locations?: unknown; path?: unknown }>; }
function numeric(value: unknown): number { const parsed = typeof value === "number" ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }

export interface GraphDiagnostics { configured: boolean; subgraphId: string; gateway: string; testToken: string; httpStatus?: number; rows?: number; latestPeriodStartUnix?: number; latestPriceUsd?: number; ok: boolean; error?: string; }

export class TheGraphMarketDataProvider {
  private readonly endpoint: string;
  private readonly subgraphId: string;
  constructor(private readonly apiKey: string, subgraphId = DEFAULT_SUBGRAPH_ID) { this.subgraphId = subgraphId; this.endpoint = `${GATEWAY_BASE}/${encodeURIComponent(apiKey)}/subgraphs/id/${subgraphId}`; }

  async diagnose(testToken = DEFAULT_TEST_TOKEN): Promise<GraphDiagnostics> {
    if (!this.apiKey) return { configured: false, subgraphId: this.subgraphId, gateway: GATEWAY_BASE, testToken, ok: false, error: "THE_GRAPH_API_KEY is not configured in the Worker environment." };
    const query = `query TokenHours($token: String!) { tokenHourDatas(first: 3 where: { token: $token } orderBy: periodStartUnix orderDirection: desc) { periodStartUnix volumeUSD priceUSD close } }`;
    try {
      const response = await fetch(this.endpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ operationName: "TokenHours", query, variables: { token: testToken.toLowerCase() } }) });
      const text = await response.text(); let payload: GraphResponse = {};
      try { payload = JSON.parse(text) as GraphResponse; } catch { return { configured: true, subgraphId: this.subgraphId, gateway: GATEWAY_BASE, testToken, httpStatus: response.status, ok: false, error: `Graph gateway returned non-JSON response: ${text.slice(0, 180)}` }; }
      const errors = payload.errors?.map((item) => item.message ?? "Unknown GraphQL error") ?? [];
      const rows = payload.data?.tokenHourDatas ?? [];
      const latest = rows.map((row) => ({ time: numeric(row.periodStartUnix), price: numeric(row.priceUSD || row.close) })).filter((row) => row.time > 0).sort((a, b) => b.time - a.time)[0];
      const ok = response.ok && errors.length === 0 && rows.length > 0;
      return { configured: true, subgraphId: this.subgraphId, gateway: GATEWAY_BASE, testToken, httpStatus: response.status, rows: rows.length, latestPeriodStartUnix: latest?.time, latestPriceUsd: latest?.price, ok, error: ok ? undefined : `Graph diagnostics failed with HTTP ${response.status}.` };
    } catch (error) { return { configured: true, subgraphId: this.subgraphId, gateway: GATEWAY_BASE, testToken, ok: false, error: error instanceof Error ? error.message : "The Graph diagnostic request failed." }; }
  }

  async enrichMarkets(markets: TokenMarket[]): Promise<TokenMarket[]> {
    if (!this.apiKey || markets.length === 0) return markets;
    // Keep the enrichment universe large enough to discover new opportunities,
    // but bounded so the Worker stays below its external-subrequest budget.
    const limited = markets.slice(0, MAX_ENRICH_MARKETS);
    return Promise.all(limited.map(async (market) => {
      try {
        const query = `query TokenData($token: String!) {
          token(id: $token) { id symbol decimals totalValueLockedUSD derivedETH volumeUSD }
          tokenHourDatas(first: 25 where: { token: $token } orderBy: periodStartUnix orderDirection: desc) { periodStartUnix volumeUSD priceUSD close }
        }`;
        const response = await fetch(this.endpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ operationName: "TokenData", query, variables: { token: market.address.toLowerCase() } }) });
        if (!response.ok) return market;
        const payload = (await response.json()) as GraphResponse;
        if (payload.errors?.length) return market;
        const token = payload.data?.token;
        const rows = (payload.data?.tokenHourDatas ?? []).map((row) => ({ time: numeric(row.periodStartUnix), volume: numeric(row.volumeUSD), price: numeric(row.priceUSD || row.close) })).filter((row) => row.time > 0 && row.price > 0).sort((a, b) => b.time - a.time);
        const baseLiquidity = numeric(token?.totalValueLockedUSD);
        if (rows.length === 0) return { ...market, liquidityUsd: baseLiquidity > 0 ? baseLiquidity : market.liquidityUsd, dataCompleteness: baseLiquidity > 0 ? "full" : market.dataCompleteness };

        const cutoff24h = Date.now() / 1000 - 24 * 60 * 60;
        const last24h = rows.filter((row) => row.time >= cutoff24h);
        const volume24hUsd = last24h.reduce((sum, row) => sum + row.volume, 0);
        const latest = rows[0];
        const older24 = rows[Math.min(24, rows.length - 1)];
        const older6 = rows[Math.min(6, rows.length - 1)];
        const older1 = rows[Math.min(1, rows.length - 1)];
        const avgHourlyVolumeUsd = last24h.length > 1 ? volume24hUsd / last24h.length : 0;
        const volume1hUsd = latest.volume;
        const volumeSpikeRatio = avgHourlyVolumeUsd > 0 ? volume1hUsd / avgHourlyVolumeUsd : 0;
        const change24hPct = older24.price > 0 ? ((latest.price - older24.price) / older24.price) * 100 : 0;
        const change6hPct = older6.price > 0 ? ((latest.price - older6.price) / older6.price) * 100 : 0;
        const change1hPct = older1.price > 0 ? ((latest.price - older1.price) / older1.price) * 100 : 0;
        const priorPrices = rows.slice(1, Math.min(rows.length, 25)).map((row) => row.price).filter((price) => price > 0);
        const recentHigh = priorPrices.length ? Math.max(...priorPrices) : latest.price;
        const nearRecentHighPct = recentHigh > 0 ? (latest.price / recentHigh) * 100 : 100;

        return {
          ...market,
          volume24hUsd,
          volume1hUsd,
          avgHourlyVolumeUsd,
          volumeSpikeRatio,
          change1hPct,
          change6hPct,
          nearRecentHighPct,
          change24hPct,
          liquidityUsd: baseLiquidity > 0 ? baseLiquidity : market.liquidityUsd,
          priceUsd: latest.price,
          observedAt: Date.now(),
          dataCompleteness: (baseLiquidity > 0 && volume24hUsd > 0) ? "full" : market.dataCompleteness
        };
      } catch { return market; }
    }));
  }
}
