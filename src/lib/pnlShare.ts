// Shareable PnL summary — computed server-side from the wallet's on-chain trades (so a share link
// can't be edited to show fake numbers), cached briefly so the image and the page agree.

import type { ActionCard } from "./cards";
import { isNearAccountId } from "./near";
import { pnl } from "./pnl";

export type PnlSummary = {
  account: string;
  totalNear: number;
  totalUsd: number;
  roiPct?: number;
  realizedNear: number;
  unrealizedNear: number;
  investedNear: number;
  tokens: number;
  trades: number;
  best?: { symbol: string; totalNear: number; roiPct?: number };
  worst?: { symbol: string; totalNear: number; roiPct?: number };
  sinceMs: number;
};

const cache = new Map<string, { at: number; s: PnlSummary }>();

export async function pnlSummary(account: string): Promise<PnlSummary> {
  if (!isNearAccountId(account)) throw new Error("Not a NEAR account.");
  const hit = cache.get(account);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.s;
  const r = await pnl(account);
  const counted = r.tokens.filter((t) => t.buys > 0);
  const realized = counted.reduce((s, t) => s + t.realizedNear, 0);
  const unrealized = counted.reduce((s, t) => s + (t.unrealizedNear ?? 0), 0);
  const invested = counted.reduce((s, t) => s + t.costNear, 0);
  const total = realized + unrealized;
  const ranked = counted.filter((t) => t.totalNear !== undefined).sort((a, b) => b.totalNear! - a.totalNear!);
  const s: PnlSummary = {
    account,
    totalNear: total,
    totalUsd: total * r.nearUsd,
    roiPct: invested > 0 ? (total / invested) * 100 : undefined,
    realizedNear: realized,
    unrealizedNear: unrealized,
    investedNear: invested,
    tokens: counted.length,
    trades: counted.reduce((s2, t) => s2 + t.buys + t.sells, 0),
    best: ranked[0] && ranked[0].totalNear! > 0 ? { symbol: ranked[0].symbol, totalNear: ranked[0].totalNear!, roiPct: ranked[0].roiPct } : undefined,
    worst: ranked.at(-1) && ranked.at(-1)!.totalNear! < 0 ? { symbol: ranked.at(-1)!.symbol, totalNear: ranked.at(-1)!.totalNear!, roiPct: ranked.at(-1)!.roiPct } : undefined,
    sinceMs: r.firstTradeMs,
  };
  cache.set(account, { at: Date.now(), s });
  return s;
}

export const fmtSigned = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : d })}`;

export async function sharePnlCard(account: string, baseUrl: string): Promise<ActionCard> {
  const s = await pnlSummary(account);
  const page = `${baseUrl}/share/pnl/${account}`;
  const image = `${baseUrl}/api/pnl-card/${account}`;
  const roi = s.roiPct !== undefined ? ` (${fmtSigned(s.roiPct, 1)}%)` : "";
  const best = s.best ? ` Best trade: $${s.best.symbol} ${fmtSigned(s.best.totalNear)} NEAR.` : "";
  const text = `My NEAR meme PnL: ${fmtSigned(s.totalNear)} NEAR${roi} 🤖✈️${best}\n\nTracked by Pip on Allpilot — built at #NEARHackathon @NEARProtocol`;
  return {
    id: Math.random().toString(36).slice(2, 10),
    kind: "share",
    title: "Your PnL card 📸",
    lines: [
      { label: "Total", value: `${fmtSigned(s.totalNear)} NEAR (${s.totalUsd >= 0 ? "+" : "−"}$${Math.abs(s.totalUsd).toFixed(2)})${roi}` },
      ...(s.best ? [{ label: "Best trade", value: `$${s.best.symbol} ${fmtSigned(s.best.totalNear)} NEAR` }] : []),
    ],
    share: { image, page, xUrl: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(page)}` },
    warnings: s.trades === 0 ? ["No trades found yet, so the card shows zeros. Trade a meme and come back!"] : [],
    transactions: [],
    nearSpend: "0",
  };
}
