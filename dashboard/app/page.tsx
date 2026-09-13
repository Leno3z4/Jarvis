"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Portfolio = {
  cashWei: string;
  positions: Record<string, string>;
  realizedPnlWei: string;
};

type Trade = {
  id: number;
  tokenIn: string;
  tokenOut: string;
  amountInWei: string;
  amountOutWei: string;
  slippageBps: number;
  reason: string;
  realizedPnlWei: string;
  createdAt: string;
};

type Health = {
  ok: boolean;
  mode: "paper" | "live";
  liveTradingEnabled: boolean;
  geminiFallbacksConfigured: number;
};

const API_URL = process.env.NEXT_PUBLIC_JARVIS_API_URL?.replace(/\/$/, "") ?? "";
const CASH_DECIMALS = Number(process.env.NEXT_PUBLIC_CASH_DECIMALS ?? "18");

function formatUnits(value: string, decimals = CASH_DECIMALS, digits = 4) {
  try {
    const numeric = Number(value) / 10 ** decimals;
    if (!Number.isFinite(numeric)) return "—";
    return numeric.toLocaleString(undefined, { maximumFractionDigits: digits });
  } catch {
    return "—";
  }
}

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatPnl(value: string) {
  const numeric = Number(value) / 10 ** CASH_DECIMALS;
  if (!Number.isFinite(numeric)) return "—";
  return `${numeric >= 0 ? "+" : ""}${numeric.toLocaleString(undefined, {
    maximumFractionDigits: 4
  })}`;
}

function PnlChart({ trades }: { trades: Trade[] }) {
  const values = trades.length ? trades.map((trade) => Number(trade.realizedPnlWei) / 10 ** CASH_DECIMALS) : [0];
  const width = 900;
  const height = 280;
  const padX = 20;
  const padY = 24;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = padX + (index / Math.max(values.length - 1, 1)) * (width - padX * 2);
    const y = height - padY - ((value - min) / range) * (height - padY * 2);
    return `${x},${y}`;
  });
  const zeroY = height - padY - ((0 - min) / range) * (height - padY * 2);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Realized PnL chart">
        <line x1={padX} x2={width - padX} y1={zeroY} y2={zeroY} className="zero-line" />
        <polyline points={points.join(" ")} fill="none" className="pnl-line" />
        {values.length > 1 && <circle cx={Number(points.at(-1)?.split(",")[0])} cy={Number(points.at(-1)?.split(",")[1])} r="5" className="pnl-dot" />}
      </svg>
      <div className="chart-labels">
        <span>{formatPnl(String(min * 10 ** CASH_DECIMALS))}</span>
        <span>realized PnL · cash-token units</span>
        <span>{formatPnl(String(max * 10 ** CASH_DECIMALS))}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!API_URL) {
      setError("NEXT_PUBLIC_JARVIS_API_URL is not configured.");
      setLoading(false);
      return;
    }

    try {
      const [healthResponse, portfolioResponse, tradesResponse] = await Promise.all([
        fetch(`${API_URL}/health`, { cache: "no-store" }),
        fetch(`${API_URL}/portfolio`, { cache: "no-store" }),
        fetch(`${API_URL}/trades?limit=200`, { cache: "no-store" })
      ]);

      if (!healthResponse.ok || !portfolioResponse.ok || !tradesResponse.ok) {
        throw new Error("Jarvis API returned an error.");
      }

      setHealth((await healthResponse.json()) as Health);
      setPortfolio((await portfolioResponse.json()) as Portfolio);
      setTrades(((await tradesResponse.json()) as { trades: Trade[] }).trades);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reach Jarvis.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const pnl = portfolio?.realizedPnlWei ?? "0";
  const positions = portfolio ? Object.keys(portfolio.positions).length : 0;
  const lastTrade = trades.at(-1);
  const pnlPositive = pnl.startsWith("-") === false && pnl !== "0";

  const winRate = useMemo(() => {
    if (!trades.length) return 0;
    const positive = trades.filter((trade) => !trade.realizedPnlWei.startsWith("-") && trade.realizedPnlWei !== "0").length;
    return Math.round((positive / trades.length) * 100);
  }, [trades]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">BASE · AUTONOMOUS TRADING</div>
          <h1>JARVIS</h1>
          <p>Execution telemetry, portfolio state and PnL.</p>
        </div>
        <div className="status-cluster">
          <span className={`status-dot ${health?.mode === "live" ? "live" : "paper"}`} />
          <span>{health?.mode === "live" ? "LIVE" : "PAPER"}</span>
          {health && <span className="muted">· Gemini {health.geminiFallbacksConfigured}/3</span>}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="metrics">
        <div className="metric-card accent">
          <span>Realized PnL</span>
          <strong className={pnlPositive ? "positive" : pnl === "0" ? "" : "negative"}>{formatPnl(pnl)}</strong>
          <small>cash-token units</small>
        </div>
        <div className="metric-card">
          <span>Cash balance</span>
          <strong>{portfolio ? formatUnits(portfolio.cashWei) : "—"}</strong>
          <small>current paper cash</small>
        </div>
        <div className="metric-card">
          <span>Trades</span>
          <strong>{trades.length}</strong>
          <small>{winRate}% non-negative PnL snapshots</small>
        </div>
        <div className="metric-card">
          <span>Open positions</span>
          <strong>{positions}</strong>
          <small>tokens with balance &gt; 0</small>
        </div>
      </section>

      <section className="grid two">
        <article className="panel chart-panel">
          <div className="panel-head">
            <div>
              <span className="kicker">PERFORMANCE</span>
              <h2>Realized PnL</h2>
            </div>
            <button onClick={() => void load()} className="ghost-button">Refresh</button>
          </div>
          {loading ? <div className="empty">Loading telemetry…</div> : <PnlChart trades={trades} />}
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="kicker">PORTFOLIO</span>
              <h2>Current state</h2>
            </div>
            <span className="pill">Base</span>
          </div>
          <div className="state-list">
            <div><span>Cash</span><strong>{portfolio ? formatUnits(portfolio.cashWei) : "—"}</strong></div>
            <div><span>Realized PnL</span><strong>{formatPnl(pnl)}</strong></div>
            <div><span>Positions</span><strong>{positions}</strong></div>
            <div><span>Last trade</span><strong>{lastTrade ? new Date(lastTrade.createdAt).toLocaleTimeString() : "—"}</strong></div>
          </div>
          <div className="note">PnL is currently displayed in the configured cash-token units. Set <code>NEXT_PUBLIC_CASH_DECIMALS</code> to match the paper cash token.</div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="kicker">EXECUTION LOG</span>
            <h2>Recent trades</h2>
          </div>
          <span className="muted">Auto-refresh · 15s</span>
        </div>
        {trades.length === 0 ? (
          <div className="empty">No trades recorded yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Time</th><th>Route</th><th>Amount in</th><th>Amount out</th><th>PnL snapshot</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {[...trades].reverse().slice(0, 12).map((trade) => (
                  <tr key={trade.id}>
                    <td>{new Date(trade.createdAt).toLocaleString()}</td>
                    <td className="route">{shorten(trade.tokenIn)} → {shorten(trade.tokenOut)}</td>
                    <td>{formatUnits(trade.amountInWei)}</td>
                    <td>{formatUnits(trade.amountOutWei)}</td>
                    <td className={!trade.realizedPnlWei.startsWith("-") ? "positive" : "negative"}>{formatPnl(trade.realizedPnlWei)}</td>
                    <td className="reason">{trade.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer>
        <span>Jarvis dashboard</span>
        <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Waiting for API"}</span>
      </footer>
    </main>
  );
}
