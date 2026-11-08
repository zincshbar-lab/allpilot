// Launch a memecoin on JustHoot or nearly.trade, straight from chat — with every setting each launchpad offers.
//
// Both launchpads mint a fixed 1B-supply NEP-141 token and open a Rhea DCL pool in ONE transaction.
//
//  JustHoot (v2-launchpad.justhoot.near · launch_meme({args}))
//    • pair            quote_token_id ∈ get_allowed_quote_tokens (NEAR, USDC, ZEC, RHEA, HOOT, PRL, QTC…)
//    • first buy       dev_buy_quote_max (NEAR pair only), attached on top of get_launch_deposit
//    • transfer tax    transfer_fee_pips, up to 5% (taken in the token on every transfer)
//    • fee/tax split   shares { token_owner_bps, burn_bps, holders_bps } = 100%
//    • description     off-chain `reference` JSON (+ sha256 `reference_hash`), served by /api/token-meta
//    Opens at a $5,000 FDV (oracle-priced). Ticker 2–10 letters/digits. Icon data URI ≤ ~7,000 bytes.
//
//  nearly.trade (nearlytrade.near · launch({args}))
//    • pair            quote ∈ get_quotes() (NEAR, USDC, USDT, RHEA, ZEC, NEARLY…)
//    • first buy       dev_buy (NEAR pair only)
//    • fee mode        creator | burn | holders (who gets the creator share of the 1% pool fee)
//    • fee recipient   fee_to (send your creator fees to another account)
//    • buy/sell tax    tax { buy_bps, sell_bps ≤ 4% each, creator_bps + burn_bps + holders_bps = 100% }
//    • payouts in      creator_paid_in / holders_paid_in: "near" or "pair"
//    • description + website / twitter / telegram stored on-chain
//    Ticker 1–12 letters/digits. Icon ≤ max_icon_bytes (16 KB).
//
// Unused deposit is refunded by both factories. Formats read from nearly.trade's verified contract source and
// JustHoot's on-chain views, cross-checked with fastnear's open-source near.fm launch adapters.

import { createHash } from "node:crypto";
import type { ActionCard } from "./cards";
import { ftMetadata, fromBase, isNearAccountId, toBase, view } from "./near";
import { resolveToken } from "./tokens";
import { fc, totalAttachedNear, type PlannedTx } from "./tx";

export const JUSTHOOT_FACTORY = "v2-launchpad.justhoot.near";
export const NEARLY_FACTORY = "nearlytrade.near";
export const LAUNCH_FACTORIES = new Set([JUSTHOOT_FACTORY, NEARLY_FACTORY]);

const JUSTHOOT_ICON_MAX = 7000;
const JUSTHOOT_MAX_TAX_PCT = 5;
const NEARLY_MAX_TAX_PCT = 4;
const STORAGE_MARGIN = 4_000_000_000_000_000_000_000n; // 0.004 NEAR, refunded if unused
const WRAP = "wrap.near";
const uid = () => Math.random().toString(36).slice(2, 10);

export type Launchpad = "justhoot" | "nearly";
export type Split = { creator: number; burn: number; holders: number }; // percentages, must total 100

export type LaunchInput = {
  launchpad: Launchpad;
  name: string;
  symbol: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  icon?: string; // data:image/... uploaded by the user
  pair?: string; // quote asset symbol or contract (default NEAR)
  firstBuyNear?: string; // optional "dev buy" in NEAR (NEAR pair only)
  // JustHoot
  taxPct?: number; // transfer tax 0–5%
  // nearly.trade
  buyTaxPct?: number; // 0–4%
  sellTaxPct?: number; // 0–4%
  feeMode?: "creator" | "burn" | "holders";
  feeTo?: string; // account that receives the creator fees
  creatorPaidIn?: "near" | "pair";
  holdersPaidIn?: "near" | "pair";
  // both: how fees (JustHoot) / taxes (nearly) are split
  split?: Partial<Split>;
  accountId?: string;
  baseUrl?: string; // for JustHoot's metadata reference URL
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

/** Percent split → basis points totalling exactly 10,000. */
function splitBps(s: Partial<Split> | undefined, fallback: Split): { creator: number; burn: number; holders: number } {
  const v = { creator: s?.creator ?? (s ? 0 : fallback.creator), burn: s?.burn ?? 0, holders: s?.holders ?? (s ? 0 : fallback.holders) };
  const sum = v.creator + v.burn + v.holders;
  if ([v.creator, v.burn, v.holders].some((x) => x < 0)) throw new Error("Split percentages can't be negative.");
  if (Math.abs(sum - 100) > 0.01) throw new Error(`The creator / burn / holders split must add up to 100% (yours adds up to ${sum}%).`);
  const creator = Math.round(v.creator * 100);
  const burn = Math.round(v.burn * 100);
  return { creator, burn, holders: 10_000 - creator - burn };
}

const pctTxt = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const splitTxt = (b: { creator: number; burn: number; holders: number }) =>
  [b.creator && `${pctTxt(b.creator)} to you`, b.burn && `${pctTxt(b.burn)} burned`, b.holders && `${pctTxt(b.holders)} to holders`].filter(Boolean).join(" · ");

async function resolvePair(pair: string | undefined, allowed: string[]): Promise<{ id: string; symbol: string }> {
  if (!pair || /^w?near$/i.test(pair.trim())) return { id: WRAP, symbol: "NEAR" };
  const q = pair.trim();
  let id = allowed.find((a) => a === q.toLowerCase());
  if (!id) {
    // match by symbol among the launchpad's allowed pairs
    const syms = await Promise.all(allowed.map(async (a) => [a, a === WRAP ? "NEAR" : ((await ftMetadata(a).catch(() => null))?.symbol ?? "")] as const));
    id = syms.find(([, s]) => s.toUpperCase() === q.toUpperCase().replace(/^\$/, ""))?.[0];
    if (!id) {
      const r = await resolveToken(q).catch(() => null);
      if (r?.best && allowed.includes(r.best.id)) id = r.best.id;
    }
  }
  if (!id) {
    const names = await Promise.all(allowed.map(async (a) => (a === WRAP ? "NEAR" : ((await ftMetadata(a).catch(() => null))?.symbol ?? a))));
    throw new Error(`That launchpad doesn't accept ${q} as a pair. Allowed pairs: ${names.join(", ")}.`);
  }
  return { id, symbol: id === WRAP ? "NEAR" : ((await ftMetadata(id).catch(() => null))?.symbol ?? id) };
}

// ---------------------------------------------------------------- options (for "what can I set?")

export async function launchOptions() {
  const [jhPairs, nlQuotes, nlConfig] = await Promise.all([
    view<string[]>(JUSTHOOT_FACTORY, "get_allowed_quote_tokens").catch(() => [WRAP]),
    view<[string, { enabled: boolean }][]>(NEARLY_FACTORY, "get_quotes").catch(() => [[WRAP, { enabled: true }]] as [string, { enabled: boolean }][]),
    view<{ creator_fee_share_bps: number }>(NEARLY_FACTORY, "get_config").catch(() => null),
  ]);
  const sym = async (a: string) => (a === WRAP ? "NEAR" : ((await ftMetadata(a).catch(() => null))?.symbol ?? a));
  return {
    justhoot: {
      pairs: await Promise.all(jhPairs.map(sym)),
      settings: ["first buy (NEAR pair only)", `transfer tax 0–${JUSTHOOT_MAX_TAX_PCT}%`, "fee & tax split: you / burn / holders", "description + website/twitter/telegram (hosted metadata)", "picture"],
      opensAt: "$5,000 FDV",
    },
    nearly: {
      pairs: await Promise.all(nlQuotes.filter(([, q]) => q.enabled).map(([a]) => sym(a))),
      settings: [
        "first buy (NEAR pair only)",
        "fee mode: creator / burn / holders",
        "fee recipient (another account)",
        `buy tax & sell tax 0–${NEARLY_MAX_TAX_PCT}% each, split you / burn / holders`,
        "payouts in NEAR or the pair token",
        "description + website/twitter/telegram (on-chain)",
        "picture",
      ],
      creatorFeeShare: `${((nlConfig?.creator_fee_share_bps ?? 6000) / 100).toFixed(0)}% of the 1% pool fee`,
    },
  };
}

// ---------------------------------------------------------------- launch

export async function launchToken(p: LaunchInput): Promise<ActionCard> {
  const { name, symbol } = validate(p);
  const firstBuy = p.firstBuyNear && Number(p.firstBuyNear) > 0 ? toBase(p.firstBuyNear, 24) : undefined;
  const warnings: string[] = [];
  let icon = p.icon;
  const lines: ActionCard["lines"] = [
    { label: "Name", value: name },
    { label: "Ticker", value: `$${symbol}` },
  ];
  let receiverId: string;
  let method: string;
  let args: Record<string, unknown>;
  let deposit: bigint;
  let tgas: number;

  if (p.launchpad === "justhoot") {
    if (icon && icon.length > JUSTHOOT_ICON_MAX) {
      warnings.push("Your picture is too big for JustHoot (max ~7 KB), so it was left out. Try a smaller/simpler image.");
      icon = undefined;
    }
    const allowed = await view<string[]>(JUSTHOOT_FACTORY, "get_allowed_quote_tokens").catch(() => [WRAP]);
    const pair = await resolvePair(p.pair, allowed);
    if (firstBuy && pair.id !== WRAP) throw new Error("JustHoot only allows a first buy on the NEAR pair. Remove the first buy or pair with NEAR.");
    const tax = p.taxPct ?? 0;
    if (tax < 0 || tax > JUSTHOOT_MAX_TAX_PCT) throw new Error(`JustHoot's transfer tax can be 0–${JUSTHOOT_MAX_TAX_PCT}%.`);
    if (p.buyTaxPct || p.sellTaxPct || p.feeMode || p.feeTo || p.creatorPaidIn || p.holdersPaidIn)
      warnings.push("JustHoot uses one transfer tax (not separate buy/sell taxes) and pays fees per the split below; nearly.trade-only settings were ignored.");
    const split = splitBps(p.split, { creator: 100, burn: 0, holders: 0 });

    // description + links → hosted reference JSON with a sha256 the token commits to
    let reference: string | null = null;
    let referenceHash: string | null = null;
    const meta = { description: p.description?.trim() || undefined, website: p.website || undefined, twitter: p.twitter || undefined, telegram: p.telegram || undefined };
    if (Object.values(meta).some(Boolean)) {
      const bytes = Buffer.from(JSON.stringify(meta), "utf8");
      reference = `${p.baseUrl ?? "https://allpilot.vercel.app"}/api/token-meta?d=${bytes.toString("base64url")}`;
      referenceHash = createHash("sha256").update(bytes).digest("base64");
      if (reference.length > 1000) throw new Error("Description and links are too long for the metadata link — shorten them a bit.");
    }

    const inner = {
      name,
      symbol,
      icon: icon ?? null,
      reference,
      reference_hash: referenceHash,
      quote_token_id: pair.id,
      dev_buy_quote_max: firstBuy ?? null,
      transfer_fee_pips: Math.round(tax * 10_000),
      shares: { token_owner_bps: split.creator, burn_bps: split.burn, holders_bps: split.holders },
    };
    // With a first buy the factory needs the buyer's account, and its quote then already includes the buy amount.
    const quoteFor = firstBuy ? (p.accountId ?? "intents.near") : null;
    deposit = BigInt(await view<string>(JUSTHOOT_FACTORY, "get_launch_deposit", { args: inner, account_id: quoteFor })) + STORAGE_MARGIN;
    receiverId = JUSTHOOT_FACTORY;
    method = "launch_meme";
    args = { args: inner };
    tgas = 1000; // as JustHoot's own UI sends (protocol allows 1 PGas per tx)
    lines.push(
      { label: "Launchpad", value: "🦉 JustHoot (v2)" },
      { label: "Pair", value: `${pair.symbol} · opens at a $5,000 value` },
      { label: "Transfer tax", value: tax ? `${tax}% on every transfer` : "none" },
      { label: "Fees & tax go", value: splitTxt(split) },
    );
    if (reference) lines.push({ label: "Description & links", value: "✓ hosted metadata (hash stored on-chain)" });
  } else {
    const [config, quotes] = await Promise.all([
      view<{ max_icon_bytes: number; creator_fee_share_bps: number }>(NEARLY_FACTORY, "get_config"),
      view<[string, { enabled: boolean; native: boolean }][]>(NEARLY_FACTORY, "get_quotes").catch(() => [[WRAP, { enabled: true, native: true }]] as [string, { enabled: boolean; native: boolean }][]),
    ]);
    const pair = await resolvePair(p.pair, quotes.filter(([, q]) => q.enabled).map(([a]) => a));
    const native = pair.id === WRAP;
    if (firstBuy && !native) throw new Error("nearly.trade only allows a first buy on the NEAR pair. Remove the first buy or pair with NEAR.");
    const buy = p.buyTaxPct ?? 0;
    const sell = p.sellTaxPct ?? 0;
    for (const t of [buy, sell]) if (t < 0 || t > NEARLY_MAX_TAX_PCT) throw new Error(`nearly.trade taxes can be 0–${NEARLY_MAX_TAX_PCT}% per side.`);
    const feeMode = p.feeMode ?? "creator";
    if (p.taxPct) warnings.push("nearly.trade has separate buy and sell taxes — use buy tax / sell tax; the single transfer tax was ignored.");
    if (p.feeTo && !isNearAccountId(p.feeTo)) throw new Error(`"${p.feeTo}" isn't a valid NEAR account for the fee recipient.`);
    let tax: { buy_bps: number; sell_bps: number; creator_bps: number; burn_bps: number; holders_bps: number } | undefined;
    let taxSplit: ReturnType<typeof splitBps> | undefined;
    if (buy > 0 || sell > 0) {
      taxSplit = splitBps(p.split, { creator: 100, burn: 0, holders: 0 });
      if (!native && feeMode !== "creator" && taxSplit.creator > 0) throw new Error("On a non-NEAR pair, a creator share of the tax needs fee mode \"creator\".");
      tax = { buy_bps: Math.round(buy * 100), sell_bps: Math.round(sell * 100), creator_bps: taxSplit.creator, burn_bps: taxSplit.burn, holders_bps: taxSplit.holders };
    }
    const links = { website: p.website ?? null, twitter: p.twitter ?? null, telegram: p.telegram ?? null };
    const inner: Record<string, unknown> = {
      name,
      symbol,
      description: p.description?.trim() || null,
      icon: icon ?? null,
      links,
      dev_buy: firstBuy ?? null,
      quote: native ? null : pair.id,
      fee_mode: feeMode === "creator" ? null : feeMode,
    };
    if (tax) inner.tax = tax;
    if (p.feeTo) inner.fee_to = p.feeTo;
    if (p.creatorPaidIn) inner.creator_paid_in = p.creatorPaidIn;
    if (p.holdersPaidIn) inner.holders_paid_in = p.holdersPaidIn;
    if (icon && JSON.stringify(icon).length > config.max_icon_bytes) {
      warnings.push(`Your picture is too big for nearly.trade (max ${Math.round(config.max_icon_bytes / 1024)} KB), so it was left out.`);
      inner.icon = null;
      icon = undefined;
    }
    const textBytes = utf8(name) + utf8(symbol) + utf8(p.description ?? "") + [p.website, p.twitter, p.telegram].reduce((s, l) => s + utf8(l ?? ""), 0);
    const cost = await view<{ total: string }>(NEARLY_FACTORY, "quote_launch", { icon_bytes: icon ? JSON.stringify(icon).length : 0, dev_buy: firstBuy ?? null, tax: !!tax, text_bytes: textBytes });
    deposit = BigInt(cost.total) + STORAGE_MARGIN;
    receiverId = NEARLY_FACTORY;
    method = "launch";
    args = { args: inner };
    tgas = 300;
    const creatorShare = pctTxt(config.creator_fee_share_bps ?? 7000);
    lines.push(
      { label: "Launchpad", value: "✨ nearly.trade" },
      { label: "Pair", value: pair.symbol },
      { label: "Pool fees", value: `1% per trade · creator share ${creatorShare} → ${feeMode === "creator" ? (p.feeTo ? p.feeTo : "you") : feeMode === "burn" ? "burned" : "holders"}` },
      { label: "Buy / sell tax", value: tax ? `${buy}% / ${sell}% · ${splitTxt(taxSplit!)}` : "none" },
    );
    if (p.creatorPaidIn || p.holdersPaidIn) lines.push({ label: "Payouts in", value: `you: ${p.creatorPaidIn ?? "default"} · holders: ${p.holdersPaidIn ?? "default"}` });
    if (p.description) lines.push({ label: "Description", value: p.description.slice(0, 120) + (p.description.length > 120 ? "…" : "") });
  }

  const linkCount = [p.website, p.twitter, p.telegram].filter(Boolean).length;
  lines.push(
    { label: "Supply", value: "1,000,000,000 (fixed)" },
    { label: "First buy", value: firstBuy ? `${p.firstBuyNear} NEAR` : "none" },
    ...(linkCount ? [{ label: "Links", value: [p.website && "website", p.twitter && "X", p.telegram && "Telegram"].filter(Boolean).join(" · ") }] : []),
    { label: "Picture", value: icon ? "✓ uploaded" : "none — upload one with 📎" },
    { label: "You attach", value: `${fromBase(deposit.toString(), 24, 4)} NEAR (unused part refunded)` },
  );
  warnings.push("Launching is permanent: name, ticker, picture, pair, taxes and fee settings can't be changed later.");

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
