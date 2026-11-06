// Portfolio: every token the wallet holds (memes included) with a real USD price.
// Prices: Rhea's price list first; tokens it doesn't price (fresh launchpad memes) are priced live by
// quoting a sale of 1 token into wNEAR through their Rhea DCL pool.

import type { ActionCard } from "./cards";
import { planDclSwap } from "./dcl";
import { heldTokens } from "./history";
import { WRAP_NEAR, fromBase, ftMetadata, getNativeBalance } from "./near";
import { rheaPrices, VERIFIED } from "./tokens";
import { launchpadName } from "./launchpads";

const uid = () => Math.random().toString(36).slice(2, 10);

export type PortfolioRow = {
  token: string;
  symbol: string;
  amount: string;
  priceUsd?: number;
  valueUsd?: number;
  launchpad?: string;
  verified?: boolean;
  priceSource?: "rhea" | "pool";
};

/** USD price for one whole token, or undefined if it has no market. */
export async function priceUsd(tokenId: string, decimals: number): Promise<{ price?: number; source?: "rhea" | "pool" }> {
  const prices = await rheaPrices();
  const p = prices[tokenId === "near" ? WRAP_NEAR : tokenId];
  if (p && Number(p.price) > 0) return { price: Number(p.price), source: "rhea" };
  const nearUsd = Number(prices[WRAP_NEAR]?.price ?? 0);
  if (!nearUsd) return {};
  const plan = await planDclSwap({ tokenIn: tokenId, tokenOut: "near", amountIn: (10n ** BigInt(decimals)).toString(), slippageBps: 100 }).catch(() => null);
  if (!plan || plan.amountOut === "0") return {};
  return { price: (Number(plan.amountOut) / 1e24) * nearUsd, source: "pool" };
}

const fmtUsd = (n?: number) =>
  n === undefined ? "—" : n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? "<$0.01" : "$0";
export const fmtPrice = (n?: number) => (n === undefined ? "no market" : n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toPrecision(3)}`);

export async function portfolio(accountId: string): Promise<{ rows: PortfolioRow[]; totalUsd: number; unpriced: number }> {
  const [held, nearBal, prices] = await Promise.all([heldTokens(accountId), getNativeBalance(accountId), rheaPrices()]);
  const verifiedIds = new Set(Object.values(VERIFIED));
  const rows: PortfolioRow[] = [];
  const nearUsd = Number(prices[WRAP_NEAR]?.price ?? 0);
  rows.push({ token: "near", symbol: "NEAR", amount: fromBase(nearBal, 24, 4), priceUsd: nearUsd || undefined, valueUsd: (Number(nearBal) / 1e24) * nearUsd, verified: true, priceSource: "rhea" });

  // price in parallel, but politely (RPC + pool quotes)
  const list = held.slice(0, 60);
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(
      list.slice(i, i + 8).map(async (h) => {
        const meta = await ftMetadata(h.contract_id).catch(() => null);
        if (!meta) return;
        const { price, source } = await priceUsd(h.contract_id, meta.decimals);
        const amount = Number(h.balance) / 10 ** meta.decimals;
        rows.push({
          token: h.contract_id,
          symbol: h.contract_id === WRAP_NEAR ? "wNEAR" : meta.symbol,
          amount: fromBase(h.balance, meta.decimals, 4),
          priceUsd: price,
          valueUsd: price !== undefined ? amount * price : undefined,
          launchpad: launchpadName(h.contract_id) ?? undefined,
          verified: verifiedIds.has(h.contract_id),
          priceSource: source,
        });
      }),
    );
  }
  rows.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  const totalUsd = rows.reduce((s, r) => s + (r.valueUsd ?? 0), 0);
  return { rows, totalUsd, unpriced: rows.filter((r) => r.priceUsd === undefined).length };
}

export async function portfolioCard(accountId: string): Promise<ActionCard> {
  const p = await portfolio(accountId);
  const memes = p.rows.filter((r) => r.launchpad);
  const shown = p.rows.filter((r) => (r.valueUsd ?? 0) >= 0.01 || r.launchpad || r.token === "near");
  const hidden = p.rows.length - shown.length;
  return {
    id: uid(),
    kind: "portfolio",
    title: `Portfolio · ${fmtUsd(p.totalUsd)}`,
    lines: [
      { label: "Wallet", value: accountId },
      { label: "Tokens", value: `${p.rows.length} held · ${memes.length} meme${memes.length === 1 ? "" : "s"}` },
    ],
    rows: shown.map((r) => ({
      token: r.token,
      symbol: r.symbol,
      amount: r.amount,
      price: fmtPrice(r.priceUsd),
      value: fmtUsd(r.valueUsd),
      badge: r.launchpad ?? (r.verified ? "verified" : undefined),
      note: r.priceSource === "pool" ? "priced live from its pool" : undefined,
    })),
    warnings: [
      ...(p.unpriced ? [`${p.unpriced} token(s) have no market right now (no pool or no liquidity), so they count as $0.`] : []),
      ...(hidden ? [`${hidden} dust/spam token(s) under $0.01 hidden.`] : []),
    ],
    transactions: [],
    nearSpend: "0",
    links: [{ label: "Wallet on NearBlocks", href: `https://nearblocks.io/address/${accountId}` }],
  };
}
