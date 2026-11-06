import { payableAssets } from "@/lib/pay";

// POST → every token/chain a payer can use on the checkout page (from NEAR Intents)
export async function POST() {
  try {
    return Response.json({ assets: await payableAssets() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
