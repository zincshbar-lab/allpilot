// Launch a memecoin on JustHoot or nearly.trade, straight from chat.
//
// Both launchpads mint a fixed 1B-supply NEP-141 token and open a Rhea DCL pool in ONE transaction:
//  • JustHoot   — v2-launchpad.justhoot.near · launch_meme({args}) · deposit = get_launch_deposit + first buy
//                 Opens at a $5,000 FDV (oracle-priced). Symbol 2–10 letters/digits. Icon data URI ≤ 7,000 bytes.
//  • nearly.trade — nearlytrade.near · launch({args}) · deposit = quote_launch(...).total (includes first buy)
//                 Symbol 1–12 letters/digits. Icon ≤ max_icon_bytes (16 KB). Description + links on-chain.
// Unused deposit is refunded by both factories. Formats read from nearly.trade's verified contract source
// and cross-checked with fastnear's open-source near.fm launch adapters.

import type { ActionCard } from "./cards";
import { fromBase, toBase, view } from "./near";
import { fc, totalAttachedNear, type PlannedTx } from "./tx";

export const JUSTHOOT_FACTORY = "v2-launchpad.justhoot.near";
export const NEARLY_FACTORY = "nearlytrade.near";
export const LAUNCH_FACTORIES = new Set([JUSTHOOT_FACTORY, NEARLY_FACTORY]);

const JUSTHOOT_ICON_MAX = 7000;
const STORAGE_MARGIN = 4_000_000_000_000_000_000_000n; // 0.004 NEAR, refunded if unused
const uid = () => Math.random().toString(36).slice(2, 10);

export type Launchpad = "justhoot" | "nearly";

export type LaunchInput = {
  launchpad: Launchpad;
  name: string;
  symbol: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  firstBuyNear?: string; // optional "dev buy" in NEAR, executed by the factory at launch
  icon?: string; // data:image/... uploaded by the user
  accountId?: string;
};

export function normalizeLaunchpad(s?: string): Launchpad | undefined {
  const v = (s ?? "").toLowerCase();
  if (/hoot/.test(v)) return "justhoot";
  if (/nearly/.test(v)) return "nearly";
  return undefined;
}

const utf8 = (s: string) => Buffer.byteLength(s, "utf8");

function validate(p: LaunchInput) {
  const name = p.name.trim();
  const symbol = p.symbol.trim().replace(/^\$/, "").toUpperCase();
  if (name.length < 1 || name.length > 32) throw new Error("Token name must be 1–32 characters.");
  const symRule = p.launchpad === "justhoot" ? /^[A-Z0-9]{2,10}$/ : /^[A-Z0-9]{1,12}$/;
  if (!symRule.test(symbol))
    throw new Error(p.launchpad === "justhoot" ? "On JustHoot the ticker must be 2–10 letters or digits." : "On nearly.trade the ticker must be 1–12 letters or digits.");
  if ((p.description ?? "").length > 500) throw new Error("Description can be at most 500 characters.");
  for (const l of [p.website, p.twitter, p.telegram]) if (l && l.length > 200) throw new Error("Links can be at most 200 characters.");
  if (p.icon && !p.icon.startsWith("data:image/")) throw new Error("The token picture must be an uploaded image.");
  return { name, symbol };
}

export async function launchToken(p: LaunchInput): Promise<ActionCard> {
  const { name, symbol } = validate(p);
  const firstBuy = p.firstBuyNear && Number(p.firstBuyNear) > 0 ? toBase(p.firstBuyNear, 24) : undefined;
  const warnings: string[] = [];
  let icon = p.icon;

  let receiverId: string;
  let method: string;
  let args: Record<string, unknown>;
  let deposit: bigint;
  let tgas: number;
  const lines: ActionCard["lines"] = [
    { label: "Name", value: name },
    { label: "Ticker", value: `$${symbol}` },
  ];

  if (p.launchpad === "justhoot") {
    if (icon && icon.length > JUSTHOOT_ICON_MAX) {
      warnings.push("Your picture is too big for JustHoot (max ~7 KB), so it was left out. Try a smaller/simpler image.");
      icon = undefined;
    }
    if (p.description || p.website || p.twitter || p.telegram)
      warnings.push("JustHoot keeps description and links off-chain; add them on justhoot.fun after launch.");
    const inner = {
      name,
      symbol,
      icon: icon ?? null,
      reference: null,
      reference_hash: null,
      quote_token_id: "wrap.near",
      dev_buy_quote_max: firstBuy ?? null,
      transfer_fee_pips: 0,
      shares: { token_owner_bps: 10000, burn_bps: 0, holders_bps: 0 },
    };
    const storage = BigInt(await view<string>(JUSTHOOT_FACTORY, "get_launch_deposit", { args: inner, account_id: null }));
    deposit = storage + BigInt(firstBuy ?? "0") + STORAGE_MARGIN;
    receiverId = JUSTHOOT_FACTORY;
    method = "launch_meme";
    args = { args: inner };
    tgas = 1000; // as JustHoot's own UI sends (protocol allows 1 PGas per tx)
    lines.push(
      { label: "Launchpad", value: "🦉 JustHoot (v2)" },
      { label: "Opens at", value: "$5,000 fully diluted value, NEAR pair" },
      { label: "Pool fees", value: "1% per trade, your creator share goes to you" },
    );
  } else {
    const links = { website: p.website ?? null, twitter: p.twitter ?? null, telegram: p.telegram ?? null };
    const inner: Record<string, unknown> = {
      name,
      symbol,
      description: p.description?.trim() || null,
      icon: icon ?? null,
      links,
      dev_buy: firstBuy ?? null,
      quote: null,
      fee_mode: null,
    };
    const config = await view<{ max_icon_bytes: number }>(NEARLY_FACTORY, "get_config");
    if (icon && JSON.stringify(icon).length > config.max_icon_bytes) {
      warnings.push(`Your picture is too big for nearly.trade (max ${Math.round(config.max_icon_bytes / 1024)} KB), so it was left out.`);
      inner.icon = null;
      icon = undefined;
    }
    const textBytes = utf8(name) + utf8(symbol) + utf8(p.description ?? "") + [p.website, p.twitter, p.telegram].reduce((s, l) => s + utf8(l ?? ""), 0);
    const cost = await view<{ total: string }>(NEARLY_FACTORY, "quote_launch", {
      icon_bytes: icon ? JSON.stringify(icon).length : 0,
      dev_buy: firstBuy ?? null,
      tax: false,
      text_bytes: textBytes,
    });
    deposit = BigInt(cost.total) + STORAGE_MARGIN;
    receiverId = NEARLY_FACTORY;
    method = "launch";
    args = { args: inner };
    tgas = 300;
    lines.push(
      { label: "Launchpad", value: "✨ nearly.trade" },
      { label: "Pool", value: "Rhea DCL, NEAR pair, 1% fee (creator gets 70%)" },
    );
    if (p.description) lines.push({ label: "Description", value: p.description.slice(0, 120) + (p.description.length > 120 ? "…" : "") });
  }

  lines.push(
    { label: "Supply", value: "1,000,000,000 (fixed)" },
    { label: "First buy", value: firstBuy ? `${p.firstBuyNear} NEAR` : "none" },
    { label: "Picture", value: icon ? "✓ uploaded" : "none — upload one with 📎" },
    { label: "You attach", value: `${fromBase(deposit.toString(), 24, 4)} NEAR (unused part refunded)` },
  );
  warnings.push("Launching is permanent: the name, ticker and picture can't be changed later.");

  const transactions: PlannedTx[] = p.accountId ? [{ receiverId, actions: [fc(method, args, tgas, deposit.toString())] }] : [];
  return {
    id: uid(),
    kind: "launch",
    title: `Launch $${symbol} on ${p.launchpad === "justhoot" ? "JustHoot" : "nearly.trade"}`,
    launchpad: p.launchpad,
    icon,
    lines,
    warnings,
    transactions,
    nearSpend: totalAttachedNear(transactions).toString(),
    needsWallet: !p.accountId,
    expiresAt: Date.now() + 10 * 60_000,
    links: [p.launchpad === "justhoot" ? { label: "JustHoot", href: "https://justhoot.fun" } : { label: "nearly.trade", href: "https://nearly.trade" }],
  };
}
