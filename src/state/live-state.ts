interface LiveTradePayload {
  tokenIn: `0x${string}`; tokenOut: `0x${string}`; amountInWei: string; amountOutWei: string; txHash?: `0x${string}`; reason: string;
}

export class LiveTradingState {
  private readonly sql: SqlStorage;
  constructor(state: DurableObjectState) { this.sql = state.storage.sql; this.sql.exec(`CREATE TABLE IF NOT EXISTS live_tokens (token TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS live_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, token_in TEXT NOT NULL, token_out TEXT NOT NULL, amount_in TEXT NOT NULL, amount_out TEXT NOT NULL, tx_hash TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL);`); }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/tokens" && request.method === "GET") { const rows = this.sql.exec<{ token: string }>("SELECT token FROM live_tokens ORDER BY token").toArray(); return Response.json({ tokens: rows.map((row: { token: string }) => row.token) }); }
    if (url.pathname === "/record" && request.method === "POST") { const payload = await request.json() as LiveTradePayload; const tokenIn = payload.tokenIn.toLowerCase(); const tokenOut = payload.tokenOut.toLowerCase(); const now = new Date().toISOString(); for (const token of [tokenIn, tokenOut]) this.sql.exec("INSERT INTO live_tokens(token, first_seen_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET last_seen_at = excluded.last_seen_at", token, now, now); this.sql.exec("INSERT INTO live_trades(token_in, token_out, amount_in, amount_out, tx_hash, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", tokenIn, tokenOut, payload.amountInWei, payload.amountOutWei, payload.txHash ?? null, payload.reason, now); return Response.json({ ok: true }); }
    if (url.pathname === "/trades" && request.method === "GET") { const rows = this.sql.exec<{ id: number; token_in: string; token_out: string; amount_in: string; amount_out: string; tx_hash: string | null; reason: string; created_at: string }>("SELECT id, token_in, token_out, amount_in, amount_out, tx_hash, reason, created_at FROM live_trades ORDER BY id DESC LIMIT 100").toArray(); return Response.json({ trades: rows.reverse().map((row: { id: number; token_in: string; token_out: string; amount_in: string; amount_out: string; tx_hash: string | null; reason: string; created_at: string }) => ({ id: row.id, tokenIn: row.token_in, tokenOut: row.token_out, amountInWei: row.amount_in, amountOutWei: row.amount_out, txHash: row.tx_hash, reason: row.reason, createdAt: row.created_at })) }); }
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }
}
