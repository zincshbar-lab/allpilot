// Rhea DCL (concentrated liquidity, dclv2.ref-labs.near).
// JustHoot (*.justhoot.near) and nearly.trade (*.nearlytrade.near) launch every meme token
// as one-sided liquidity in a DCL pool, so buying a meme = swapping wNEAR through DCL pools.

import { NEARLY_LAUNCHPAD as NEARLY_FACTORY, RHEA_DCL, WRAP_NEAR, view } from "./near";
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
// ---------------------------------------------------------------- official launch pools
// Anyone can open extra pools for a meme (NEARLY has 160+, HOOT 24) with thin or skewed liquidity.
// Meme trades are locked to the pool the token's own launchpad created at launch, read on-chain:
//  • JustHoot v1   — token.get_config().dcl_pool_id / dcl_quote_token_id
//  • JustHoot v2   — v2-pool-creator.justhoot.near.get_launch_state({token_id}).launch.plan.pool_id
//                    (+ v2-launchpad.justhoot.near.is_launched_token to confirm it's a real launch)
//  • nearly.trade  — nearlytrade.near launch record: pool_id + quote

export type OfficialPool = { poolId: string; quote: string; launchpad: "justhoot" | "nearly"; source: string };

export type NearlyLaunchFull = { id: number; token: string; creator: string; created_at_ms: number; dev_buy_near?: string; quote: string; pool_id: string };
let nearlyCache: { at: number; list: NearlyLaunchFull[] } | null = null;

export async function allNearlyLaunches(force = false): Promise<NearlyLaunchFull[]> {
  if (!force && nearlyCache && Date.now() - nearlyCache.at < 10 * 60_000) return nearlyCache.list;
  const n = Number(await view<number>(NEARLY_FACTORY, "get_num_launches"));
  const pages = await Promise.all(
    Array.from({ length: Math.ceil(n / 200) }, (_, i) =>
      view<NearlyLaunchFull[]>(NEARLY_FACTORY, "get_launches", { from_index: i * 200, limit: 200 })
        .then((l) => l.map((x) => ({ id: x.id, token: x.token, creator: x.creator, created_at_ms: x.created_at_ms, dev_buy_near: x.dev_buy_near, quote: x.quote, pool_id: x.pool_id })))
        .catch(() => []),
    ),
  );
  nearlyCache = { at: Date.now(), list: pages.flat() };
  return nearlyCache.list;
}

const officialCache = new Map<string, OfficialPool | null>();

export async function officialPool(tokenId: string): Promise<OfficialPool | null> {
  if (officialCache.has(tokenId)) return officialCache.get(tokenId)!;
  let found: OfficialPool | null = null;
  if (tokenId.endsWith(".v2-launchpad.justhoot.near")) {
    const [real, st] = await Promise.all([
      view<boolean>("v2-launchpad.justhoot.near", "is_launched_token", { token_id: tokenId }).catch(() => false),
      view<{ launch?: { quote_token_id: string; plan?: { pool_id: string } } } | null>("v2-pool-creator.justhoot.near", "get_launch_state", { token_id: tokenId }).catch(() => null),
    ]);
    if (real && st?.launch?.plan?.pool_id) found = { poolId: st.launch.plan.pool_id, quote: st.launch.quote_token_id, launchpad: "justhoot", source: "JustHoot v2 pool creator" };
  } else if (tokenId.endsWith(".launchpad.justhoot.near")) {
    const cfg = await view<{ dcl_pool_id?: string; dcl_quote_token_id?: string; platform_id?: string }>(tokenId, "get_config").catch(() => null);
    if (cfg?.dcl_pool_id && cfg.dcl_quote_token_id && cfg.platform_id === "launchpad.justhoot.near")
      found = { poolId: cfg.dcl_pool_id, quote: cfg.dcl_quote_token_id, launchpad: "justhoot", source: "JustHoot v1 token config" };
  } else if (tokenId.endsWith(`.${NEARLY_FACTORY}`)) {
    let l = (await allNearlyLaunches().catch(() => [])).find((x) => x.token === tokenId);
    if (!l) l = (await allNearlyLaunches(true).catch(() => [])).find((x) => x.token === tokenId); // brand-new launch
    if (l?.pool_id) found = { poolId: l.pool_id, quote: l.quote, launchpad: "nearly", source: "nearly.trade launch record" };
  }
  // the pool must actually exist on Rhea DCL and contain the token
  if (found) {
    const d = await dclPoolDetail(found.poolId);
    if (!d || (d.token_x !== tokenId && d.token_y !== tokenId)) found = null;
  }
  officialCache.set(tokenId, found);
  return found;
}

const FEES = [10000, 2000, 400, 100];
const poolIdFor = (a: string, b: string, fee: number) => (a < b ? `${a}|${b}|${fee}` : `${b}|${a}|${fee}`);

/** Pools between two non-meme tokens (e.g. PRL ↔ wNEAR), best liquidity first — used for the quote-asset hop. */
async function poolsBetween(a: string, b: string): Promise<string[]> {
  if (!poolCache) {
    const direct = (await Promise.all(FEES.map(async (f) => ((await dclPoolDetail(poolIdFor(a, b, f))) ? poolIdFor(a, b, f) : null)))).filter(Boolean) as string[];
    if (direct.length) return direct;
  }
  return (await dclPools()).filter((p) => (p.token_x === a && p.token_y === b) || (p.token_x === b && p.token_y === a)).map((p) => p.pool_id);
}

export class NoOfficialPoolError extends Error {}

async function candidateRoutes(tokenIn: string, tokenOut: string): Promise<string[][]> {
  const memeIn = launchpadOf(tokenIn) ? tokenIn : null;
  const memeOut = launchpadOf(tokenOut) ? tokenOut : null;
  if (memeIn || memeOut) {
    const [offIn, offOut] = await Promise.all([memeIn ? officialPool(memeIn) : null, memeOut ? officialPool(memeOut) : null]);
    if (memeIn && !offIn) throw new NoOfficialPoolError(`Couldn't verify ${memeIn}'s official launch pool, so I won't trade it through other pools.`);
    if (memeOut && !offOut) throw new NoOfficialPoolError(`Couldn't verify ${memeOut}'s official launch pool, so I won't trade it through other pools.`);
    // meme → meme: only when both launched against the same quote asset
    if (offIn && offOut) return offIn.quote === offOut.quote ? [[offIn.poolId, offOut.poolId]] : [];
    const off = (offIn ?? offOut)!;
    const other = memeIn ? tokenOut : tokenIn;
    if (off.quote === other) return [[off.poolId]];
    // meme launched against e.g. PRL/USDC: official meme hop + best pool between the quote asset and the other side
    const hop = await poolsBetween(off.quote, other);
    return hop.slice(0, 8).map((h) => (memeIn ? [off.poolId, h] : [h, off.poolId]));
  }
  return anyRoutes(tokenIn, tokenOut);
}

async function anyRoutes(tokenIn: string, tokenOut: string): Promise<string[][]> {
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
