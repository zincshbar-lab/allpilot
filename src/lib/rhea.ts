// Rhea Finance (formerly Ref Finance) classic AMM via its public smart router.
// Router: https://smartrouter.ref.finance/findPath  ·  Exchange contract: v2.ref-finance.near

import { RHEA_V2, WRAP_NEAR } from "./near";
import { PlannedTx, appendTx, ftTransferCall, prepTxs } from "./tx";

type RouterPool = {
  pool_id: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  min_amount_out: string;
};
type RouterResp = {
  result_code: number;
  result_message: string;
  result_data: { routes: { pools: RouterPool[] }[]; amount_out: string } | null;
};

export type RheaSwapPlan = {
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  hops: string[];
  transactions: PlannedTx[];
};

export async function planRheaSwap(opts: {
  tokenIn: string; // "near" for native
  tokenOut: string; // "near" for native
  amountIn: string;
  slippageBps: number;
  accountId?: string;
}): Promise<RheaSwapPlan | null> {
  const nativeIn = opts.tokenIn === "near";
  const nativeOut = opts.tokenOut === "near";
  const tin = nativeIn ? WRAP_NEAR : opts.tokenIn;
  const tout = nativeOut ? WRAP_NEAR : opts.tokenOut;

  const u = new URL("https://smartrouter.ref.finance/findPath");
  u.searchParams.set("amountIn", opts.amountIn);
  u.searchParams.set("tokenIn", tin);
  u.searchParams.set("tokenOut", tout);
  u.searchParams.set("pathDeep", "3");
  u.searchParams.set("slippage", String(opts.slippageBps / 10_000));
  const res = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const json = (await res.json()) as RouterResp;
  if (json.result_code !== 0 || !json.result_data?.routes?.length) return null;

  const routes = json.result_data.routes;
  const amountOut = BigInt(json.result_data.amount_out);
  const minOut = (amountOut * BigInt(10_000 - opts.slippageBps)) / 10_000n;
  // Ref action list: amount_in only on each route's first hop; per-hop mins are 0 and the
  // final guard is enforced by the wallet-visible minimum on the last hops (scaled).
  const routeMinSum = routes.reduce((s, r) => s + BigInt(r.pools[r.pools.length - 1].min_amount_out || "0"), 0n);
  const actions = routes.flatMap((r) =>
    r.pools.map((p, i) => {
      const last = i === r.pools.length - 1;
      let min = "0";
      if (last && routeMinSum > 0n) {
        // distribute our slippage-adjusted minimum across split routes proportionally
        min = ((BigInt(p.min_amount_out || "0") * minOut) / routeMinSum).toString();
      }
      return {
        pool_id: Number(p.pool_id),
        token_in: p.token_in,
        token_out: p.token_out,
        ...(i === 0 ? { amount_in: p.amount_in } : {}),
        min_amount_out: min,
      };
    }),
  );

  let transactions: PlannedTx[] = [];
  if (opts.accountId) {
    transactions = await prepTxs({
      accountId: opts.accountId,
      wrapAmount: nativeIn ? opts.amountIn : undefined,
      outputToken: tout,
    });
    const msg = JSON.stringify({ force: 0, actions, skip_unwrap_near: !nativeOut });
    appendTx(transactions, { receiverId: tin, actions: [ftTransferCall(RHEA_V2, opts.amountIn, msg, 250)] });
  }

  return {
    amountIn: opts.amountIn,
    amountOut: amountOut.toString(),
    minAmountOut: minOut.toString(),
    hops: [tin, ...routes[0].pools.map((p) => p.token_out)],
    transactions,
  };
}
