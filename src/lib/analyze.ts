// Contract-address analysis: paste any token (or wallet) account and get a due-diligence report —
// launchpad, creator, the creator's wallet age / funder / other launches, holder concentration,
// live price & market cap, taxes, lookalikes, and plain-language risk signals. Read-only.

import type { ActionCard, CardSection } from "./cards";
import { allNearlyLaunches, dclPoolDetail, dclPools, officialPool } from "./dcl";
import { accountTxs, ago, firstTx, topHolders, txDetails } from "./history";
import { launchpadOfToken, parentOf } from "./launchpads";
import { WRAP_NEAR, accountExists, fromBase, ftBalance, ftMetadata, getNativeBalance, isNearAccountId, view } from "./near";
import { fmtPrice, priceUsd } from "./portfolio";
import { resolveToken, VERIFIED } from "./tokens";

const uid = () => Math.random().toString(36).slice(2, 10);
const LAUNCH_METHODS = new Set(["launch", "launch_meme", "create_token", "create", "new_token", "deploy_token", "launch_token", "create_meme"]);
const RELAYERS = /relay|relayer/;
// Accounts that hold tokens on behalf of many users or pools — not "whales".
const INFRA = /^(dclv2\.ref-labs\.near|v2\.ref-finance\.near|intents\.near|contract\.main\.burrow\.near|.*\.sputnik-dao\.near|holders\..*|.*launchpad.*|nearlytrade\.near|.*\.pool(v1)?\.near)$/;

const pctStr = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2)) + "%";
const usd = (n?: number) => (n === undefined ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`);
const dateStr = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "unknown");

/** How many tokens this wallet launched, from its recent signed transactions (all launchpads). */
async function launchesBy(creator: string): Promise<{ count: number; scanned: number; factories: Record<string, number> }> {
  const { txs } = await accountTxs(creator, { limit: 100, signerOnly: true });
  const details = await txDetails(txs.map((t) => t.transaction_hash)).catch(() => []);
  const factories: Record<string, number> = {};
  let count = 0;
  for (const d of details)
    for (const a of d.actions)
      if (a.method && LAUNCH_METHODS.has(a.method)) {
        count++;
        factories[d.receiver] = (factories[d.receiver] ?? 0) + 1;
      }
  return { count, scanned: details.length, factories };
}

async function walletProfile(accountId: string) {
  const [first, bal] = await Promise.all([firstTx(accountId).catch(() => null), getNativeBalance(accountId).catch(() => "0")]);
  const f = first?.tx;
  let funder: string | undefined;
  if (f) {
    if (f.signer !== accountId) funder = f.signer;
    if (f.receiver === "near" || f.actions.some((a) => a.method === "create_account")) funder = f.signer; // created via a wallet/relayer
  }
  return {
    ageMs: first?.timestampMs ?? 0,
    created: dateStr(first?.timestampMs ?? 0),
    funder,
    funderNote: funder && RELAYERS.test(funder) ? "wallet relayer (sponsored signup)" : undefined,
    totalTxs: first?.totalTxs ?? 0,
    nearBalance: bal,
  };
}

async function wnearPoolVolume(tokenId: string): Promise<bigint> {
  const pools = await dclPools().catch(() => []);
  const off = await officialPool(tokenId).catch(() => null);
  const pool = off
    ? pools.find((p) => p.pool_id === off.poolId && (p.token_x === WRAP_NEAR || p.token_y === WRAP_NEAR))
    : pools.find((p) => (p.token_x === tokenId && p.token_y === WRAP_NEAR) || (p.token_y === tokenId && p.token_x === WRAP_NEAR));
  if (!pool) return 0n;
  const d = await dclPoolDetail(pool.pool_id);
  return d ? BigInt(pool.token_x === WRAP_NEAR ? d.volume_x_in : d.volume_y_in) : 0n;
}

// ---------------------------------------------------------------- token analysis

export async function analyzeToken(input: string): Promise<ActionCard> {
  const id = input.trim().toLowerCase().replace(/^\$/, "").replace(/^https?:\/\/[^/]+\/(?:token\/|address\/|p\/)?/, "").replace(/\/.*$/, "");
  if (!isNearAccountId(id)) throw new Error(`"${input}" doesn't look like a NEAR account / contract address.`);
  if (!(await accountExists(id))) throw new Error(`${id} doesn't exist on NEAR mainnet.`);
  const meta = await ftMetadata(id).catch(() => null);
  if (!meta) return analyzeWallet(id);

  const lp = launchpadOfToken(id);
  const [supplyRaw, first, holders, price, lookalike, volume] = await Promise.all([
    view<string>(id, "ft_total_supply").catch(() => "0"),
    firstTx(id).catch(() => null),
    topHolders(id).catch(() => []),
    priceUsd(id, meta.decimals).catch(() => ({}) as { price?: number }),
    resolveToken(meta.symbol).catch(() => null),
    wnearPoolVolume(id).catch(() => 0n),
  ]);
  const supply = Number(supplyRaw) / 10 ** meta.decimals;
  const flags: { level: "ok" | "warn" | "risk"; text: string }[] = [];
  const sections: CardSection[] = [];

  // --- launch & creator
  let creator = first?.tx?.signer;
  const launchMethod = first?.tx?.actions.find((a) => a.method)?.method;
  const factory = first?.tx?.receiver;
  let taxText: string | undefined;
  let devBuy: string | undefined;
  let nearlyCount: number | undefined;

  if (lp?.factory.includes("justhoot")) {
    const cfg = await view<{ owner_id: string; transfer_fee_pips: number; shares?: { token_owner_bps: number; burn_bps: number; holders_bps: number } }>(id, "get_config").catch(() => null);
    if (cfg) {
      creator = cfg.owner_id;
      if (cfg.transfer_fee_pips > 0) taxText = `${cfg.transfer_fee_pips / 10000}% on every transfer`;
    }
  } else if (lp?.factory === "nearlytrade.near") {
    const launches = await allNearlyLaunches().catch(() => []);
    const l = launches.find((x) => x.token === id);
    if (l) {
      creator = l.creator;
      if (l.dev_buy_near && l.dev_buy_near !== "0") devBuy = `${fromBase(l.dev_buy_near, 24, 3)} NEAR`;
      nearlyCount = launches.filter((x) => x.creator === l.creator).length;
      const tax = await view<{ buy_bps: number; sell_bps: number } | null>("nearlytrade.near", "get_tax", { launch_id: String(l.id) }).catch(() => null);
      if (tax && (tax.buy_bps || tax.sell_bps)) taxText = `buy ${tax.buy_bps / 100}% · sell ${tax.sell_bps / 100}%`;
    }
  }
  if (creator && RELAYERS.test(creator)) creator = undefined; // a relayer signed it; the real creator isn't knowable from the tx alone

  const tokenAgeMs = first?.timestampMs ?? 0;
  sections.push({
    title: "🪙 Token",
    lines: [
      { label: "Name", value: `${meta.name} ($${meta.symbol})` },
      { label: "Contract", value: id },
      { label: "Total supply", value: supply.toLocaleString("en-US", { maximumFractionDigits: 0 }) },
      { label: "Created", value: tokenAgeMs ? `${dateStr(tokenAgeMs)} (${ago(tokenAgeMs)} ago)` : "before the indexed history (older token)" },
      ...(first?.totalTxs ? [{ label: "Transactions", value: first.totalTxs.toLocaleString("en-US") }] : []),
      ...(taxText ? [{ label: "Tax", value: taxText }] : []),
    ],
  });

  const lpLines = [
    { label: "Launchpad", value: lp ? lp.name : parentOf(id) ? `unknown factory: ${parentOf(id)}` : "none (standalone contract)" },
    ...(factory && launchMethod ? [{ label: "Launch call", value: `${launchMethod} on ${factory}` }] : []),
    { label: "Tradable in Allpilot", value: lp?.native ? "yes — native (Rhea DCL pool)" : price.price !== undefined ? "yes — via Rhea" : "no market found" },
    ...(devBuy ? [{ label: "Creator's first buy", value: devBuy }] : []),
  ];
  if (lp?.native) {
    const [off, all] = await Promise.all([officialPool(id).catch(() => null), dclPools().catch(() => [])]);
    const others = all.filter((p) => (p.token_x === id || p.token_y === id) && p.pool_id !== off?.poolId).length;
    lpLines.push({ label: "Official pool", value: off ? `${off.poolId} ✅` : "couldn't verify ⚠️" });
    if (others) lpLines.push({ label: "Other pools", value: `${others} (Allpilot never trades through them)` });
    if (!off) flags.push({ level: "risk", text: "Its official launch pool couldn't be verified on-chain — Allpilot won't trade it." });
  }
  sections.push({ title: "🚀 Launchpad", lines: lpLines });
  if (!lp && parentOf(id)) flags.push({ level: "warn", text: `Launched from ${parentOf(id)}, a factory Allpilot doesn't know yet — check it yourself.` });
  else if (lp && !lp.native) flags.push({ level: "ok", text: `From ${lp.name} (recognised; not a native Allpilot launchpad).` });

  // --- creator profile
  let creatorHoldPct: number | undefined;
  if (creator) {
    const [prof, held, launches] = await Promise.all([
      walletProfile(creator),
      ftBalance(id, creator).then((b) => (Number(b) / 10 ** meta.decimals / (supply || 1)) * 100).catch(() => undefined),
      launchesBy(creator).catch(() => null),
    ]);
    creatorHoldPct = held;
    const tokensCreated = nearlyCount !== undefined ? Math.max(nearlyCount, launches?.count ?? 0) : launches?.count;
    sections.push({
      title: "👤 Creator",
      lines: [
        { label: "Wallet", value: creator },
        { label: "Wallet age", value: prof.ageMs ? `${ago(prof.ageMs)} (since ${prof.created})` : "unknown" },
        { label: "Funded / created by", value: prof.funder ? `${prof.funder}${prof.funderNote ? ` — ${prof.funderNote}` : ""}` : "unknown" },
        { label: "Activity", value: `${prof.totalTxs ? `${prof.totalTxs.toLocaleString("en-US")} transactions · ` : ""}${fromBase(prof.nearBalance, 24, 2)} NEAR now` },
        {
          label: "Tokens launched",
          value:
            tokensCreated === undefined
              ? "unknown"
              : `${tokensCreated}${nearlyCount !== undefined ? " on nearly.trade" : ` in its last ${launches?.scanned ?? 0} txs`}${
                  launches && Object.keys(launches.factories).length ? ` (${Object.entries(launches.factories).map(([f, n]) => `${n}× ${f}`).join(", ")})` : ""
                }`,
        },
        { label: "Holds of this token", value: creatorHoldPct === undefined ? "—" : pctStr(creatorHoldPct) },
      ],
    });
    if (prof.ageMs && Date.now() - prof.ageMs < 7 * 86_400_000) flags.push({ level: "risk", text: `Creator wallet is only ${ago(prof.ageMs)} old.` });
    if ((tokensCreated ?? 0) >= 5) flags.push({ level: "risk", text: `Serial launcher: the creator launched ${tokensCreated} tokens.` });
    if ((creatorHoldPct ?? 0) > 10) flags.push({ level: "risk", text: `Creator still holds ${pctStr(creatorHoldPct!)} of supply.` });
    else if (creatorHoldPct !== undefined && creatorHoldPct < 0.01 && devBuy) flags.push({ level: "warn", text: "Creator bought at launch and has since sold (almost) everything." });
  } else {
    sections.push({ title: "👤 Creator", lines: [{ label: "Wallet", value: "couldn't determine (signed by a relayer or very old contract)" }] });
  }

  // --- holders
  if (holders.length && supply > 0) {
    const real = holders.filter((h) => !INFRA.test(h.account_id));
    const share = (b: string) => (Number(b) / 10 ** meta.decimals / supply) * 100;
    const top10 = real.slice(0, 10).reduce((s, h) => s + share(h.balance), 0);
    const inPools = holders.filter((h) => /dclv2\.ref-labs\.near|v2\.ref-finance\.near/.test(h.account_id)).reduce((s, h) => s + share(h.balance), 0);
    const biggest = real[0];
    sections.push({
      title: "👥 Holders",
      lines: [
        { label: "Top 10 wallets", value: `${pctStr(top10)} of supply` },
        ...(biggest ? [{ label: "Largest wallet", value: `${biggest.account_id.length > 28 ? biggest.account_id.slice(0, 10) + "…" + biggest.account_id.slice(-6) : biggest.account_id} · ${pctStr(share(biggest.balance))}` }] : []),
        { label: "In Rhea pools", value: `${pctStr(inPools)} of supply` },
        { label: "Holders listed", value: `${holders.length}${holders.length >= 100 ? "+" : ""}` },
      ],
    });
    if (top10 > 50) flags.push({ level: "risk", text: `Top 10 wallets hold ${pctStr(top10)} — highly concentrated.` });
    else if (top10 > 25) flags.push({ level: "warn", text: `Top 10 wallets hold ${pctStr(top10)}.` });
    if (holders.length < 20) flags.push({ level: "warn", text: `Only ${holders.length} holders.` });
  }

  // --- market
  const mcap = price.price !== undefined ? price.price * supply : undefined;
  sections.push({
    title: "📈 Market",
    lines: [
      { label: "Price", value: fmtPrice(price.price) },
      { label: "Market cap (FDV)", value: usd(mcap) },
      ...(volume > 0n ? [{ label: "wNEAR volume", value: `${fromBase(volume, 24, 0)} NEAR all-time` }] : []),
    ],
  });
  if (price.price === undefined) flags.push({ level: "risk", text: "No market: no pool or no liquidity to sell into." });

  // --- lookalikes
  const verifiedId = VERIFIED[meta.symbol.toUpperCase()];
  if (verifiedId === id) flags.unshift({ level: "ok", text: `This is the verified $${meta.symbol} contract.` });
  else if (verifiedId) flags.unshift({ level: "risk", text: `NOT the verified $${meta.symbol} — the real one is ${verifiedId}. Likely a copycat.` });
  else if (lookalike && lookalike.lookalikes > 0) flags.push({ level: "warn", text: `${lookalike.lookalikes} other token(s) use the symbol $${meta.symbol}.` });
  if (tokenAgeMs && Date.now() - tokenAgeMs < 86_400_000) flags.push({ level: "warn", text: `Brand new: launched ${ago(tokenAgeMs)} ago.` });
  if (taxText) flags.push({ level: "warn", text: `Has a tax: ${taxText}.` });

  const copycat = verifiedId !== undefined && verifiedId !== id;
  const risks = flags.filter((f) => f.level === "risk").length + (copycat ? 1 : 0);
  const warns = flags.filter((f) => f.level === "warn").length;
  const level = risks >= 2 ? "high" : risks === 1 || warns >= 2 ? "medium" : "low";
  sections.push({ title: `🚦 Risk signals · ${level}`, lines: flags.map((f) => ({ label: f.level === "risk" ? "🔴" : f.level === "warn" ? "🟡" : "🟢", value: f.text })) });

  return {
    id: uid(),
    kind: "analysis",
    title: `Analysis · $${meta.symbol}`,
    icon: meta.icon && meta.icon.startsWith("data:image/") && meta.icon.length < 60_000 ? meta.icon : undefined,
    launchpad: lp?.factory.includes("justhoot") ? "justhoot" : lp?.factory === "nearlytrade.near" ? "nearly" : null,
    lines: [],
    sections,
    warnings: ["Signals, not a verdict. On-chain data can't prove intent — never buy more than you can lose."],
    transactions: [],
    nearSpend: "0",
    links: [
      { label: "NearBlocks", href: `https://nearblocks.io/token/${id}` },
      ...(lp?.site ? [{ label: lp.name, href: lp.factory.includes("justhoot") ? `https://justhoot.fun/p/${id}` : lp.factory === "nearlytrade.near" ? `https://nearly.trade/${id}` : lp.site }] : []),
      ...(creator ? [{ label: "Creator wallet", href: `https://nearblocks.io/address/${creator}` }] : []),
    ],
  };
}

// ---------------------------------------------------------------- wallet analysis (when the address isn't a token)

export async function analyzeWallet(id: string): Promise<ActionCard> {
  const [prof, launches] = await Promise.all([walletProfile(id), launchesBy(id).catch(() => null)]);
  const nearly = (await allNearlyLaunches().catch(() => [])).filter((l) => l.creator === id);
  const lines = [
    { label: "Account", value: id },
    { label: "Age", value: prof.ageMs ? `${ago(prof.ageMs)} (since ${prof.created})` : "unknown" },
    { label: "Funded / created by", value: prof.funder ? `${prof.funder}${prof.funderNote ? ` — ${prof.funderNote}` : ""}` : "unknown" },
    { label: "Activity", value: `${prof.totalTxs.toLocaleString("en-US")} transactions` },
    { label: "NEAR balance", value: `${fromBase(prof.nearBalance, 24, 2)} NEAR` },
    { label: "Tokens launched", value: `${Math.max(launches?.count ?? 0, nearly.length)}${nearly.length ? ` (incl. ${nearly.length} on nearly.trade)` : ""}` },
  ];
  if (nearly.length) lines.push({ label: "Recent launches", value: nearly.slice(-5).map((l) => l.token).join(", ") });
  return {
    id: uid(),
    kind: "analysis",
    title: `Wallet analysis · ${id.length > 24 ? id.slice(0, 10) + "…" + id.slice(-6) : id}`,
    lines: [],
    sections: [{ title: "👤 Wallet", lines }],
    warnings: ["This address isn't a token contract, so here's a wallet profile instead."],
    transactions: [],
    nearSpend: "0",
    links: [{ label: "NearBlocks", href: `https://nearblocks.io/address/${id}` }],
  };
}

/** Does a message look like a bare contract/account address (so we should analyze it)? */
export function looksLikeAddress(text: string): string | null {
  const t = text.trim().replace(/^\$/, "");
  const url = t.match(/^https?:\/\/(?:www\.)?(?:nearblocks\.io\/(?:token|address)|justhoot\.fun\/p|nearly\.trade)\/([a-z0-9._-]+)/i);
  if (url) return url[1].toLowerCase();
  if (/^[0-9a-f]{64}$/.test(t)) return t;
  if (/^(?=.{2,64}$)([a-z0-9_-]+\.)+(near|tg)$/i.test(t)) return t.toLowerCase();
  return null;
}
