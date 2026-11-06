import { intentsStatus, intentsSubmitDeposit } from "@/lib/intents";

// POST { depositAddress, depositMemo?, txHash?, sender? } → 1Click status (and optionally report the deposit tx)
export async function POST(req: Request) {
  const { depositAddress, depositMemo, txHash, sender } = (await req.json()) as {
    depositAddress?: string; depositMemo?: string; txHash?: string; sender?: string;
  };
  if (!depositAddress) return Response.json({ error: "depositAddress required" }, { status: 400 });
  if (txHash) await intentsSubmitDeposit(txHash, depositAddress, sender).catch(() => null);
  return Response.json(await intentsStatus(depositAddress, depositMemo));
}
