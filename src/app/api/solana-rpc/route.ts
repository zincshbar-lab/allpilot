// Tiny read-only Solana RPC proxy for the checkout's Phantom payments.
// Public Solana RPCs block browser origins (403), so the page calls this instead. Only the read methods the
// payment flow needs are allowed; the transaction itself is signed and sent by Phantom, never by this server.

const RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
const ALLOWED = new Set(["getAccountInfo", "getLatestBlockhash", "getMinimumBalanceForRentExemption", "getSignatureStatuses"]);

export async function POST(req: Request) {
  let body: { method?: string } | { method?: string }[];
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 5 || calls.some((c) => !c.method || !ALLOWED.has(c.method))) return Response.json({ error: "method not allowed" }, { status: 403 });
  let last = "";
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(8_000) });
      if (r.ok) return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
      last = `${url} → ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  return Response.json({ error: `Solana RPC unavailable (${last})` }, { status: 502 });
}
