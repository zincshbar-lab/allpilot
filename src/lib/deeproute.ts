// Deepest-liquidity routing for tokens that don't come from a supported launchpad.
//
// Long-tail tokens often have many pools, some tiny. A tiny pool can show a nice quote for a small
// amount and then slip hard (or be a deliberately skewed "fake LP"). So instead of "best quote anywhere",
// we route through the pool with the most real liquidity (USD TVL):
//   1. every pool holding the token — Rhea classic (TVL from Rhea's API) and Rhea DCL (total_x/total_y × prices)
//   2. if that pool's other token isn't what you're paying/receiving, add the deepest pool between that
//      token and yours in the SAME venue (one transaction can't mix classic and DCL)
//   3. a route is as deep as its shallowest pool → pick the deepest route, quote it exactly on-chain.

import { dclPoolDetail, dclPools } from "./dcl";
import { RHEA_DCL, RHEA_V2, WRAP_NEAR, view } from "./near";
import { rheaPrices } from "./tokens";
import { PlannedTx, appendTx, ftTransferCall, prepTxs } from "./tx";

type ClassicPool = { id: string; pool_kind: string; token_account_ids: string[]; tvl: string };
let classicCache: { at: number; pools: ClassicPool[] } | null = null;
async function classicPools(): Promise<ClassicPool[]> {
  if (classicCache && Date.now() - classicCache.at < 10 * 60_000) return classicCache.pools;
  const res = await fetch("https://api.ref.finance/list-top-pools", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const pools = ((await res.json()) as ClassicPool[]).filter((p) => p.pool_kind === "SIMPLE_POOL" && p.token_account_ids.length === 2);
  classicCache = { at: Date.now(), pools };
  return pools;
}

const dclTvlCache = new Map<string, { at: number; tvl: number }>();
async function dclTvl(poolId: string, x: string, y: string): Promise<number> {
  const hit = dclTvlCache.get(poolId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.tvl;
  const [d, prices] = await Promise.all([dclPoolDetail(poolId) as Promise<null | { total_x?: string; total_y?: string }>, rheaPrices()]);
  let tvl = 0;
  if (d?.total_x && d?.total_y) {
    const side = (t: string, amt: string) => {
      const p = prices[t];
      return p && Number(p.price) > 0 ? (Number(amt) / 10 ** p.decimal) * Number(p.price) : undefined;
    };
    const vx = side(x, d.total_x);
    const vy = side(y, d.total_y);
    // if one side has no price (long-tail token), assume a balanced pool: 2 × the priced side
    tvl = vx !== undefined && vy !== undefined ? vx + vy : 2 * (vx ?? vy ?? 0);
  }
  dclTvlCache.set(poolId, { at: Date.now(), tvl });
  return tvl;
}

type Leg = { venue: "rhea" | "rhea-dcl"; poolId: string; other: string; tvl: number };

export const MIN_LIQUIDITY_USD = 50;
export class ThinLiquidityError extends Error {
  constructor(public bestUsd: number) {
    super(`The deepest pool only holds ~$${bestUsd.toFixed(bestUsd < 10 ? 2 : 0)} of liquidity — below Allpilot's $${MIN_LIQUIDITY_USD} safety floor, so a trade would lose most of its value.`);
  }
}

async function legsFor(token: string): Promise<Leg[]> {
  const [classic, dcl] = await Promise.all([classicPools().catch(() => []), dclPools().catch(() => [])]);
  const legs: Leg[] = classic
    .filter((p) => p.token_account_ids.includes(token))
    .map((p) => ({ venue: "rhea" as const, poolId: p.id, other: p.token_account_ids.find((t) => t !== token)!, tvl: Number(p.tvl) || 0 }));
  const dclPoolsFor = dcl.filter((p) => p.token_x === token || p.token_y === token).slice(0, 15);
  for (const p of dclPoolsFor) legs.push({ venue: "rhea-dcl", poolId: p.pool_id, other: p.token_x === token ? p.token_y : p.token_x, tvl: await dclTvl(p.pool_id, p.token_x, p.token_y) });
  return legs.sort((a, b) => b.tvl - a.tvl);
}

async function deepestBetween(venue: Leg["venue"], a: string, b: string): Promise<Leg | null> {
  if (venue === "rhea") {
    const p = (await classicPools()).filter((x) => x.token_account_ids.includes(a) && x.token_account_ids.includes(b)).sort((x, y) => Number(y.tvl) - Number(x.tvl))[0];
    return p ? { venue, poolId: p.id, other: b, tvl: Number(p.tvl) || 0 } : null;
  }
  const ps = (await dclPools()).filter((x) => (x.token_x === a && x.token_y === b) || (x.token_x === b && x.token_y === a));
  let best: Leg | null = null;
  for (const p of ps) {
    const tvl = await dclTvl(p.pool_id, p.token_x, p.token_y);
    if (!best || tvl > best.tvl) best = { venue, poolId: p.pool_id, other: b, tvl };
  }
  return best;
}

export type DeepRoute = {
  venue: "rhea" | "rhea-dcl";
  poolIds: string[];
  tokens: string[]; // path, e.g. [wrap.near, usdc, TOKEN]
  liquidityUsd: number; // shallowest pool on the route
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  transactions: PlannedTx[];
};

async function quoteRoute(r: { venue: Leg["venue"]; poolIds: string[]; tokens: string[] }, amountIn: string): Promise<bigint> {
  if (r.venue === "rhea-dcl") {
    const q = await view<{ amount: string } | null>(RHEA_DCL, "quote", { pool_ids: r.poolIds, input_token: r.tokens[0], output_token: r.tokens.at(-1), input_amount: amountIn }).catch(() => null);
    return q ? BigInt(q.amount) : 0n;
  }
  let amt = amountIn;
  for (let i = 0; i < r.poolIds.length; i++) {
    amt = await view<string>(RHEA_V2, "get_return", { pool_id: Number(r.poolIds[i]), token_in: r.tokens[i], amount_in: amt, token_out: r.tokens[i + 1] }).catch(() => "0");
    if (amt === "0") return 0n;
  }
  return BigInt(amt);
}

/** Route `tokenIn → tokenOut` where one side is a long-tail token, through the deepest liquidity. */
export async function planDeepSwap(opts: { tokenIn: string; tokenOut: string; amountIn: string; slippageBps: number; accountId?: string; longTail: string }): Promise<DeepRoute | null> {
  const nativeIn = opts.tokenIn === "near";
  const nativeOut = opts.tokenOut === "near";
  const tin = nativeIn ? WRAP_NEAR : opts.tokenIn;
  const tout = nativeOut ? WRAP_NEAR : opts.tokenOut;
  const T = opts.longTail;
  const O = T === tin ? tout : tin; // the side you pay with / receive

  const legs = await legsFor(T);
  type Cand = { venue: Leg["venue"]; poolIds: string[]; tokens: string[]; liquidityUsd: number };
  const cands: Cand[] = [];
  for (const leg of legs.slice(0, 10)) {
    if (leg.tvl <= 0) continue;
    if (leg.other === O) {
      cands.push({ venue: leg.venue, poolIds: [leg.poolId], tokens: T === tin ? [T, O] : [O, T], liquidityUsd: leg.tvl });
      continue;
    }
    const hop = await deepestBetween(leg.venue, leg.other, O);
    if (!hop || hop.tvl <= 0) continue;
    const liq = Math.min(leg.tvl, hop.tvl);
    cands.push(
      T === tin
        ? { venue: leg.venue, poolIds: [leg.poolId, hop.poolId], tokens: [T, leg.other, O], liquidityUsd: liq }
        : { venue: leg.venue, poolIds: [hop.poolId, leg.poolId], tokens: [O, leg.other, T], liquidityUsd: liq },
    );
  }
  // refuse dust pools outright — a $0–50 pool can eat almost the whole trade
  const real = cands.filter((c) => c.liquidityUsd >= MIN_LIQUIDITY_USD);
  if (!real.length) throw new ThinLiquidityError(cands.length ? Math.max(...cands.map((c) => c.liquidityUsd)) : 0);
  cands.length = 0;
  cands.push(...real.sort((a, b) => b.liquidityUsd - a.liquidityUsd));

  // deepest route first; only fall to the next if the deepest can't quote this amount
  for (const c of cands.slice(0, 3)) {
    const out = await quoteRoute(c, opts.amountIn);
    if (out <= 0n) continue;
    const minOut = (out * BigInt(10_000 - opts.slippageBps)) / 10_000n;
    let transactions: PlannedTx[] = [];
    if (opts.accountId) {
      transactions = await prepTxs({ accountId: opts.accountId, wrapAmount: nativeIn ? opts.amountIn : undefined, outputToken: tout });
      let msg: string;
      if (c.venue === "rhea-dcl") {
        msg = JSON.stringify({ Swap: { pool_ids: c.poolIds, output_token: tout, min_output_amount: minOut.toString(), skip_unwrap_near: !nativeOut } });
      } else {
        const actions = c.poolIds.map((id, i) => ({
          pool_id: Number(id),
          token_in: c.tokens[i],
          token_out: c.tokens[i + 1],
          ...(i === 0 ? { amount_in: opts.amountIn } : {}),
          min_amount_out: i === c.poolIds.length - 1 ? minOut.toString() : "0",
        }));
        msg = JSON.stringify({ force: 0, actions, skip_unwrap_near: !nativeOut });
      }
      appendTx(transactions, { receiverId: tin, actions: [ftTransferCall(c.venue === "rhea-dcl" ? RHEA_DCL : RHEA_V2, opts.amountIn, msg, 250)] });
    }
    return { venue: c.venue, poolIds: c.poolIds, tokens: c.tokens, liquidityUsd: c.liquidityUsd, amountIn: opts.amountIn, amountOut: out.toString(), minAmountOut: minOut.toString(), transactions };
  }
  return null;
}
