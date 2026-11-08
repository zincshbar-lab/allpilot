// One router so NEAR can buy and sell any token, whatever it's paired with.
//
//  • Launchpad memes (JustHoot, nearly.trade): the meme leg is ALWAYS the official launch pool. The rest of the
//    way to NEAR (its quote asset → NEAR) uses the deepest path, through hub assets (NEAR / USDC / USDT) if needed.
//  • Everything else: every Rhea pool holding the token — classic (simple, stable, rated, degen) and DCL — measured in
//    USD liquidity; the route goes through the deepest one, then the deepest path from its pair to NEAR.
//  • Rhea classic and Rhea DCL are separate contracts, so one transaction can't use both. If the liquidity lives in
//    different venues, the route becomes TWO transactions signed together: the first one's guaranteed minimum output
//    is exactly what the second one spends (any extra from the first stays in your wallet).
//  • Safety floor: a route whose shallowest pool holds < $50 is refused.

import { NoOfficialPoolError, dclPoolDetail, dclPools, launchpadOf, officialPool, type OfficialPool } from "./dcl";
import { RHEA_DCL, RHEA_V2, WRAP_NEAR, view } from "./near";
import { rheaPrices } from "./tokens";
import { PlannedTx, appendTx, ftTransferCall, prepTxs } from "./tx";

export type Venue = "rhea" | "rhea-dcl";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT = "usdt.tether-token.near";
const HUBS = [WRAP_NEAR, USDC, USDT];

export const MIN_LIQUIDITY_USD = 50;
export class ThinLiquidityError extends Error {
  constructor(public bestUsd: number) {
    super(`The deepest route only holds ~$${bestUsd.toFixed(bestUsd < 10 ? 2 : 0)} of liquidity — below Allpilot's $${MIN_LIQUIDITY_USD} safety floor, so a trade would lose most of its value.`);
  }
}
export class NoRouteError extends Error {}

// ---------------------------------------------------------------- pool liquidity

type ClassicPool = { id: string; pool_kind: string; token_account_ids: string[]; tvl: string };
let classicCache: { at: number; pools: ClassicPool[] } | null = null;
async function classicPools(): Promise<ClassicPool[]> {
  if (classicCache && Date.now() - classicCache.at < 10 * 60_000) return classicCache.pools;
  const res = await fetch("https://api.ref.finance/list-top-pools", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  // every kind Rhea's exchange can swap through with the same action format
  const pools = ((await res.json()) as ClassicPool[]).filter((p) => ["SIMPLE_POOL", "STABLE_SWAP", "RATED_SWAP", "DEGEN_SWAP"].includes(p.pool_kind) && p.token_account_ids.length >= 2);
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
    tvl = vx !== undefined && vy !== undefined ? vx + vy : 2 * (vx ?? vy ?? 0); // unpriced side: assume a balanced pool
  }
  dclTvlCache.set(poolId, { at: Date.now(), tvl });
  return tvl;
}

type PoolRef = { venue: Venue; poolId: string; tvl: number };

/** Deepest pool in a venue that contains both tokens. */
async function deepestPool(venue: Venue, a: string, b: string): Promise<PoolRef | null> {
  if (venue === "rhea") {
    const p = (await classicPools()).filter((x) => x.token_account_ids.includes(a) && x.token_account_ids.includes(b)).sort((x, y) => Number(y.tvl) - Number(x.tvl))[0];
    return p ? { venue, poolId: p.id, tvl: Number(p.tvl) || 0 } : null;
  }
  const ps = (await dclPools()).filter((x) => (x.token_x === a && x.token_y === b) || (x.token_x === b && x.token_y === a));
  let best: PoolRef | null = null;
  for (const p of ps) {
    const tvl = await dclTvl(p.pool_id, p.token_x, p.token_y);
    if (!best || tvl > best.tvl) best = { venue, poolId: p.pool_id, tvl };
  }
  return best;
}

// ---------------------------------------------------------------- paths

/** A run of hops inside ONE venue (= one transaction). tokens has one more entry than poolIds. */
export type Segment = { venue: Venue; poolIds: string[]; tokens: string[]; liquidityUsd: number };

/** Deepest path from a to b inside one venue: direct, or through one hub asset. */
async function bestPath(venue: Venue, a: string, b: string): Promise<Segment | null> {
  if (a === b) return null;
  const cands: Segment[] = [];
  const direct = await deepestPool(venue, a, b);
  if (direct && direct.tvl > 0) cands.push({ venue, poolIds: [direct.poolId], tokens: [a, b], liquidityUsd: direct.tvl });
  for (const h of HUBS) {
    if (h === a || h === b) continue;
    const [p1, p2] = await Promise.all([deepestPool(venue, a, h), deepestPool(venue, h, b)]);
    if (p1 && p2 && p1.tvl > 0 && p2.tvl > 0) cands.push({ venue, poolIds: [p1.poolId, p2.poolId], tokens: [a, h, b], liquidityUsd: Math.min(p1.tvl, p2.tvl) });
  }
  // prefer the direct pool unless a hub route is much deeper (fewer hops = less fee and slippage)
  cands.sort((x, y) => y.liquidityUsd * (y.poolIds.length === 1 ? 2 : 1) - x.liquidityUsd * (x.poolIds.length === 1 ? 2 : 1));
  return cands[0] ?? null;
}

/** Path from a to b: same-venue if possible, else whichever venue has it. */
async function pathAny(a: string, b: string, prefer: Venue): Promise<Segment | null> {
  const other: Venue = prefer === "rhea" ? "rhea-dcl" : "rhea";
  const [p, q] = await Promise.all([bestPath(prefer, a, b), bestPath(other, a, b)]);
  if (p && (!q || p.liquidityUsd >= q.liquidityUsd / 3)) return p; // stay in one venue unless the other is far deeper
  return q ?? p;
}

/** Join consecutive segments that share a venue into one transaction. */
function merge(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.venue === s.venue) out[out.length - 1] = { venue: s.venue, poolIds: [...last.poolIds, ...s.poolIds], tokens: [...last.tokens, ...s.tokens.slice(1)], liquidityUsd: Math.min(last.liquidityUsd, s.liquidityUsd) };
    else out.push(s);
  }
  return out;
}

const reverse = (s: Segment): Segment => ({ ...s, poolIds: [...s.poolIds].reverse(), tokens: [...s.tokens].reverse() });

// ---------------------------------------------------------------- quoting & transactions

async function quoteSegment(s: Segment, amountIn: string): Promise<bigint> {
  if (s.venue === "rhea-dcl") {
    const q = await view<{ amount: string } | null>(RHEA_DCL, "quote", { pool_ids: s.poolIds, input_token: s.tokens[0], output_token: s.tokens.at(-1), input_amount: amountIn }).catch(() => null);
    return q ? BigInt(q.amount) : 0n;
  }
  let amt = amountIn;
  for (let i = 0; i < s.poolIds.length; i++) {
    amt = await view<string>(RHEA_V2, "get_return", { pool_id: Number(s.poolIds[i]), token_in: s.tokens[i], amount_in: amt, token_out: s.tokens[i + 1] }).catch(() => "0");
    if (amt === "0") return 0n;
  }
  return BigInt(amt);
}

function segmentTx(s: Segment, amountIn: string, minOut: string, unwrap: boolean): PlannedTx {
  let msg: string;
  if (s.venue === "rhea-dcl") {
    msg = JSON.stringify({ Swap: { pool_ids: s.poolIds, output_token: s.tokens.at(-1), min_output_amount: minOut, skip_unwrap_near: !unwrap } });
  } else {
    const actions = s.poolIds.map((id, i) => ({
      pool_id: Number(id),
      token_in: s.tokens[i],
      token_out: s.tokens[i + 1],
      ...(i === 0 ? { amount_in: amountIn } : {}),
      min_amount_out: i === s.poolIds.length - 1 ? minOut : "0",
    }));
    msg = JSON.stringify({ force: 0, actions, skip_unwrap_near: !unwrap });
  }
  return { receiverId: s.tokens[0], actions: [ftTransferCall(s.venue === "rhea-dcl" ? RHEA_DCL : RHEA_V2, amountIn, msg, 250)] };
}

export type RoutePlan = {
  segments: Segment[]; // 1 = single transaction; 2 = two linked transactions
  liquidityUsd: number;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  transactions: PlannedTx[];
  official?: OfficialPool;
  leftoverToken?: string; // two-step routes: the in-between token any surplus is left in
};

// ---------------------------------------------------------------- the router

async function candidates(tin: string, tout: string): Promise<{ segs: Segment[]; official?: OfficialPool }[]> {
  const memeIn = launchpadOf(tin) ? tin : null;
  const memeOut = launchpadOf(tout) ? tout : null;

  // launchpad memes: the meme leg is the official launch pool
  if (memeIn || memeOut) {
    const meme = (memeIn ?? memeOut)!;
    const off = await officialPool(meme);
    if (!off) throw new NoOfficialPoolError(`Couldn't verify ${meme}'s official launch pool, so I won't trade it through other pools.`);
    const memeLeg: Segment = { venue: "rhea-dcl", poolIds: [off.poolId], tokens: memeIn ? [meme, off.quote] : [off.quote, meme], liquidityUsd: Infinity };
    const other = memeIn ? tout : tin;
    if (memeIn && memeOut) {
      // meme → meme: through both official pools (their quotes must connect)
      const off2 = await officialPool(memeOut);
      if (!off2) throw new NoOfficialPoolError(`Couldn't verify ${memeOut}'s official launch pool.`);
      const mid = off.quote === off2.quote ? null : await pathAny(off.quote, off2.quote, "rhea-dcl");
      if (off.quote !== off2.quote && !mid) return [];
      const leg2: Segment = { venue: "rhea-dcl", poolIds: [off2.poolId], tokens: [off2.quote, memeOut], liquidityUsd: Infinity };
      return [{ segs: merge([memeLeg, ...(mid ? [mid] : []), leg2]), official: off }];
    }
    if (off.quote === other) return [{ segs: [memeLeg], official: off }];
    const link = await pathAny(memeIn ? off.quote : other, memeIn ? other : off.quote, "rhea-dcl");
    if (!link) return [];
    return [{ segs: merge(memeIn ? [memeLeg, link] : [link, memeLeg]), official: off }];
  }

  // everything else: start from the deepest pools holding the long-tail side
  const T = HUBS.includes(tin) ? tout : tin;
  const O = T === tin ? tout : tin;
  const [classic, dcl] = await Promise.all([classicPools().catch(() => []), dclPools().catch(() => [])]);
  const legs: (PoolRef & { other: string })[] = [];
  for (const p of classic.filter((x) => x.token_account_ids.includes(T)))
    for (const o of p.token_account_ids) if (o !== T) legs.push({ venue: "rhea", poolId: p.id, tvl: Number(p.tvl) || 0, other: o });
  for (const p of dcl.filter((x) => x.token_x === T || x.token_y === T).slice(0, 40))
    legs.push({ venue: "rhea-dcl", poolId: p.pool_id, tvl: await dclTvl(p.pool_id, p.token_x, p.token_y), other: p.token_x === T ? p.token_y : p.token_x });
  legs.sort((a, b) => b.tvl - a.tvl);

  const out: { segs: Segment[] }[] = [];
  for (const leg of legs.slice(0, 6)) {
    if (leg.tvl <= 0) continue;
    const first: Segment = { venue: leg.venue, poolIds: [leg.poolId], tokens: [T, leg.other], liquidityUsd: leg.tvl };
    if (leg.other === O) {
      out.push({ segs: [T === tin ? first : reverse(first)] });
      continue;
    }
    const link = await pathAny(leg.other, O, leg.venue);
    if (!link) continue;
    const forward = merge([first, link]); // T → … → O
    out.push({ segs: T === tin ? forward : forward.map(reverse).reverse() });
  }
  return out;
}

/** Plan tokenIn → tokenOut ("near" = native NEAR) through official pools / the deepest liquidity. */
export async function planRoute(opts: { tokenIn: string; tokenOut: string; amountIn: string; slippageBps: number; accountId?: string; enforceFloor?: boolean }): Promise<RoutePlan> {
  const nativeIn = opts.tokenIn === "near";
  const nativeOut = opts.tokenOut === "near";
  const tin = nativeIn ? WRAP_NEAR : opts.tokenIn;
  const tout = nativeOut ? WRAP_NEAR : opts.tokenOut;

  const cands = (await candidates(tin, tout)).map((c) => ({ ...c, liquidityUsd: Math.min(...c.segs.map((s) => s.liquidityUsd)) }));
  if (!cands.length) throw new NoRouteError(`No route from ${tin} to ${tout} on Rhea.`);
  cands.sort((a, b) => a.segs.length - b.segs.length || b.liquidityUsd - a.liquidityUsd); // one transaction first, then deepest
  const best = cands.reduce((x, y) => (y.liquidityUsd > x.liquidityUsd * 3 ? y : x)); // …unless another route is far deeper
  const ordered = [best, ...cands.filter((c) => c !== best)];
  if (opts.enforceFloor !== false && Math.max(...cands.map((c) => c.liquidityUsd)) < MIN_LIQUIDITY_USD)
    throw new ThinLiquidityError(Math.max(...cands.map((c) => (Number.isFinite(c.liquidityUsd) ? c.liquidityUsd : 0))));

  for (const c of ordered.slice(0, 3)) {
    if (opts.enforceFloor !== false && c.liquidityUsd < MIN_LIQUIDITY_USD) continue;
    // quote segment by segment; a later segment spends the earlier one's guaranteed minimum
    let input = opts.amountIn;
    const mins: string[] = [];
    let out = 0n;
    let ok = true;
    for (const s of c.segs) {
      out = await quoteSegment(s, input);
      if (out <= 0n) {
        ok = false;
        break;
      }
      const min = (out * BigInt(10_000 - opts.slippageBps)) / 10_000n;
      mins.push(min.toString());
      input = min.toString();
    }
    if (!ok) continue;

    let transactions: PlannedTx[] = [];
    if (opts.accountId) {
      // register for the final token and any in-between token we'll receive (two-step routes)
      transactions = await prepTxs({ accountId: opts.accountId, wrapAmount: nativeIn ? opts.amountIn : undefined, outputToken: tout });
      for (let i = 0; i < c.segs.length - 1; i++) {
        const mid = c.segs[i].tokens.at(-1)!;
        const reg = await prepTxs({ accountId: opts.accountId, outputToken: mid });
        transactions.unshift(...reg);
      }
      let spend = opts.amountIn;
      c.segs.forEach((s, i) => {
        appendTx(transactions, segmentTx(s, spend, mins[i], nativeOut && i === c.segs.length - 1));
        spend = mins[i];
      });
    }
    return {
      segments: c.segs,
      liquidityUsd: c.liquidityUsd,
      amountIn: opts.amountIn,
      amountOut: out.toString(),
      minAmountOut: mins.at(-1)!,
      transactions,
      official: "official" in c ? c.official : undefined,
      leftoverToken: c.segs.length > 1 ? c.segs[0].tokens.at(-1) : undefined,
    };
  }
  throw new NoRouteError("The routes found can't fill this amount right now.");
}
