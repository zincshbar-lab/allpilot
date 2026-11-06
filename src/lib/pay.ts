// Pay with Intents — the "universal checkout".
//
// A payee asks for an exact amount of one token on one chain ("10 USDC to shop.near").
// The payer can pay with whatever they hold, on whatever chain: NEAR Intents (1Click) quotes it as
// EXACT_OUTPUT, so the payee receives exactly the requested amount and the payer's side carries the
// slippage buffer (any unused part is refunded). Same token on NEAR → a plain direct transfer, no fee.

import type { ActionCard } from "./cards";
import { chainName, placeholderFor } from "./actions";
import { findIntentsToken, intentsQuote, intentsTokens, normalizeChain, type IntentsToken } from "./intents";
import { WRAP_NEAR, accountExists, fromBase, isNearAccountId, storageNeeded, toBase } from "./near";
import { resolveToken } from "./tokens";
import { PlannedTx, appendTx, fc, ftTransfer, storageDeposit, totalAttachedNear, transfer, type TxAction } from "./tx";

const uid = () => Math.random().toString(36).slice(2, 10);
const PAY_SLIPPAGE = 100; // 1% buffer on the payer side

const EVM = new Set(["eth", "base", "arb", "pol", "bsc", "avax", "op", "gnosis", "bera"]);

/** Guess the chain from the address shape when the user didn't say. */
export function guessChain(address: string): string | undefined {
  if (isNearAccountId(address) && (address.includes(".") || /^[0-9a-f]{64}$/.test(address))) return "near";
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(address)) return "btc";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "sol";
  return undefined; // 0x… could be any EVM chain — ask
}

async function validateRecipient(to: string, chain: string) {
  if (chain === "near") {
    if (!isNearAccountId(to)) throw new Error(`"${to}" isn't a valid NEAR account.`);
    if (!(await accountExists(to))) throw new Error(`The NEAR account ${to} doesn't exist. Check the spelling.`);
    return;
  }
  if (EVM.has(chain) && !/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error(`"${to}" isn't a valid ${chainName(chain)} address (0x + 40 hex characters).`);
}

export type PayInput = {
  to: string; // recipient address/account
  amount: string; // exact amount the recipient should get (human units)
  token: string; // symbol the recipient gets, e.g. USDC
  toChain?: string; // chain the recipient gets it on (default: guessed from the address)
  payWith?: string; // symbol the payer spends (default: same token)
  payFromChain?: string; // chain the payer spends from (default: near)
  payWithAssetId?: string; // checkout page: exact 1Click asset id the payer picked
  refundTo?: string; // payer's origin-chain address when paying from outside NEAR
  accountId?: string; // connected NEAR wallet (payer)
  memo?: string;
};

export async function pay(p: PayInput): Promise<ActionCard> {
  const toC = normalizeChain(p.toChain) ?? guessChain(p.to);
  if (!toC) throw new Error(`Which chain is ${p.to} on? (e.g. Ethereum, Base, Arbitrum, BNB)`);
  await validateRecipient(p.to, toC);

  let origin: IntentsToken | null = null;
  if (p.payWithAssetId) origin = (await intentsTokens()).find((t) => t.assetId === p.payWithAssetId) ?? null;
  const fromC = origin?.blockchain ?? normalizeChain(p.payFromChain) ?? "near";
  const payWithSym = origin?.symbol ?? (p.payWith ?? p.token);
  const sameTokenOnNear = toC === "near" && fromC === "near" && normalizeSym(payWithSym) === normalizeSym(p.token);

  if (sameTokenOnNear) return directPay(p);

  const dest = await findIntentsToken(p.token, toC);
  if (!dest) throw new Error(`NEAR Intents can't deliver ${p.token.toUpperCase()} on ${chainName(toC)}.`);
  origin ??= await findIntentsToken(payWithSym, fromC);
  if (!origin) throw new Error(`NEAR Intents can't take ${payWithSym.toUpperCase()} on ${chainName(fromC)} as payment.`);

  const originOnNear = origin.blockchain === "near";
  const refundTo = originOnNear ? p.accountId : p.refundTo;
  const canExecute = !!refundTo && (!originOnNear || !!p.accountId);
  const amountOut = toBase(p.amount, dest.decimals);
  const q = await intentsQuote({
    originAsset: origin.assetId,
    destinationAsset: dest.assetId,
    amount: amountOut,
    recipient: p.to,
    refundTo: refundTo ?? placeholderFor(origin.blockchain),
    slippageBps: PAY_SLIPPAGE,
    dry: !canExecute,
    swapType: "EXACT_OUTPUT",
  });
  const quote = q.quote;
  const nativeIn = originOnNear && normalizeSym(payWithSym) === "NEAR";
  const inSym = nativeIn ? "NEAR" : origin.symbol;
  const outSym = dest.symbol === "wNEAR" ? "NEAR" : dest.symbol;

  const transactions: PlannedTx[] = [];
  let externalDeposit: { chain: string; symbol: string; amount: string } | undefined;
  if (canExecute && quote.depositAddress) {
    if (originOnNear && p.accountId) {
      const token = origin.contractAddress ?? origin.assetId.replace(/^nep141:/, "");
      const actions: TxAction[] = [];
      if (nativeIn && token === WRAP_NEAR) {
        const needSelf = await storageNeeded(WRAP_NEAR, p.accountId);
        if (needSelf) actions.push(storageDeposit(p.accountId, needSelf));
        actions.push(fc("near_deposit", {}, 10, quote.amountIn));
      }
      const needDeposit = await storageNeeded(token, quote.depositAddress);
      if (needDeposit) actions.push(storageDeposit(quote.depositAddress, needDeposit));
      actions.push(ftTransfer(quote.depositAddress, quote.amountIn));
      appendTx(transactions, { receiverId: token, actions });
    } else {
      externalDeposit = { chain: chainName(origin.blockchain), symbol: origin.symbol, amount: quote.amountInFormatted };
    }
  }

  const warnings: string[] = [];
  if (!originOnNear && !p.refundTo) warnings.push(`Tell me your ${chainName(fromC)} address for refunds, then you'll get a deposit address to pay from.`);
  if (!originOnNear) warnings.push(`You'll send from your ${chainName(fromC)} wallet. Send exactly the amount shown, on the right chain.`);
  if (!process.env.ONECLICK_JWT) warnings.push("Includes a 0.2% NEAR Intents routing fee (paid by the payer).");

  return {
    id: uid(),
    kind: "pay",
    title: `Pay ${p.amount} ${outSym} to ${short(p.to)}`,
    venue: "near-intents",
    lines: [
      { label: "Recipient", value: p.to },
      { label: "They get (exactly)", value: `${fromBase(quote.amountOut, dest.decimals)} ${outSym} on ${chainName(toC)}` },
      { label: "You pay (max)", value: `${quote.amountInFormatted} ${inSym} on ${chainName(fromC)}` },
      ...(quote.minAmountIn ? [{ label: "Unused buffer", value: `refunded to you after settlement` }] : []),
      { label: "Route", value: "NEAR Intents (1Click) · exact output" },
      { label: "Time", value: quote.timeEstimate ? `~${quote.timeEstimate}s` : "a few seconds" },
      ...(p.memo ? [{ label: "Memo", value: p.memo }] : []),
    ],
    warnings,
    transactions,
    nearSpend: totalAttachedNear(transactions).toString(),
    usdIn: Number(quote.amountInUsd) || undefined,
    intents: quote.depositAddress ? { depositAddress: quote.depositAddress, depositMemo: quote.depositMemo, externalDeposit } : undefined,
    payment: { recipient: p.to, chain: toC, memo: p.memo },
    needsWallet: originOnNear && !p.accountId,
    expiresAt: quote.deadline ? Date.parse(quote.deadline) : Date.now() + 10 * 60_000,
    links: quote.depositAddress ? [{ label: "Track on NEAR Intents explorer", href: `https://explorer.near-intents.org/transactions/${quote.depositAddress}` }] : [],
  };
}

/** Same token, both on NEAR: plain transfer straight to the recipient (no bridge, no fee). */
async function directPay(p: PayInput): Promise<ActionCard> {
  const r = await resolveToken(p.token);
  if (!r.best) throw new Error(`I couldn't find ${p.token} on NEAR.`);
  const t = r.best;
  const amount = toBase(p.amount, t.decimals);
  const transactions: PlannedTx[] = [];
  if (p.accountId) {
    if (t.id === "near") {
      transactions.push({ receiverId: p.to, actions: [transfer(amount)] });
    } else {
      const actions: TxAction[] = [];
      const need = await storageNeeded(t.id, p.to);
      if (need) actions.push(storageDeposit(p.to, need));
      const ft = ftTransfer(p.to, amount);
      if (p.memo) (ft.params.args as Record<string, string>).memo = p.memo.slice(0, 120);
      actions.push(ft);
      transactions.push({ receiverId: t.id, actions });
    }
  }
  const warnings: string[] = [];
  if (r.lookalikes > 0) warnings.push(`${r.lookalikes} other token(s) use the symbol ${t.symbol}. Using the verified contract ${t.id}.`);
  return {
    id: uid(),
    kind: "pay",
    title: `Pay ${p.amount} ${t.symbol} to ${short(p.to)}`,
    venue: "direct",
    lines: [
      { label: "Recipient", value: p.to },
      { label: "They get", value: `${p.amount} ${t.symbol} on NEAR` },
      { label: "You pay", value: `${p.amount} ${t.symbol}` },
      { label: "Route", value: "Direct NEAR transfer · no fee" },
      ...(t.id !== "near" ? [{ label: "Token", value: t.id }] : []),
      ...(p.memo ? [{ label: "Memo", value: p.memo }] : []),
    ],
    warnings,
    transactions,
    nearSpend: totalAttachedNear(transactions).toString(),
    usdIn: t.priceUsd ? Number(p.amount) * t.priceUsd : undefined,
    payment: { recipient: p.to, chain: "near", memo: p.memo },
    needsWallet: !p.accountId,
    expiresAt: Date.now() + 10 * 60_000,
    links: [{ label: "View recipient", href: `https://nearblocks.io/address/${p.to}` }],
  };
}

// ---------------------------------------------------------------- payment links / checkout widget

export type LinkInput = { to: string; amount: string; token: string; chain?: string; memo?: string; baseUrl: string };

export async function paymentLink(l: LinkInput): Promise<ActionCard> {
  const chain = normalizeChain(l.chain) ?? guessChain(l.to);
  if (!chain) throw new Error(`Which chain should ${l.to} receive on?`);
  await validateRecipient(l.to, chain);
  const dest = await findIntentsToken(l.token, chain);
  if (!dest) throw new Error(`NEAR Intents can't deliver ${l.token.toUpperCase()} on ${chainName(chain)}.`);
  toBase(l.amount, dest.decimals); // validates the amount

  const sym = dest.symbol === "wNEAR" ? "NEAR" : dest.symbol;
  const qs = new URLSearchParams({ to: l.to, amount: l.amount, token: sym, chain, ...(l.memo ? { memo: l.memo.slice(0, 120) } : {}) });
  const url = `${l.baseUrl}/pay?${qs}`;
  const iframe = `<iframe src="${url}&embed=1" width="380" height="560" style="border:0;border-radius:24px" title="Pay with Intents"></iframe>`;
  const button = `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#ff8fb1;color:#fff;font-weight:600;text-decoration:none;font-family:sans-serif">Pay ${l.amount} ${sym} with Intents ✨</a>`;
  return {
    id: uid(),
    kind: "link",
    title: `Payment link · ${l.amount} ${sym}`,
    venue: "near-intents",
    lines: [
      { label: "Pays to", value: l.to },
      { label: "Amount", value: `${l.amount} ${sym} on ${chainName(chain)}` },
      ...(l.memo ? [{ label: "Memo", value: l.memo }] : []),
      { label: "Payer can use", value: "any token on any chain NEAR Intents supports" },
    ],
    warnings: [],
    transactions: [],
    nearSpend: "0",
    checkout: { url, iframe, button },
    links: [{ label: "Open checkout", href: url }],
  };
}

/** Assets a payer can choose from on the checkout page. */
export async function payableAssets() {
  const list = await intentsTokens();
  return list
    .filter((t) => t.price > 0)
    .map((t) => ({ assetId: t.assetId, symbol: t.symbol === "wNEAR" ? "NEAR" : t.symbol, chain: t.blockchain, chainName: chainName(t.blockchain), price: t.price }))
    .sort((a, b) => (a.chain === "near" ? -1 : b.chain === "near" ? 1 : 0) || a.symbol.localeCompare(b.symbol));
}

const normalizeSym = (s: string) => {
  const u = s.toUpperCase().replace(/^\$/, "");
  return u === "WNEAR" ? "NEAR" : u;
};
const short = (a: string) => (a.length > 24 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
