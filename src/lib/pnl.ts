// Profit & loss on the user's own buys and sells, rebuilt from on-chain swap logs (any front-end:
// Allpilot, JustHoot, nearly.trade, neartrade, Rhea…).
//
//  • Rhea DCL emits EVENT_JSON swap events per hop: {swapper, token_in, amount_in, token_out, amount_out}
//  • Rhea classic (v2.ref-finance.near) logs "Swapped <in> <token_in> for <out> <token_out>"
// Hops in one transaction are netted, so NEAR → USDC → PRL → OYSTER becomes a single "buy OYSTER with NEAR".
// Accounting is average-cost in NEAR: realized = proceeds − avg cost × sold; unrealized = (price now − avg cost) × still held.
// Stablecoin legs are converted to NEAR at today's NEAR price (approximate, flagged).

import type { ActionCard } from "./cards";
import { signedTxHashes, txLogs } from "./history";
import { WRAP_NEAR, fromBase, ftBalance, ftMetadata } from "./near";
import { priceUsd } from "./portfolio";
import { rheaPrices } from "./tokens";
import { launchpadName } from "./launchpads";

const uid = () => Math.random().toString(36).slice(2, 10);
const STABLES = new Set([
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "usdt.tether-token.near",
  "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
  "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near",
  "6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near",
]);

export type Trade = { hash: string; timestampMs: number; side: "buy" | "sell"; token: string; amount: bigint; near: number; approx: boolean };

type Hop = { tokenIn: string; amountIn: bigint; tokenOut: string; amountOut: bigint };

function hopsFrom(logs: { receiver: string; log: string }[], user: string): Hop[] {
  const hops: Hop[] = [];
  for (const { receiver, log } of logs) {
    if (receiver === "dclv2.ref-labs.near" && log.startsWith("EVENT_JSON:")) {
      try {
        const ev = JSON.parse(log.slice(11)) as { event?: string; data?: { swapper?: string; token_in?: string; token_out?: string; amount_in?: string; amount_out?: string }[] };
        for (const d of ev.data ?? [])
          if (d.swapper === user && d.token_in && d.token_out && d.amount_in && d.amount_out)
            hops.push({ tokenIn: d.token_in, amountIn: BigInt(d.amount_in), tokenOut: d.token_out, amountOut: BigInt(d.amount_out) });
      } catch {
        /* not a swap event */
      }
    } else if (receiver === "v2.ref-finance.near") {
      const m = log.match(/^Swapped (\d+) (\S+) for (\d+) (\S+)/);
      if (m) hops.push({ tokenIn: m[2], amountIn: BigInt(m[1]), tokenOut: m[4], amountOut: BigInt(m[3]) });
    }
  }
  return hops;
}

/** Net a transaction's hops into what the user spent and what they received. */
function netOf(hops: Hop[]): { spent: [string, bigint] | null; got: [string, bigint] | null } {
  const net = new Map<string, bigint>();
  for (const h of hops) {
    net.set(h.tokenIn, (net.get(h.tokenIn) ?? 0n) - h.amountIn);
    net.set(h.tokenOut, (net.get(h.tokenOut) ?? 0n) + h.amountOut);
  }
  // intermediate tokens net to ~0 (tiny rounding); keep the biggest spent and received legs
  let spent: [string, bigint] | null = null;
  let got: [string, bigint] | null = null;
  for (const [t, v] of net) {
    if (v < 0n && (!spent || -v > spent[1])) spent = [t, -v];
    if (v > 0n && (!got || v > got[1])) got = [t, v];
  }
  // ignore dust leftovers from rounding: a real leg is the first hop's input / last hop's output
  if (hops.length) {
    const first = hops[0];
    const last = hops[hops.length - 1];
    if (spent && spent[0] !== first.tokenIn) spent = [first.tokenIn, first.amountIn];
    if (got && got[0] !== last.tokenOut) got = [last.tokenOut, last.amountOut];
  }
  return { spent, got };
}

export async function tradeHistory(accountId: string, maxTxs = 400): Promise<{ trades: Trade[]; scanned: number; skipped: number }> {
  const hashes = await signedTxHashes(accountId, maxTxs);
  const txs = await txLogs(hashes.map((h) => h.hash));
  const prices = await rheaPrices();
  const nearUsd = Number(prices[WRAP_NEAR]?.price ?? 0);
  const trades: Trade[] = [];
  let skipped = 0;
  for (const tx of txs) {
    const hops = hopsFrom(tx.logs, accountId);
    if (!hops.length) continue;
    const { spent, got } = netOf(hops);
    if (!spent || !got || spent[0] === got[0]) continue;
    const ts = tx.timestampMs || hashes.find((h) => h.hash === tx.hash)?.timestampMs || 0;
    const nearOf = async (token: string, amt: bigint): Promise<{ near: number; approx: boolean } | null> => {
      if (token === WRAP_NEAR) return { near: Number(amt) / 1e24, approx: false };
      if (STABLES.has(token) && nearUsd) {
        const dec = (await ftMetadata(token).catch(() => null))?.decimals ?? 6;
        return { near: Number(amt) / 10 ** dec / nearUsd, approx: true };
      }
      return null;
    };
    let paid = await nearOf(spent[0], spent[1]);
    let recv = await nearOf(got[0], got[1]);
    if (!paid && !recv && nearUsd) {
      // token ↔ token: if exactly one side is a launchpad meme, value the other side at today's price (≈)
      const memeGot = !!launchpadName(got[0]);
      const memeSpent = !!launchpadName(spent[0]);
      const leg = memeGot && !memeSpent ? spent : memeSpent && !memeGot ? got : null;
      if (leg) {
        const dec = (await ftMetadata(leg[0]).catch(() => null))?.decimals;
        const px = dec !== undefined ? (await priceUsd(leg[0], dec).catch(() => ({ price: undefined as number | undefined }))).price : undefined;
        if (px !== undefined && dec !== undefined) {
          const v = { near: ((Number(leg[1]) / 10 ** dec) * px) / nearUsd, approx: true };
          if (leg === spent) paid = v;
          else recv = v;
        }
      }
    }
    if (paid && !recv) trades.push({ hash: tx.hash, timestampMs: ts, side: "buy", token: got[0], amount: got[1], near: paid.near, approx: paid.approx });
    else if (recv && !paid) trades.push({ hash: tx.hash, timestampMs: ts, side: "sell", token: spent[0], amount: spent[1], near: recv.near, approx: recv.approx });
    else skipped++; // token ↔ token, or NEAR ↔ stable (not a position)
  }
  trades.sort((a, b) => a.timestampMs - b.timestampMs);
  return { trades, scanned: txs.length, skipped };
}

export type TokenPnl = {
  token: string;
  symbol: string;
  launchpad?: string;
  buys: number;
  sells: number;
  costNear: number; // total NEAR spent buying
  proceedsNear: number; // total NEAR received selling
  realizedNear: number;
  unknownCostProceedsNear: number;
  heldTokens: number; // tracked position still held (capped at current wallet balance)
  unrealizedNear?: number; // undefined when the token has no market now
  totalNear?: number;
  roiPct?: number;
  approx: boolean;
};

export async function pnl(accountId: string, only?: string): Promise<{ tokens: TokenPnl[]; nearUsd: number; scanned: number; skipped: number; firstTradeMs: number }> {
  const { trades, scanned, skipped } = await tradeHistory(accountId);
  const prices = await rheaPrices();
  const nearUsd = Number(prices[WRAP_NEAR]?.price ?? 0);
  const byToken = new Map<string, Trade[]>();
  for (const t of trades) if (!only || t.token === only) byToken.set(t.token, [...(byToken.get(t.token) ?? []), t]);

  const out: TokenPnl[] = [];
  for (const [token, list] of byToken) {
    const meta = await ftMetadata(token).catch(() => null);
    if (!meta) continue;
    const scale = 10 ** meta.decimals;
    let qty = 0; // tokens held per our records
    let cost = 0; // NEAR cost basis of `qty`
    let costTotal = 0;
    let proceeds = 0;
    let realized = 0;
    let unknownCostProceeds = 0; // sales of tokens we never saw bought (transfers in, older buys)
    let approx = false;
    for (const t of list) {
      const amt = Number(t.amount) / scale;
      approx ||= t.approx;
      if (t.side === "buy") {
        qty += amt;
        cost += t.near;
        costTotal += t.near;
      } else {
        const avg = qty > 0 ? cost / qty : 0;
        const sold = Math.min(amt, qty); // part of the sale that came from tracked buys
        const trackedShare = amt > 0 ? sold / amt : 0;
        // tracked part: proceeds minus its average cost; untracked part: cost unknown, reported separately
        realized += t.near * trackedShare - avg * sold;
        unknownCostProceeds += t.near * (1 - trackedShare);
        cost -= avg * sold;
        qty -= sold;
        proceeds += t.near;
      }
    }
    const walletNow = Number(await ftBalance(token, accountId)) / scale;
    const held = Math.min(qty, walletNow);
    const heldCost = qty > 0 ? cost * (held / qty) : 0;
    if (held < qty) realized -= cost - heldCost; // tracked tokens that left the wallet without a sale (sent away) are written off
    const { price } = await priceUsd(token, meta.decimals).catch(() => ({ price: undefined as number | undefined }));
    const priceNear = price !== undefined && nearUsd ? price / nearUsd : undefined;
    const unrealized = priceNear !== undefined ? held * priceNear - heldCost : held > 0 ? undefined : 0;
    const total = unrealized !== undefined ? realized + unrealized : undefined;
    out.push({
      token,
      symbol: meta.symbol,
      launchpad: launchpadName(token) ?? undefined,
      buys: list.filter((t) => t.side === "buy").length,
      sells: list.filter((t) => t.side === "sell").length,
      costNear: costTotal,
      proceedsNear: proceeds,
      realizedNear: realized,
      unknownCostProceedsNear: unknownCostProceeds,
      heldTokens: held,
      unrealizedNear: unrealized,
      totalNear: total,
      roiPct: total !== undefined && costTotal > 0 ? (total / costTotal) * 100 : undefined,
      approx,
    });
  }
  out.sort((a, b) => Math.abs(b.totalNear ?? b.realizedNear) - Math.abs(a.totalNear ?? a.realizedNear));
  return { tokens: out, nearUsd, scanned, skipped, firstTradeMs: trades[0]?.timestampMs ?? 0 };
}

const n = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${n(Math.abs(v))}`;
const usdS = (near: number, nearUsd: number) => (nearUsd ? `${near >= 0 ? "+" : "−"}$${Math.abs(near * nearUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "");

export async function pnlCard(accountId: string, tokenQuery?: string, tokenId?: string): Promise<ActionCard> {
  const r = await pnl(accountId, tokenId);
  const realized = r.tokens.reduce((s, t) => s + t.realizedNear, 0);
  const unrealized = r.tokens.reduce((s, t) => s + (t.unrealizedNear ?? 0), 0);
  const total = realized + unrealized;
  const invested = r.tokens.reduce((s, t) => s + t.costNear, 0);
  const unknownCost = r.tokens.reduce((s, t) => s + t.unknownCostProceedsNear, 0);
  const warnings: string[] = [];
  if (unknownCost > 0.001)
    warnings.push(`You also sold ${n(unknownCost)} NEAR worth of tokens with no recorded buy (received by transfer or bought before this history), so their cost is unknown and they're left out of PnL.`);
  if (!r.tokens.length) warnings.push(tokenQuery ? `No buys or sells of ${tokenQuery} found in your last ${r.scanned} transactions.` : `No NEAR-priced buys or sells found in your last ${r.scanned} transactions.`);
  if (r.tokens.some((t) => t.approx)) warnings.push("Trades paid in stablecoins or other tokens are valued in NEAR at today's prices (≈).");
  if (r.skipped) warnings.push(`${r.skipped} token↔token swap(s) aren't counted as positions.`);
  if (r.tokens.some((t) => t.unrealizedNear === undefined)) warnings.push("Some tokens have no market right now, so their unrealized PnL can't be priced.");
  warnings.push("Counted from Rhea / Rhea DCL swaps in your recent signed transactions (any app). NEAR Intents swaps and transfers aren't trades, so they're not included.");

  return {
    id: uid(),
    kind: "pnl",
    title: `PnL · ${signed(total)} NEAR ${usdS(total, r.nearUsd) ? `(${usdS(total, r.nearUsd)})` : ""}`.trim(),
    lines: [
      { label: "Realized", value: `${signed(realized)} NEAR ${usdS(realized, r.nearUsd)}` },
      { label: "Unrealized", value: `${signed(unrealized)} NEAR ${usdS(unrealized, r.nearUsd)}` },
      { label: "Invested", value: `${n(invested)} NEAR across ${r.tokens.length} token${r.tokens.length === 1 ? "" : "s"}` },
      ...(invested > 0 ? [{ label: "Return", value: `${total >= 0 ? "+" : "−"}${Math.abs((total / invested) * 100).toFixed(1)}%` }] : []),
      { label: "History", value: `last ${r.scanned} transactions${r.firstTradeMs ? ` (since ${new Date(r.firstTradeMs).toISOString().slice(0, 10)})` : ""}` },
    ],
    pnlRows: r.tokens.slice(0, 25).map((t) => ({
      token: t.token,
      symbol: t.symbol,
      badge: t.launchpad,
      trades: `${t.buys} buy${t.buys === 1 ? "" : "s"} · ${t.sells} sell${t.sells === 1 ? "" : "s"}`,
      invested: `${n(t.costNear)} NEAR`,
      realized: t.buys === 0 && t.unknownCostProceedsNear > 0 ? `sold ${n(t.unknownCostProceedsNear)}, cost unknown` : signed(t.realizedNear),
      unrealized: t.unrealizedNear === undefined ? "no market" : signed(t.unrealizedNear),
      total: t.buys === 0 ? "—" : t.totalNear === undefined ? "—" : signed(t.totalNear),
      roi: t.roiPct === undefined ? "" : `${t.roiPct >= 0 ? "+" : "−"}${Math.abs(t.roiPct).toFixed(0)}%`,
      up: (t.totalNear ?? t.realizedNear) >= 0,
      unknown: t.buys === 0,
      held: t.heldTokens > 0 ? `${fromBase(BigInt(Math.floor(t.heldTokens)), 0, 0)} held` : "closed",
    })),
    warnings,
    transactions: [],
    nearSpend: "0",
    links: [{ label: "Wallet on NearBlocks", href: `https://nearblocks.io/address/${accountId}` }],
  };
}
