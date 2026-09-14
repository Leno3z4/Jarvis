import type { TokenMarket } from "./types";

const TOKEN_API_URL = "https://trade-api.gateway.uniswap.org/v1/tokens";
const QUOTE_API_URL = "https://trade-api.gateway.uniswap.org/v1/quote";
const POOL_API_URL = "https://liquidity.api.uniswap.org/lp/pool_info";
const CHAIN_ID = 8453;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
const BASE_WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const Q96 = 2 ** 96;
const DISCOVERY_WETH_AMOUNT_WEI = 1_000_000_000_000_000n;
const V3_FEE_TIERS = [{ fee: 100, tickSpacing: 1 }, { fee: 500, tickSpacing: 10 }, { fee: 3000, tickSpacing: 60 }, { fee: 10000, tickSpacing: 200 }] as const;
const V4_FEE_TIERS = [{ fee: 100, tickSpacing: 1 }, { fee: 500, tickSpacing: 10 }, { fee: 3000, tickSpacing: 60 }, { fee: 10000, tickSpacing: 200 }, { fee: 3000, tickSpacing: 10 }, { fee: 500, tickSpacing: 60 }] as const;
const POOL_PROTOCOLS = ["V2", "V3", "V4"] as const;
interface UniswapToken { name?: string; address?: string; chainId?: string | number; symbol?: string; decimals?: string | number; }
interface UniswapResponse { tokens?: UniswapToken[]; }
interface QuoteOutput { amount?: string; token?: string; }
interface QuotePayload { quote?: { output?: { amount?: string; token?: string }; outputs?: QuoteOutput[] }; routing?: string; }
interface PoolInfo { tokenAddressA?: string; tokenAddressB?: string; tokenAmountA?: string; tokenAmountB?: string; tokenDecimalsA?: number | string; tokenDecimalsB?: number | string; poolLiquidity?: string; poolProtocol?: string; fee?: string | number; tickSpacing?: string | number; sqrtRatioX96?: string; token0Reserves?: string; token1Reserves?: string; }
interface PoolResponse { pools?: PoolInfo[]; }
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
function isAddress(value: unknown): value is `0x${string}` { return typeof value === "string" && ADDRESS_RE.test(value); }
function isErc20Address(value: string): boolean { const lower = value.toLowerCase(); return lower !== NATIVE_SENTINEL.toLowerCase() && lower !== ZERO_ADDRESS.toLowerCase(); }
function positiveBigInt(value: unknown): bigint { try { const parsed = BigInt(String(value ?? "0")); return parsed > 0n ? parsed : 0n; } catch { return 0n; } }
function positiveNumber(value: unknown): number { const parsed = typeof value === "number" ? value : Number(value ?? 0); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function isTransientQuoteStatus(status: number): boolean { return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504; }

async function quoteToken(apiKey: string, swapper: `0x${string}`, tokenIn: `0x${string}`, tokenOut: `0x${string}`, amount: bigint): Promise<bigint> {
  const attempts = 3; let lastError = "unknown error";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(QUOTE_API_URL, { method: "POST", headers: { "x-api-key": apiKey, accept: "application/json", "content-type": "application/json", "x-universal-router-version": "2.0", "x-erc20eth-enabled": "false", "x-permit2-disabled": "false" }, body: JSON.stringify({ type: "EXACT_INPUT", amount: amount.toString(), tokenInChainId: CHAIN_ID, tokenOutChainId: CHAIN_ID, tokenIn, tokenOut, swapper, slippageTolerance: 0.5, routingPreference: "BEST_PRICE", protocols: ["V2", "V3", "V4"] }) });
    if (response.ok) { const data = (await response.json()) as QuotePayload; const output = positiveBigInt(data.quote?.output?.amount ?? data.quote?.outputs?.[0]?.amount); if (output <= 0n) throw new Error("Uniswap quote returned no positive output."); return output; }
    const body = await response.text(); lastError = `Uniswap quote failed (${response.status}): ${body.slice(0, 220)}`;
    if (!isTransientQuoteStatus(response.status) && response.status !== 404) throw new Error(lastError);
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error(lastError);
}

async function poolInfo(apiKey: string, token: `0x${string}`, quoteTokenAddress: `0x${string}`, protocol: (typeof POOL_PROTOCOLS)[number], fee?: number, tickSpacing?: number): Promise<PoolInfo[]> {
  if (token.toLowerCase() === quoteTokenAddress.toLowerCase()) return [];
  const [tokenAddressA, tokenAddressB] = [token, quoteTokenAddress].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const poolParameters: Record<string, string | number> = { tokenAddressA, tokenAddressB };
  if (protocol === "V3" || protocol === "V4") { if (fee === undefined || tickSpacing === undefined) throw new Error(`${protocol} pool lookup requires fee and tickSpacing.`); poolParameters.fee = fee; poolParameters.tickSpacing = tickSpacing; }
  const response = await fetch(POOL_API_URL, { method: "POST", headers: { "x-api-key": apiKey, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ protocol, chainId: CHAIN_ID, poolParameters, pageSize: 20, currentPage: 1 }) });
  if (!response.ok) { const body = await response.text(); throw new Error(`Uniswap ${protocol} pool lookup failed (${response.status}): ${body.slice(0, 180)}`); }
  const data = (await response.json()) as PoolResponse; return data.pools ?? [];
}

function marketFromPool(token: UniswapToken, pool: PoolInfo, quoteTokenAddress: `0x${string}`, quotePriceUsd: number): TokenMarket | null {
  if (!token.address) return null;
  const tokenA = pool.tokenAddressA?.toLowerCase(), tokenB = pool.tokenAddressB?.toLowerCase(), tokenLower = token.address.toLowerCase(), quoteLower = quoteTokenAddress.toLowerCase();
  if (![tokenA, tokenB].includes(tokenLower) || ![tokenA, tokenB].includes(quoteLower)) return null;
  const tokenIsA = tokenA === tokenLower;
  const tokenDecimals = Number(tokenIsA ? pool.tokenDecimalsA : pool.tokenDecimalsB) || Number(token.decimals ?? 18);
  const quoteDecimals = Number(tokenIsA ? pool.tokenDecimalsB : pool.tokenDecimalsA) || (quoteLower === BASE_USDC.toLowerCase() ? 6 : 18);
  const quoteUsd = quoteLower === BASE_USDC.toLowerCase() ? 1 : quoteLower === BASE_WETH.toLowerCase() ? quotePriceUsd : 0;
  if (!(tokenDecimals >= 0) || !(quoteDecimals >= 0) || quoteUsd <= 0) return null;
  const protocol = pool.poolProtocol?.toUpperCase(); let priceUsd = 0; let liquidityUsd = 0;
  if (protocol === "V3" && pool.sqrtRatioX96 && pool.poolLiquidity) {
    const sqrtPrice = Number(pool.sqrtRatioX96) / Q96, liquidity = positiveNumber(pool.poolLiquidity);
    if (!(sqrtPrice > 0) || !(liquidity > 0)) return null;
    const rawPrice1Per0 = sqrtPrice * sqrtPrice;
    const humanPrice1Per0 = rawPrice1Per0 * 10 ** (tokenIsA ? tokenDecimals - quoteDecimals : quoteDecimals - tokenDecimals);
    priceUsd = tokenIsA ? humanPrice1Per0 * quoteUsd : (1 / humanPrice1Per0) * quoteUsd;
    const rawVirtual0 = liquidity / sqrtPrice, rawVirtual1 = liquidity * sqrtPrice;
    const decimalsA = Number(pool.tokenDecimalsA ?? (tokenIsA ? tokenDecimals : quoteDecimals));
    const decimalsB = Number(pool.tokenDecimalsB ?? (tokenIsA ? quoteDecimals : tokenDecimals));
    const amountA = tokenA === (pool.tokenAddressA ?? "").toLowerCase() ? rawVirtual0 / 10 ** decimalsA : rawVirtual1 / 10 ** decimalsA;
    const amountB = tokenB === (pool.tokenAddressB ?? "").toLowerCase() ? rawVirtual1 / 10 ** decimalsB : rawVirtual0 / 10 ** decimalsB;
    const tokenAmount = tokenIsA ? amountA : amountB, quoteAmount = tokenIsA ? amountB : amountA;
    liquidityUsd = 2 * Math.min(tokenAmount * priceUsd, quoteAmount * quoteUsd);
  } else {
    const rawToken = positiveNumber(tokenIsA ? pool.tokenAmountA : pool.tokenAmountB), rawQuote = positiveNumber(tokenIsA ? pool.tokenAmountB : pool.tokenAmountA);
    if (rawToken <= 0 || rawQuote <= 0) return null;
    const tokenAmount = rawToken / 10 ** tokenDecimals, quoteAmount = rawQuote / 10 ** quoteDecimals;
    priceUsd = (quoteAmount / tokenAmount) * quoteUsd; liquidityUsd = quoteAmount * quoteUsd * 2;
  }
  if (!Number.isFinite(priceUsd) || !Number.isFinite(liquidityUsd) || priceUsd <= 0 || liquidityUsd <= 0) return null;
  return { address: token.address as `0x${string}`, symbol: token.symbol ?? token.name ?? "UNKNOWN", decimals: tokenDecimals, priceUsd, liquidityUsd, volume24hUsd: 0, change24hPct: 0, observedAt: Date.now(), dataCompleteness: "liquidity-price-only" };
}

export class UniswapTokenProvider {
  constructor(private readonly apiKey: string, private readonly swapper: `0x${string}`) {}

  async discoverBaseTokenAddresses(limit = 20, additionalTokenAddresses: `0x${string}`[] = []): Promise<TokenMarket[]> {
    if (!this.apiKey) throw new Error("Uniswap API key is not configured.");
    const requested = Math.min(Math.max(limit, 10), 30);
    const fetchTokens = async (sort: "volume_24h" | "tvl") => {
      const url = new URL(TOKEN_API_URL); url.searchParams.set("sort", sort); url.searchParams.set("limit", String(requested)); url.searchParams.set("chainId", String(CHAIN_ID));
      const response = await fetch(url, { headers: { "x-api-key": this.apiKey, accept: "application/json" } });
      if (!response.ok) { const body = await response.text(); throw new Error(`Uniswap token discovery failed (${response.status}): ${body.slice(0, 300)}`); }
      return ((await response.json()) as UniswapResponse).tokens ?? [];
    };
    const [volumeTokens, tvlTokens] = await Promise.all([fetchTokens("volume_24h"), fetchTokens("tvl")]);
    const unique = new Map<string, UniswapToken>();
    for (const token of [...volumeTokens, ...tvlTokens]) {
      if (Number(token.chainId) !== CHAIN_ID || !isAddress(token.address) || !isErc20Address(token.address!)) continue;
      const address = token.address!.toLowerCase();
      if (address === BASE_USDC.toLowerCase() || address === BASE_WETH.toLowerCase()) continue;
      unique.set(address, token);
    }
    const markets = [...unique.values()].slice(0, Math.min(requested * 2, 50)).map((token) => ({ address: token.address as `0x${string}`, symbol: token.symbol ?? token.name ?? "UNKNOWN", decimals: Number(token.decimals ?? 18), priceUsd: 0, liquidityUsd: 0, volume24hUsd: 0, change24hPct: 0, observedAt: Date.now(), dataCompleteness: "quote-only" as const }));
    for (const address of additionalTokenAddresses) {
      if (!isAddress(address) || !isErc20Address(address)) continue;
      const lower = address.toLowerCase();
      if (lower === BASE_USDC.toLowerCase() || lower === BASE_WETH.toLowerCase()) continue;
      if (!unique.has(lower) && !markets.some((market) => market.address.toLowerCase() === lower)) {
        markets.push({ address, symbol: "HELD", decimals: 18, priceUsd: 0, liquidityUsd: 0, volume24hUsd: 0, change24hPct: 0, observedAt: Date.now(), dataCompleteness: "quote-only" });
      }
    }
    return markets;
  }

  async discoverBaseMarkets(limit = 20, additionalTokenAddresses: `0x${string}`[] = []): Promise<TokenMarket[]> {
    const tokens = await this.discoverBaseTokenAddresses(Math.min(Math.max(limit, 10), 30), additionalTokenAddresses);
    const markets: TokenMarket[] = []; const failures: string[] = [];
    const usdcForWeth = await quoteToken(this.apiKey, this.swapper, BASE_WETH, BASE_USDC, DISCOVERY_WETH_AMOUNT_WEI).catch((error) => { failures.push(`WETH/USDC:${error instanceof Error ? error.message : "unknown"}`); return 0n; });
    if (usdcForWeth <= 0n) throw new Error(`Uniswap quote discovery failed. ${failures.join(" | ")}`);
    const wethPriceUsd = (Number(usdcForWeth) / 1e6) / (Number(DISCOVERY_WETH_AMOUNT_WEI) / 1e18);
    const tryPool = async (token: UniswapToken, quoteToken: `0x${string}`): Promise<TokenMarket[]> => {
      const candidates: TokenMarket[] = [];
      for (const protocol of ["V2", "V3"] as const) {
        if (protocol === "V2") {
          try { const pools = await poolInfo(this.apiKey, token.address as `0x${string}`, quoteToken, "V2"); for (const pool of pools) { const market = marketFromPool(token, pool, quoteToken, wethPriceUsd); if (market) candidates.push(market); } }
          catch (error) { failures.push(`${token.symbol}:V2:${quoteToken === BASE_USDC ? "USDC" : "WETH"}:${error instanceof Error ? error.message : "unknown"}`); }
        } else {
          for (const feeTier of V3_FEE_TIERS) {
            try { const pools = await poolInfo(this.apiKey, token.address as `0x${string}`, quoteToken, "V3", feeTier.fee, feeTier.tickSpacing); for (const pool of pools) { const market = marketFromPool(token, pool, quoteToken, wethPriceUsd); if (market) candidates.push(market); } }
            catch (error) { failures.push(`${token.symbol}:V3:${quoteToken === BASE_USDC ? "USDC" : "WETH"}:${feeTier.fee}:${error instanceof Error ? error.message : "unknown"}`); }
          }
        }
      }
      for (const feeTier of V4_FEE_TIERS) {
        try { const pools = await poolInfo(this.apiKey, token.address as `0x${string}`, quoteToken, "V4", feeTier.fee, feeTier.tickSpacing); for (const pool of pools) { const market = marketFromPool(token, pool, quoteToken, wethPriceUsd); if (market) candidates.push(market); } }
        catch (error) { failures.push(`${token.symbol}:V4:${quoteToken === BASE_USDC ? "USDC" : "WETH"}:${feeTier.fee}/${feeTier.tickSpacing}:${error instanceof Error ? error.message : "unknown"}`); }
      }
      return candidates;
    };
    for (const token of tokens) {
      if (!token.address) continue;
      let poolCandidates = await tryPool(token, BASE_USDC);
      if (poolCandidates.length === 0) poolCandidates = await tryPool(token, BASE_WETH);
      const best = poolCandidates.sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
      if (best) markets.push(best); else failures.push(`${token.symbol}: no usable V2/V3/V4 pool for USDC or WETH`);
    }
    if (markets.length === 0) throw new Error(`No Base Uniswap pool-backed markets discovered. ${failures.slice(0, 12).join(" | ")}`);
    return markets;
  }
}
