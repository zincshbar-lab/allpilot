import { verifyIntents, verifyNearTx } from "@/lib/verifyPayment";

// GET /api/pay/verify?deposit=<depositAddress>[&memo=…]   → paid through NEAR Intents?
// GET /api/pay/verify?tx=<txHash>&sender=<account.near>     → paid by direct NEAR transfer?
// Read-only public data, so any shop's server (or page) may call it.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const deposit = q.get("deposit")?.trim();
  const tx = q.get("tx")?.trim();
  const sender = q.get("sender")?.trim();
  try {
    if (deposit) return Response.json(await verifyIntents(deposit, q.get("memo") ?? undefined), { headers: CORS });
    if (tx && sender) return Response.json(await verifyNearTx(tx, sender), { headers: CORS });
    return Response.json({ error: "Pass ?deposit=<depositAddress> or ?tx=<hash>&sender=<account>" }, { status: 400, headers: CORS });
  } catch (e) {
    return Response.json({ paid: false, error: e instanceof Error ? e.message : String(e) }, { status: 404, headers: CORS });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export const maxDuration = 30;
