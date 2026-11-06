// Lend & borrow on Rhea Lending (formerly Burrow), contract.main.burrow.near.
//
// Call formats follow Burrow's official SDK (burrowHQ/burrow-sdk-python):
//  • supply   — token.ft_transfer_call(burrow, amount, msg {"Execute":{"actions":[{"IncreaseCollateral":{token_id,max_amount}}]}})
//               (msg "" = supply without using it as collateral)
//  • borrow   — burrow.execute_with_pyth({actions:[Borrow{token_id,amount}, Withdraw{token_id,max_amount}]})
//  • repay    — token.ft_transfer_call(burrow, amount, msg {"Execute":{"actions":[{"Repay":{token_id,max_amount}}]}})
//  • withdraw — burrow.execute_with_pyth({actions:[DecreaseCollateral{token_id,amount}?, Withdraw{token_id,max_amount}]})
// Amounts inside actions use the asset's "inner" decimals = token decimals + config.extra_decimals.
// Health factor = Σ collateral·volatility / Σ borrowed÷volatility (liquidation below 1.0).

import type { ActionCard } from "./cards";
import { WRAP_NEAR, fromBase, ftBalance, ftMetadata, getNativeBalance, storageNeeded, toBase, view } from "./near";
import { resolveToken, rheaPrices, type TokenInfo } from "./tokens";
import { ONE_YOCTO_DEPOSIT, appendTx, fc, ftTransferCall, prepTxs, totalAttachedNear, type PlannedTx } from "./tx";

export const BURROW = "contract.main.burrow.near";
const uid = () => Math.random().toString(36).slice(2, 10);
const BURROW_STORAGE = 100_000_000_000_000_000_000_000n; // 0.1 NEAR — Rhea Lending's account minimum (refundable)
const MIN_HEALTH = 1.05; // refuse to build anything that ends below this
const WARN_HEALTH = 1.5;

type AssetConfig = { extra_decimals: number; volatility_ratio: number; can_deposit: boolean; can_withdraw: boolean; can_use_as_collateral: boolean; can_borrow: boolean };
type Asset = { token_id: string; supply_apr: string; borrow_apr: string; config: AssetConfig };
type Bal = { token_id: string; balance: string; apr?: string };
type Account = { supplied: Bal[]; collateral: Bal[]; borrowed: Bal[] } | null;

let assetCache: { at: number; assets: Map<string, Asset> } | null = null;
export async function lendingAssets(): Promise<Map<string, Asset>> {
  if (assetCache && Date.now() - assetCache.at < 2 * 60_000) return assetCache.assets;
  const list = await view<Asset[]>(BURROW, "get_assets_paged_detailed", { from_index: 0, limit: 100 });
  assetCache = { at: Date.now(), assets: new Map(list.map((a) => [a.token_id, a])) };
  return assetCache.assets;
}

const pct = (aprFraction: string | number) => `${(Number(aprFraction) * 100).toFixed(2)}%`;
const pow10 = (n: number) => 10n ** BigInt(n);

async function getAccount(accountId: string): Promise<Account> {
  return view<Account>(BURROW, "get_account", { account_id: accountId }).catch(() => null);
}

/** USD value of an inner-decimals balance. */
async function usdOf(tokenId: string, inner: bigint, extra: number): Promise<number | null> {
  const prices = await rheaPrices();
  const p = prices[tokenId];
  if (!p) return null;
  const decimals = typeof p.decimal === "number" ? p.decimal : await ftMetadata(tokenId).then((m) => m.decimals).catch(() => null);
  if (decimals === null) return null;
  return (Number(inner) / 10 ** (decimals + extra)) * Number(p.price);
}

/** Health factor after applying deltas (inner units). Infinity when nothing is borrowed. */
async function healthAfter(acc: Account, delta: { collateral?: [string, bigint]; borrowed?: [string, bigint] } = {}): Promise<number> {
  const assets = await lendingAssets();
  const coll = new Map((acc?.collateral ?? []).map((b) => [b.token_id, BigInt(b.balance)]));
  const bor = new Map((acc?.borrowed ?? []).map((b) => [b.token_id, BigInt(b.balance)]));
  if (delta.collateral) coll.set(delta.collateral[0], (coll.get(delta.collateral[0]) ?? 0n) + delta.collateral[1]);
  if (delta.borrowed) bor.set(delta.borrowed[0], (bor.get(delta.borrowed[0]) ?? 0n) + delta.borrowed[1]);
  let c = 0;
  let b = 0;
  for (const [t, v] of coll) {
    const a = assets.get(t);
    const usd = a && v > 0n ? await usdOf(t, v, a.config.extra_decimals) : 0;
    if (a && usd) c += (usd * a.config.volatility_ratio) / 10000; // unpriceable collateral counts as 0 (conservative)
  }
  for (const [t, v] of bor) {
    const a = assets.get(t);
    if (!a || v <= 0n) continue;
    const usd = await usdOf(t, v, a.config.extra_decimals);
    if (usd === null) throw new Error(`Can't price your ${t} debt right now, so I can't check your health factor safely.`);
    b += (usd * 10000) / a.config.volatility_ratio;
  }
  return b === 0 ? Infinity : c / b;
}

const fmtHealth = (h: number) => (h === Infinity ? "∞ (no debt)" : h > 100 ? ">100 (very safe)" : `${h.toFixed(2)}${h < WARN_HEALTH ? " ⚠️ close to liquidation (1.0)" : ""}`);

async function marketFor(query: string, need: "deposit" | "borrow" | "any") {
  const r = await resolveToken(query);
  if (!r.best) throw new Error(`I couldn't find a token called "${query}".`);
  const t = r.best;
  const id = t.id === "near" ? WRAP_NEAR : t.id;
  const a = (await lendingAssets()).get(id);
  if (!a) throw new Error(`${t.symbol} isn't a Rhea Lending market. Try USDC, USDT, NEAR, ETH, BTC, LiNEAR or rNEAR.`);
  if (need === "deposit" && !a.config.can_deposit) throw new Error(`Rhea Lending isn't accepting ${t.symbol} deposits right now.`);
  if (need === "borrow" && !a.config.can_borrow) throw new Error(`${t.symbol} can't be borrowed on Rhea Lending right now.`);
  return { t, id, a, native: t.id === "near" };
}

async function burrowStorageTx(accountId: string): Promise<PlannedTx | null> {
  const reg = await view<unknown>(BURROW, "storage_balance_of", { account_id: accountId }).catch(() => null);
  return reg ? null : { receiverId: BURROW, actions: [fc("storage_deposit", { account_id: accountId, registration_only: false }, 30, BURROW_STORAGE.toString())] };
}

function baseCard(kind: "lend", title: string): Omit<ActionCard, "lines" | "warnings" | "transactions" | "nearSpend"> {
  return { id: uid(), kind, title, venue: "rhea-lending", links: [{ label: "Rhea Lending", href: "https://app.rhea.finance/lending" }], expiresAt: Date.now() + 3 * 60_000 };
}

// ---------------------------------------------------------------- supply

export async function supply(p: { token: string; amount: string; collateral?: boolean; accountId?: string }): Promise<ActionCard> {
  const { t, id, a, native } = await marketFor(p.token, "deposit");
  const amount = BigInt(toBase(p.amount, t.decimals));
  const inner = amount * pow10(a.config.extra_decimals);
  const asCollateral = (p.collateral ?? true) && a.config.can_use_as_collateral;
  const warnings: string[] = [];
  if ((p.collateral ?? true) && !a.config.can_use_as_collateral) warnings.push(`${t.symbol} can't be used as collateral, so it's supplied for interest only.`);

  const transactions: PlannedTx[] = [];
  let health = "";
  if (p.accountId) {
    const st = await burrowStorageTx(p.accountId);
    if (st) {
      transactions.push(st);
      warnings.push("First time on Rhea Lending: 0.1 NEAR account storage deposit (refundable).");
    }
    const have = native ? BigInt(await getNativeBalance(p.accountId)) : BigInt(await ftBalance(id, p.accountId));
    if (have < amount) warnings.push(`You have ${fromBase(have, t.decimals)} ${t.symbol}, less than ${p.amount}.`);
    const msg = asCollateral ? JSON.stringify({ Execute: { actions: [{ IncreaseCollateral: { token_id: id, max_amount: inner.toString() } }] } }) : "";
    const actions = [];
    if (native) {
      const reg = await storageNeeded(WRAP_NEAR, p.accountId);
      if (reg) actions.push(fc("storage_deposit", { account_id: p.accountId, registration_only: true }, 30, reg));
      actions.push(fc("near_deposit", {}, 10, amount.toString()));
    }
    actions.push(ftTransferCall(BURROW, amount.toString(), msg, 250));
    appendTx(transactions, { receiverId: id, actions });
    if (asCollateral) health = fmtHealth(await healthAfter(await getAccount(p.accountId), { collateral: [id, inner] }));
  }

  return {
    ...baseCard("lend", `Supply ${p.amount} ${t.symbol}`),
    lines: [
      { label: "Market", value: `Rhea Lending · ${t.symbol}` },
      { label: "You supply", value: `${p.amount} ${t.symbol}` },
      { label: "Supply APR", value: pct(a.supply_apr) },
      { label: "Collateral", value: asCollateral ? "yes — you can borrow against it" : "no" },
      ...(health ? [{ label: "Health after", value: health }] : []),
    ],
    warnings,
    transactions,
    nearSpend: totalAttachedNear(transactions).toString(),
    usdIn: t.priceUsd ? Number(p.amount) * t.priceUsd : undefined,
    needsWallet: !p.accountId,
  };
}

// ---------------------------------------------------------------- borrow

export async function borrow(p: { token: string; amount: string; accountId?: string }): Promise<ActionCard> {
  const { t, id, a, native } = await marketFor(p.token, "borrow");
  const amount = BigInt(toBase(p.amount, t.decimals));
  const inner = amount * pow10(a.config.extra_decimals);
  const warnings: string[] = ["Borrowing can get you liquidated if your collateral falls in value. Keep health well above 1."];
  const transactions: PlannedTx[] = [];
  let health = "";
  if (p.accountId) {
    const acc = await getAccount(p.accountId);
    if (!acc || !acc.collateral.length) throw new Error("You have no collateral on Rhea Lending yet. Supply something first, e.g. \"supply 10 usdc\".");
    const h = await healthAfter(acc, { borrowed: [id, inner] });
    if (h < MIN_HEALTH) throw new Error(`That borrow would push your health factor to ${h.toFixed(2)} — too close to liquidation (1.0). Borrow less or add collateral.`);
    health = fmtHealth(h);
    transactions.push(...(await prepTxs({ accountId: p.accountId, outputToken: id })));
    transactions.push({
      receiverId: BURROW,
      actions: [fc("execute_with_pyth", { actions: [{ Borrow: { token_id: id, amount: inner.toString() } }, { Withdraw: { token_id: id, max_amount: inner.toString() } }] }, 300, ONE_YOCTO_DEPOSIT)],
    });
    if (native) transactions.push({ receiverId: WRAP_NEAR, actions: [fc("near_withdraw", { amount: amount.toString() }, 10, ONE_YOCTO_DEPOSIT)] });
  }
  return {
    ...baseCard("lend", `Borrow ${p.amount} ${t.symbol}`),
    lines: [
      { label: "Market", value: `Rhea Lending · ${t.symbol}` },
      { label: "You borrow", value: `${p.amount} ${t.symbol} (sent to your wallet)` },
      { label: "Borrow APR", value: pct(a.borrow_apr) },
      ...(health ? [{ label: "Health after", value: health }] : []),
    ],
    warnings,
    transactions,
    nearSpend: totalAttachedNear(transactions).toString(),
    needsWallet: !p.accountId,
  };
}

// ---------------------------------------------------------------- repay

export async function repay(p: { token: string; amount?: string; all?: boolean; accountId?: string }): Promise<ActionCard> {
  const { t, id, a, native } = await marketFor(p.token, "any");
  const extra = pow10(a.config.extra_decimals);
  const transactions: PlannedTx[] = [];
  const warnings: string[] = [];
  let amount = p.amount ? BigInt(toBase(p.amount, t.decimals)) : 0n;
  let owed = "";
  if (p.accountId) {
    const acc = await getAccount(p.accountId);
    const debt = BigInt(acc?.borrowed.find((b) => b.token_id === id)?.balance ?? "0");
    if (debt === 0n) throw new Error(`You don't owe any ${t.symbol} on Rhea Lending.`);
    const debtTokens = (debt + extra - 1n) / extra;
    owed = `${fromBase(debtTokens, t.decimals)} ${t.symbol}`;
    if (p.all || !amount || amount >= debtTokens) {
      amount = debtTokens + debtTokens / 500n + 1n; // +0.2% for interest accrued until it lands; extra stays supplied
      warnings.push("Repaying in full: a tiny buffer covers interest until the transaction lands; any extra stays supplied to you.");
    }
    const msg = JSON.stringify({ Execute: { actions: [{ Repay: { token_id: id, max_amount: (amount * extra).toString() } }] } });
    const actions = native ? [fc("near_deposit", {}, 10, amount.toString())] : [];
    actions.push(ftTransferCall(BURROW, amount.toString(), msg, 250));
    transactions.push({ receiverId: id, actions });
  } else if (!amount) throw new Error("How much do you want to repay?");
  return {
    ...baseCard("lend", `Repay ${t.symbol} loan`),
    lines: [
      ...(owed ? [{ label: "You owe", value: owed }] : []),
      { label: "You repay", value: `${fromBase(amount, t.decimals)} ${t.symbol}` },
    ],
    warnings,
    transactions,
    nearSpend: totalAttachedNear(transactions).toString(),
    needsWallet: !p.accountId,
  };
}

// ---------------------------------------------------------------- withdraw

export async function withdrawSupply(p: { token: string; amount?: string; all?: boolean; accountId?: string }): Promise<ActionCard> {
  const { t, id, a, native } = await marketFor(p.token, "any");
  const extra = pow10(a.config.extra_decimals);
  if (!p.accountId) throw new Error("Connect your wallet so I can see what you've supplied.");
  const acc = await getAccount(p.accountId);
  const sup = BigInt(acc?.supplied.find((b) => b.token_id === id)?.balance ?? "0");
  const col = BigInt(acc?.collateral.find((b) => b.token_id === id)?.balance ?? "0");
  const total = sup + col;
  if (total === 0n) throw new Error(`You have no ${t.symbol} supplied on Rhea Lending.`);
  let inner = p.all || !p.amount ? total : BigInt(toBase(p.amount, t.decimals)) * extra;
  if (inner > total) inner = total;
  const fromCollateral = inner > sup ? inner - sup : 0n;
  const h = fromCollateral > 0n ? await healthAfter(acc, { collateral: [id, -fromCollateral] }) : await healthAfter(acc);
  if (h < MIN_HEALTH) throw new Error(`Withdrawing that much would drop your health factor to ${h.toFixed(2)}. Repay some debt first or withdraw less.`);
  const actions: object[] = [];
  if (fromCollateral > 0n) actions.push({ DecreaseCollateral: { token_id: id, amount: fromCollateral.toString() } });
  actions.push({ Withdraw: { token_id: id, max_amount: inner.toString() } });
  const transactions: PlannedTx[] = [...(await prepTxs({ accountId: p.accountId, outputToken: id }))];
  transactions.push({ receiverId: BURROW, actions: [fc("execute_with_pyth", { actions }, 300, ONE_YOCTO_DEPOSIT)] });
  const tokens = inner / extra;
  if (native) transactions.push({ receiverId: WRAP_NEAR, actions: [fc("near_withdraw", { amount: tokens.toString() }, 10, ONE_YOCTO_DEPOSIT)] });
  return {
    ...baseCard("lend", `Withdraw ${t.symbol} from Rhea Lending`),
    lines: [
      { label: "You withdraw", value: `${fromBase(tokens, t.decimals)} ${t.symbol}` },
      { label: "Health after", value: fmtHealth(h) },
    ],
    warnings: [],
    transactions,
    nearSpend: totalAttachedNear(transactions).toString(),
  };
}

// ---------------------------------------------------------------- overview

export async function lendingOverview(accountId?: string) {
  const assets = await lendingAssets();
  const markets: { symbol: string; supplyApr: string; borrowApr: string; collateral: boolean }[] = [];
  for (const a of assets.values()) {
    if (!a.config.can_deposit && !a.config.can_borrow) continue;
    try {
      const sym = a.token_id === WRAP_NEAR ? "NEAR" : (await ftMetadata(a.token_id)).symbol;
      markets.push({ symbol: sym, supplyApr: pct(a.supply_apr), borrowApr: a.config.can_borrow ? pct(a.borrow_apr) : "—", collateral: a.config.can_use_as_collateral });
    } catch {
      /* skip */
    }
  }
  let position: unknown = undefined;
  if (accountId) {
    const acc = await getAccount(accountId);
    if (acc) {
      const fmt = async (b: Bal) => {
        const a = assets.get(b.token_id);
        const meta = await ftMetadata(b.token_id).catch(() => null);
        if (!a || !meta) return null;
        const tokens = BigInt(b.balance) / pow10(a.config.extra_decimals);
        return `${fromBase(tokens, meta.decimals, 4)} ${b.token_id === WRAP_NEAR ? "NEAR" : meta.symbol}`;
      };
      position = {
        supplied: (await Promise.all([...acc.supplied, ...acc.collateral].map(fmt))).filter(Boolean),
        borrowed: (await Promise.all(acc.borrowed.map(fmt))).filter(Boolean),
        health: fmtHealth(await healthAfter(acc)),
      };
    }
  }
  return { markets, position };
}

export type { TokenInfo };
