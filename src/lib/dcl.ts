// Rhea DCL (concentrated liquidity, dclv2.ref-labs.near).
// JustHoot (*.justhoot.near) and nearly.trade (*.nearlytrade.near) launch every meme token
// as one-sided liquidity in a DCL pool, so buying a meme = swapping wNEAR through DCL pools.

import { RHEA_DCL, WRAP_NEAR, view } from "./near";
import { PlannedTx, appendTx, ftTransferCall, prepTxs } from "./tx";

export type DclPool = { pool_id: string; token_x: string; token_y: string; fee: number };
export type DclPoolDetail = DclPool & { volume_x_in: string; volume_y_in: string; liquidity: string };

let poolCache: { at: number; pools: DclPool[] } | null = null;

export async function dclPools(): Promise<DclPool[]> {
  if (poolCache && Date.now() - poolCache.at < 10 * 60_000) return poolCache.pools;
  const pools: DclPool[] = [];
  const LIMIT = 400;
  for (let from = 0; from < 50_000; from += LIMIT) {
    const page = await view<DclPool[]>(RHEA_DCL, "list_pools", { from_index: from, limit: LIMIT });
    pools.push(...page.map((p) => ({ pool_id: p.pool_id, token_x: p.token_x, token_y: p.token_y, fee: p.fee })));
    if (page.length < LIMIT) break;
  }
  poolCache = { at: Date.now(), pools };
  return pools;
}

export function launchpadOf(tokenId: string): "justhoot" | "nearly" | null {
  if (tokenId.endsWith(".justhoot.near")) return "justhoot";
  if (tokenId.endsWith(".nearlytrade.near")) return "nearly";
  return null;
}

export async function dclPoolDetail(poolId: string): Promise<DclPoolDetail | null> {
  try {
    return await view<DclPoolDetail>(RHEA_DCL, "get_pool", { pool_id: poolId });
  } catch {
    return null;
  }
}

async function dclQuote(poolIds: string[], inputToken: string, outputToken: string, amount: string): Promise<bigint> {
  try {
    const r = await view<{ amount: string } | null>(RHEA_DCL, "quote", {
      pool_ids: poolIds,
      input_token: inputToken,
      output_token: outputToken,
      input_amount: amount,
    });
    return r ? BigInt(r.amount) : 0n;
  } catch {
    return 0n;
  }
}

/** Candidate routes from tokenIn to tokenOut: direct pools, or two hops via a shared middle token. */
const FEES = [10000, 2000, 400, 100];
const poolIdFor = (a: string, b: string, fee: number) => (a < b ? `${a}|${b}|${fee}` : `${b}|${a}|${fee}`);

async function candidateRoutes(tokenIn: string, tokenOut: string): Promise<string[][]> {
  // Fast path: launchpad tokens almost always have a direct pool, so probe likely ids before
  // loading the full ~6.5k pool index.
  if (!poolCache) {
    const direct = await Promise.all(FEES.map(async (f) => ((await dclPoolDetail(poolIdFor(tokenIn, tokenOut, f))) ? [poolIdFor(tokenIn, tokenOut, f)] : null)));
    const found = direct.filter(Boolean) as string[][];
    if (found.length) return found;
  }
  const pools = await dclPools();
  const touching = (t: string) => pools.filter((p) => p.token_x === t || p.token_y === t);
  const other = (p: DclPool, t: string) => (p.token_x === t ? p.token_y : p.token_x);
  const inPools = touching(tokenIn);
  const outPools = touching(tokenOut);
  const routes: string[][] = [];
  for (const p of inPools) if (other(p, tokenIn) === tokenOut) routes.push([p.pool_id]);
  for (const a of inPools) {
    const mid = other(a, tokenIn);
    if (mid === tokenOut) continue;
    for (const b of outPools) if (other(b, tokenOut) === mid) routes.push([a.pool_id, b.pool_id]);
  }
  return routes.slice(0, 12);
}

export type DclSwapPlan = {
  poolIds: string[];
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  transactions: PlannedTx[];
};

export async function planDclSwap(opts: {
  tokenIn: string; // "near" for native NEAR
  tokenOut: string; // "near" for native NEAR
  amountIn: string; // base units
  slippageBps: number;
  accountId?: string;
}): Promise<DclSwapPlan | null> {
  const nativeIn = opts.tokenIn === "near";
  const nativeOut = opts.tokenOut === "near";
  const tin = nativeIn ? WRAP_NEAR : opts.tokenIn;
  const tout = nativeOut ? WRAP_NEAR : opts.tokenOut;
  const routes = await candidateRoutes(tin, tout);
  if (!routes.length) return null;
  const quotes = await Promise.all(routes.map((r) => dclQuote(r, tin, tout, opts.amountIn)));
  let best = -1;
  quotes.forEach((q, i) => {
    if (q > 0n && (best < 0 || q > quotes[best])) best = i;
  });
  if (best < 0) return null;
  const amountOut = quotes[best];
  const minOut = (amountOut * BigInt(10_000 - opts.slippageBps)) / 10_000n;

  let transactions: PlannedTx[] = [];
  if (opts.accountId) {
    transactions = await prepTxs({
      accountId: opts.accountId,
      wrapAmount: nativeIn ? opts.amountIn : undefined,
      outputToken: tout,
    });
    const msg = JSON.stringify({
      Swap: {
        pool_ids: routes[best],
        output_token: tout,
        min_output_amount: minOut.toString(),
        skip_unwrap_near: !nativeOut,
      },
    });
    appendTx(transactions, { receiverId: tin, actions: [ftTransferCall(RHEA_DCL, opts.amountIn, msg)] });
  }
  return {
    poolIds: routes[best],
    amountIn: opts.amountIn,
    amountOut: amountOut.toString(),
    minAmountOut: minOut.toString(),
    transactions,
  };
}

// ---------- discovery: fresh nearly.trade launches ----------

export type NearlyLaunch = {
  id: number;
  token: string;
  name: string;
  symbol: string;
  description?: string | null;
  created_at_ms: number;
  pool_id: string;
  quote: string;
};

export async function latestNearlyLaunches(limit = 8): Promise<NearlyLaunch[]> {
  const list = await view<NearlyLaunch[]>("nearlytrade.near", "get_launches", { from_index: 0, limit });
  return list.map((l) => ({
    id: l.id,
    token: l.token,
    name: l.name,
    symbol: l.symbol,
    description: l.description,
    created_at_ms: l.created_at_ms,
    pool_id: l.pool_id,
    quote: l.quote,
  }));
}
