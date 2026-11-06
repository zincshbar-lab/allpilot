import { pay } from "@/lib/pay";
import { isNearAccountId } from "@/lib/near";

// POST { to, amount, token, chain, memo, payWithAssetId, accountId?, refundTo? } → payment ActionCard
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Record<string, string | undefined>;
    if (!b.to || !b.amount || !b.token || !b.payWithAssetId) return Response.json({ error: "Missing payment details." }, { status: 400 });
    const card = await pay({
      to: b.to,
      amount: b.amount,
      token: b.token,
      toChain: b.chain,
      memo: b.memo?.slice(0, 120),
      payWithAssetId: b.payWithAssetId,
      accountId: b.accountId && isNearAccountId(b.accountId) ? b.accountId : undefined,
      refundTo: b.refundTo?.trim() || undefined,
    });
    return Response.json({ card });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}

// First request on a cold server builds the pool/price indexes; give it room on Vercel.
export const maxDuration = 60;
