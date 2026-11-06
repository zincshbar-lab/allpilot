// Pilot Guard — runs in the browser right before the wallet prompt.
// The AI can only *propose* transactions; this checks every proposal against hard rules the
// user controls, so a confused (or prompt-injected) model can't drain the wallet.

import type { ActionCard } from "./cards";

export type GuardPolicy = {
  maxNearPerAction: number; // NEAR attached across all txs of one card
  maxUsdPerAction: number; // value of what is sent, when known
};

export const DEFAULT_POLICY: GuardPolicy = { maxNearPerAction: 5, maxUsdPerAction: 50 };

const DEX = new Set(["v2.ref-finance.near", "dclv2.ref-labs.near"]);
const ALLOWED_METHODS = new Set(["near_deposit", "storage_deposit", "ft_transfer_call", "ft_transfer"]);
// Extra methods only allowed for one kind of card, and only on one specific contract.
const KIND_METHODS: Record<string, { method: string; receiver: string }[]> = {
  launch: [
    { method: "launch_meme", receiver: "v2-launchpad.justhoot.near" },
    { method: "launch", receiver: "nearlytrade.near" },
  ],
  lp: [
    { method: "register_tokens", receiver: "v2.ref-finance.near" },
    { method: "add_liquidity", receiver: "v2.ref-finance.near" },
  ],
};
const MAX_STORAGE_DEPOSIT = 10n ** 22n; // 0.01 NEAR — storage registration should never cost more

export type GuardResult = { ok: true } | { ok: false; reasons: string[] };

export function checkCard(card: ActionCard, policy: GuardPolicy, accountId?: string, now = Date.now()): GuardResult {
  const reasons: string[] = [];
  if (!accountId) reasons.push("Connect a wallet first.");
  if (card.expiresAt && now > card.expiresAt) reasons.push("This quote expired — ask Pip for a fresh one.");

  const spend = Number(BigInt(card.nearSpend || "0") / 10n ** 18n) / 1e6;
  if (spend > policy.maxNearPerAction) reasons.push(`Attaches ${spend.toFixed(3)} NEAR, above your ${policy.maxNearPerAction} NEAR limit.`);
  if (card.usdIn && card.usdIn > policy.maxUsdPerAction) reasons.push(`Worth ~$${card.usdIn.toFixed(2)}, above your $${policy.maxUsdPerAction} limit.`);

  const deposit = card.intents?.depositAddress;
  const payee = card.kind === "pay" ? card.payment?.recipient : undefined; // the recipient the user named
  for (const tx of card.transactions) {
    for (const a of tx.actions) {
      if (a.type === "Transfer") {
        // Native NEAR transfers are only allowed as a payment, straight to the named recipient.
        if (!payee || tx.receiverId !== payee) reasons.push(`Blocked NEAR transfer to ${tx.receiverId}.`);
        continue;
      }
      const { methodName, args, deposit: dep } = a.params;
      const ar = args as Record<string, string>;
      const special = KIND_METHODS[card.kind]?.some((k) => k.method === methodName && k.receiver === tx.receiverId);
      if (special) continue;
      if (!ALLOWED_METHODS.has(methodName)) {
        reasons.push(`Blocked method ${methodName} on ${tx.receiverId}.`);
        continue;
      }
      if (methodName === "near_deposit" && tx.receiverId !== "wrap.near") reasons.push(`near_deposit to unexpected contract ${tx.receiverId}.`);
      if (methodName === "storage_deposit") {
        if (BigInt(dep) > MAX_STORAGE_DEPOSIT) reasons.push(`Storage deposit on ${tx.receiverId} is suspiciously large.`);
        if (ar.account_id !== accountId && ar.account_id !== deposit && ar.account_id !== payee) reasons.push(`Storage deposit for unknown account ${ar.account_id}.`);
      }
      if (methodName === "ft_transfer_call" && !DEX.has(ar.receiver_id)) reasons.push(`Tokens would go to ${ar.receiver_id}, which is not a known DEX.`);
      if (methodName === "ft_transfer" && ar.receiver_id !== deposit && ar.receiver_id !== payee)
        reasons.push(`Plain transfer to ${ar.receiver_id} is neither the NEAR Intents deposit address nor the payee you named.`);
    }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

// Tiny external store so React can read the saved policy without hydration mismatches.
let cached: GuardPolicy | null = null;
const listeners = new Set<() => void>();

export function getPolicy(): GuardPolicy {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem("allpilot.guard");
    cached = raw ? { ...DEFAULT_POLICY, ...JSON.parse(raw) } : DEFAULT_POLICY;
  } catch {
    cached = DEFAULT_POLICY;
  }
  return cached!;
}

export const getServerPolicy = () => DEFAULT_POLICY;

export function subscribePolicy(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function savePolicy(p: GuardPolicy) {
  cached = p;
  try {
    localStorage.setItem("allpilot.guard", JSON.stringify(p));
  } catch {
    /* storage unavailable — keep in memory */
  }
  listeners.forEach((l) => l());
}
