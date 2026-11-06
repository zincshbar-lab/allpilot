// Transaction shapes shared by server (builds them) and client (guards + signs them).
// Format matches @hot-labs/near-connect / near-wallet-selector "FunctionCall" actions.

import { ONE_YOCTO, TGAS, WRAP_NEAR, storageNeeded } from "./near";

export type FunctionCall = {
  type: "FunctionCall";
  params: { methodName: string; args: object; gas: string; deposit: string };
};
export type TransferAction = { type: "Transfer"; params: { deposit: string } };
export type TxAction = FunctionCall | TransferAction;
export type PlannedTx = { receiverId: string; actions: TxAction[] };

export const transfer = (deposit: string): TransferAction => ({ type: "Transfer", params: { deposit } });

export const fc = (methodName: string, args: object, tgas: number, deposit = "0"): FunctionCall => ({
  type: "FunctionCall",
  params: { methodName, args, gas: (BigInt(tgas) * TGAS).toString(), deposit },
});

export const storageDeposit = (accountId: string, deposit: string) =>
  fc("storage_deposit", { account_id: accountId, registration_only: true }, 30, deposit);

/** Sum of NEAR (yocto) attached across all actions — what the Pilot Guard checks against the spend limit. */
export function totalAttachedNear(txs: PlannedTx[]): bigint {
  let sum = 0n;
  for (const tx of txs) for (const a of tx.actions) sum += BigInt(a.params.deposit || "0");
  return sum;
}

/**
 * Prefix actions so `accountId` holds `wrapAmount` wNEAR (wraps native NEAR) and is registered
 * on `outputToken`. Returns the extra transactions to run before the swap.
 */
export async function prepTxs(opts: {
  accountId: string;
  wrapAmount?: string; // yocto NEAR to wrap
  outputToken?: string;
}): Promise<PlannedTx[]> {
  const out: PlannedTx[] = [];
  // 1) make sure the user can receive the output token (also wNEAR, which gets unwrapped after)
  if (opts.outputToken) {
    const need = await storageNeeded(opts.outputToken, opts.accountId);
    if (need) out.push({ receiverId: opts.outputToken, actions: [storageDeposit(opts.accountId, need)] });
  }
  // 2) wrap native NEAR → wNEAR (the swap action is then appended to this same transaction)
  if (opts.wrapAmount) {
    const actions: FunctionCall[] = [];
    const need = await storageNeeded(WRAP_NEAR, opts.accountId);
    if (need) actions.push(storageDeposit(opts.accountId, need));
    actions.push(fc("near_deposit", {}, 10, opts.wrapAmount));
    out.push({ receiverId: WRAP_NEAR, actions });
  }
  return out;
}

/** Append a tx, merging into the previous one when it targets the same contract (one wallet prompt). */
export function appendTx(txs: PlannedTx[], tx: PlannedTx): PlannedTx[] {
  const last = txs[txs.length - 1];
  if (last && last.receiverId === tx.receiverId) last.actions.push(...tx.actions);
  else txs.push(tx);
  return txs;
}

export const ONE_YOCTO_DEPOSIT = ONE_YOCTO;

export const ftTransferCall = (receiverId: string, amount: string, msg: string, tgas = 180) =>
  fc("ft_transfer_call", { receiver_id: receiverId, amount, msg }, tgas, ONE_YOCTO);

export const ftTransfer = (receiverId: string, amount: string) =>
  fc("ft_transfer", { receiver_id: receiverId, amount }, 30, ONE_YOCTO);
