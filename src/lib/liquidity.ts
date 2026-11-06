// Add liquidity to a Rhea (Ref) classic pool on v2.ref-finance.near.
//
// Flow the wallet signs (Ref's standard deposit → add_liquidity pattern):
//  1. v2.ref-finance.near: storage_deposit (first time only) + register_tokens([a, b])
//  2. each token: ft_transfer_call → v2.ref-finance.near with msg "" (deposits into your Rhea balance;
//     native NEAR is wrapped first)
//  3. v2.ref-finance.near: add_liquidity({pool_id, amounts}) — you receive LP shares
// Amounts follow the pool's current ratio; anything not used stays in your Rhea balance (withdraw on rhea.finance).

import type { ActionCard } from "./cards";
import { RHEA_V2, WRAP_NEAR, ftBalance, fromBase, getNativeBalance, toBase, view } from "./near";
import { resolveToken, type TokenInfo } from "./tokens";
import { ONE_YOCTO_DEPOSIT, appendTx, fc, ftTransferCall, totalAttachedNear, type PlannedTx } from "./tx";

const uid = () => Math.random().toString(36).slice(2, 10);
const REF_STORAGE = 10_000_000_000_000_000_000_000n; // 0.01 NEAR first-time Rhea account storage (kept as your storage balance)
const LP_STORAGE = 10_000_000_000_000_000_000_000n; // 0.01 NEAR for LP-share storage, as Rhea's UI attaches

type TopPool = { id: string; pool_kind: string; token_account_ids: string[]; amounts: string[]; tvl: string; total_fee: number; token_symbols?: string[] };
let poolCache: { at: number; pools: TopPool[] } | null = null;

async function topPools(): Promise<TopPool[]> {
  if (poolCache && Date.now() - poolCache.at < 10 * 60_000) return poolCache.pools;
  const res = await fetch("https://api.ref.finance/list-top-pools", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const pools = (await res.json()) as TopPool[];
  poolCache = { at: Date.now(), pools };
  return pools;
}

let allCache: { at: number; pools: TopPool[] } | null = null;
async function allPools(): Promise<TopPool[]> {
  if (allCache && Date.now() - allCache.at < 30 * 60_000) return allCache.pools;
  const n = await view<number>(RHEA_V2, "get_number_of_pools");
  const pages = await Promise.all(
    Array.from({ length: Math.ceil(n / 500) }, (_, i) =>
      view<Omit<TopPool, "id" | "tvl">[]>(RHEA_V2, "get_pools", { from_index: i * 500, limit: 500 }).then((ps) => ps.map((p, j) => ({ ...p, id: String(i * 500 + j), tvl: "0" }))),
    ),
  );
  allCache = { at: Date.now(), pools: pages.flat() };
  return allCache.pools;
}

/** Deepest simple pool for the pair (simple pools take any ratio-matched deposit). */
async function findPool(a: string, b: string, poolId?: number): Promise<TopPool | null> {
  if (poolId !== undefined) {
    const p = await view<{ pool_kind: string; token_account_ids: string[]; amounts: string[]; total_fee: number }>(RHEA_V2, "get_pool", { pool_id: poolId });
    return { id: String(poolId), pool_kind: p.pool_kind, token_account_ids: p.token_account_ids, amounts: p.amounts, total_fee: p.total_fee, tvl: "0" };
  }
  const pools = (await topPools()).filter(
    (p) => p.pool_kind === "SIMPLE_POOL" && p.token_account_ids.length === 2 && p.token_account_ids.includes(a) && p.token_account_ids.includes(b),
  );
  pools.sort((x, y) => Number(y.tvl) - Number(x.tvl));
  if (!pools[0]) {
    // The top-pools list skips some pools; scan the contract's full pool list (cached) for classic pools.
    const all = await allPools();
    const match = all
      .filter((x) => x.pool_kind === "SIMPLE_POOL" && x.token_account_ids.length === 2 && x.token_account_ids.includes(a) && x.token_account_ids.includes(b))
      .sort((x, y) => {
        // deepest first, measured in token `a`
        const ra = BigInt(x.amounts[x.token_account_ids.indexOf(a)]);
        const rb = BigInt(y.amounts[y.token_account_ids.indexOf(a)]);
        return rb > ra ? 1 : rb < ra ? -1 : 0;
      });
    if (match[0] && BigInt(match[0].amounts[0]) > 0n) return match[0];
    return null;
  }
  // refresh reserves on-chain (the API can lag)
  const live = await view<{ amounts: string[] }>(RHEA_V2, "get_pool", { pool_id: Number(pools[0].id) });
  return { ...pools[0], amounts: live.amounts };
}

export async function addLiquidity(p: { tokenA: string; tokenB: string; amountA: string; poolId?: number; accountId?: string }): Promise<ActionCard> {
  const [ra, rb] = await Promise.all([resolveToken(p.tokenA), resolveToken(p.tokenB)]);
  if (!ra.best) throw new Error(`I couldn't find a token called "${p.tokenA}".`);
  if (!rb.best) throw new Error(`I couldn't find a token called "${p.tokenB}".`);
  const A = ra.best;
  const B = rb.best;
  const idA = A.id === "near" ? WRAP_NEAR : A.id;
  const idB = B.id === "near" ? WRAP_NEAR : B.id;
  if (idA === idB) throw new Error("Pick two different tokens.");

  const pool = await findPool(idA, idB, p.poolId);
  if (!pool) throw new Error(`Rhea has no classic pool for ${A.symbol}/${B.symbol}. (Concentrated DCL pools aren't supported for adding liquidity yet.)`);
  if (pool.pool_kind !== "SIMPLE_POOL") throw new Error(`Pool #${pool.id} is a ${pool.pool_kind.toLowerCase().replace("_", " ")} — only classic pools are supported.`);

  const iA = pool.token_account_ids.indexOf(idA);
  const iB = pool.token_account_ids.indexOf(idB);
  if (iA < 0 || iB < 0) throw new Error(`Pool #${pool.id} isn't a ${A.symbol}/${B.symbol} pool.`);
  const resA = BigInt(pool.amounts[iA]);
  const resB = BigInt(pool.amounts[iB]);
  if (resA === 0n || resB === 0n) throw new Error(`Pool #${pool.id} is empty; its first deposit sets the price, which I won't guess for you.`);

  const amtA = BigInt(toBase(p.amountA, A.decimals));
  const amtB = (amtA * resB + resA - 1n) / resA; // same ratio as the pool, rounded up
  const amounts = pool.token_account_ids.map((t) => (t === idA ? amtA : amtB).toString());

  const warnings: string[] = [];
  const add = (t: TokenInfo, n: bigint) => `${fromBase(n.toString(), t.decimals)} ${t.symbol}`;
  if (p.accountId) {
    const have = async (t: TokenInfo, id: string) => (t.id === "near" ? BigInt(await getNativeBalance(p.accountId!)) : BigInt(await ftBalance(id, p.accountId!)));
    const [haveA, haveB] = await Promise.all([have(A, idA), have(B, idB)]);
    if (haveA < amtA) warnings.push(`You have ${fromBase(haveA.toString(), A.decimals)} ${A.symbol}, but this needs ${add(A, amtA)}.`);
    if (haveB < amtB) warnings.push(`You have ${fromBase(haveB.toString(), B.decimals)} ${B.symbol}, but this needs ${add(B, amtB)}.`);
  }
  for (const r of [ra, rb]) if (r.lookalikes > 0 && r.best) warnings.push(`${r.lookalikes} other token(s) use the symbol ${r.best.symbol}; using ${r.best.verified ? "the verified" : "the most-traded"} contract ${r.best.id}.`);
  warnings.push("Providing liquidity has impermanent-loss risk: if prices move, you can end up with less value than just holding.");
  warnings.push("Any amount the pool doesn't take stays in your Rhea balance — withdraw it on rhea.finance.");

  const transactions: PlannedTx[] = [];
  if (p.accountId) {
    const reg = await view<unknown>(RHEA_V2, "storage_balance_of", { account_id: p.accountId }).catch(() => null);
    const refActions = [];
    if (!reg) refActions.push(fc("storage_deposit", { account_id: p.accountId, registration_only: false }, 30, REF_STORAGE.toString()));
    refActions.push(fc("register_tokens", { token_ids: [idA, idB] }, 30, ONE_YOCTO_DEPOSIT));
    transactions.push({ receiverId: RHEA_V2, actions: refActions });
    for (const [t, id, amt] of [[A, idA, amtA], [B, idB, amtB]] as const) {
      const actions = [];
      if (t.id === "near") actions.push(fc("near_deposit", {}, 10, amt.toString()));
      actions.push(ftTransferCall(RHEA_V2, amt.toString(), "", 100));
      appendTx(transactions, { receiverId: id, actions });
    }
    transactions.push({ receiverId: RHEA_V2, actions: [fc("add_liquidity", { pool_id: Number(pool.id), amounts }, 50, LP_STORAGE.toString())] });
  }

  const tvl = Number(pool.tvl);
  return {
    id: uid(),
    kind: "lp",
    title: `Add liquidity · ${A.symbol}/${B.symbol}`,
    venue: "rhea",
    lines: [
      { label: "Pool", value: `Rhea #${pool.id} · ${pool.total_fee / 100}% fee${tvl > 0 ? ` · TVL $${Math.round(tvl).toLocaleString("en-US")}` : ""}` },
      { label: "You deposit", value: add(A, amtA) },
      { label: "Plus (pool ratio)", value: add(B, amtB) },
      { label: "You get", value: "LP shares — earn a cut of every swap fee" },
      { label: "Steps", value: `${transactions.length || 3} wallet transaction(s): register, deposit, add` },
    ],
    warnings,
    transactions,
    nearSpend: totalAttachedNear(transactions).toString(),
    usdIn: A.priceUsd && B.priceUsd ? (Number(amtA) / 10 ** A.decimals) * A.priceUsd + (Number(amtB) / 10 ** B.decimals) * B.priceUsd : undefined,
    needsWallet: !p.accountId,
    expiresAt: Date.now() + 3 * 60_000,
    links: [{ label: "Pool on Rhea", href: `https://app.rhea.finance/pool/${pool.id}` }],
  };
}
