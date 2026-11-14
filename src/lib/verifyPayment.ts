// Server-side payment check for merchants using the checkout widget. The browser event
// ("allpilot:paid") is a convenience; a shop should confirm here before shipping an order.
//  • Paid through NEAR Intents → look up the deposit address on 1Click.
//  • Paid by direct NEAR transfer (payer already held the exact token) → read the tx from the chain.

import { intentsStatus } from "./intents";
import { ftMetadata, rpc } from "./near";

export type Verified = {
  paid: boolean;
  status: string;
  method: "intents" | "near-transfer";
  recipient?: string;
  /** Token the recipient got: "near" for native NEAR, a NEAR token contract, or a 1Click asset id. */
  token?: string;
  amount?: string; // smallest units
  amountFormatted?: string;
  sender?: string;
  memo?: string;
  depositAddress?: string;
  txHash?: string;
};

type IntentsStatus = {
  status?: string;
  swapDetails?: { amountOut?: string; amountOutFormatted?: string; destinationChainTxHashes?: { hash: string }[] };
  quoteResponse?: { quoteRequest?: { recipient?: string; destinationAsset?: string; refundTo?: string }; quote?: { amountOut?: string; amountOutFormatted?: string } };
};

export async function verifyIntents(depositAddress: string, depositMemo?: string): Promise<Verified> {
  const s = (await intentsStatus(depositAddress, depositMemo)) as IntentsStatus & { message?: string };
  if (!s.status) throw new Error(s.message ?? "Unknown deposit address");
  const req = s.quoteResponse?.quoteRequest;
  return {
    paid: s.status === "SUCCESS",
    status: s.status,
    method: "intents",
    recipient: req?.recipient,
    token: req?.destinationAsset,
    amount: s.swapDetails?.amountOut ?? s.quoteResponse?.quote?.amountOut,
    amountFormatted: s.swapDetails?.amountOutFormatted ?? s.quoteResponse?.quote?.amountOutFormatted,
    depositAddress,
  };
}

type TxResult = {
  status: { SuccessValue?: string; Failure?: unknown };
  transaction: {
    signer_id: string;
    receiver_id: string;
    actions: ({ Transfer?: { deposit: string }; FunctionCall?: { method_name: string; args: string } } | string)[];
  };
};

// tx lookups can hit older blocks, which free RPCs often refuse; archival nodes first, then the usual pool
const ARCHIVAL = ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"];
async function txStatus(txHash: string, sender: string): Promise<TxResult> {
  const params = { tx_hash: txHash, sender_account_id: sender, wait_until: "FINAL" };
  for (const url of ARCHIVAL) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "verify", method: "tx", params }),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      const j = (await res.json()) as { result?: TxResult; error?: { cause?: { name?: string }; message?: string } };
      if (j.result) return j.result;
      if (j.error?.cause?.name === "UNKNOWN_TRANSACTION") throw new Error("Transaction not found (check the hash and the sender account)");
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Transaction not found")) throw e;
    }
  }
  return rpc<TxResult>("tx", params);
}

export async function verifyNearTx(txHash: string, sender: string): Promise<Verified> {
  const r = await txStatus(txHash, sender);
  const ok = r.status && "SuccessValue" in r.status;
  const t = r.transaction;
  for (const a of t.actions) {
    if (typeof a !== "object") continue;
    if (a.Transfer) {
      return { paid: !!ok, status: ok ? "SUCCESS" : "FAILED", method: "near-transfer", recipient: t.receiver_id, token: "near", amount: a.Transfer.deposit, amountFormatted: fmt(a.Transfer.deposit, 24), sender: t.signer_id, txHash };
    }
    if (a.FunctionCall?.method_name === "ft_transfer") {
      const args = JSON.parse(Buffer.from(a.FunctionCall.args, "base64").toString("utf8")) as { receiver_id: string; amount: string; memo?: string };
      const decimals = await ftMetadata(t.receiver_id).then((m) => m.decimals).catch(() => undefined);
      return {
        paid: !!ok,
        status: ok ? "SUCCESS" : "FAILED",
        method: "near-transfer",
        recipient: args.receiver_id,
        token: t.receiver_id,
        amount: args.amount,
        amountFormatted: decimals === undefined ? undefined : fmt(args.amount, decimals),
        sender: t.signer_id,
        memo: args.memo,
        txHash,
      };
    }
  }
  return { paid: false, status: "NOT_A_PAYMENT", method: "near-transfer", sender: t.signer_id, txHash };
}

function fmt(base: string, decimals: number) {
  const s = base.padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
