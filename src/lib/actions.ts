// High-level actions the AI can call. Each returns an ActionCard (a proposal) — never signs.

import type { ActionCard, Venue } from "./cards";
import { NoOfficialPoolError, latestNearlyLaunches } from "./dcl";
import { findIntentsToken, intentsQuote, intentsTokens, normalizeChain, type IntentsToken } from "./intents";
import { WRAP_NEAR, fromBase, ftBalance, ftMetadata, getNativeBalance, isNearAccountId, storageNeeded, toBase } from "./near";
import { planRheaSwap } from "./rhea";
import { NoRouteError, ThinLiquidityError, planRoute, type RoutePlan } from "./deeproute";
import { launchpadName } from "./launchpads";
import { resolveToken, rheaPrices, VERIFIED, type TokenInfo } from "./tokens";
import { PlannedTx, appendTx, fc, ftTransfer, prepTxs, storageDeposit, totalAttachedNear } from "./tx";

const uid = () => Math.random().toString(36).slice(2, 10);
const DEFAULT_SLIPPAGE = 100; // 1%
const MEME_SLIPPAGE = 300; // 3% — thin one-sided pools move fast

// Big, liquid tokens — Rhea's smart router aggregates these well; everything else is "long tail".
const MAJORS = new Set([
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "usdt.tether-token.near",
  "token.v2.ref-finance.near",
  "token.rhealab.near",
  "linear-protocol.near",
  "meta-pool.near",
  "lst.rhealab.near",
  "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near",
]);

async function symbolOf(token: string): Promise<string> {
  if (token === WRAP_NEAR) return "NEAR";
  if (VIA_NAMES[token]) return VIA_NAMES[token];
  return (await ftMetadata(token).catch(() => null))?.symbol ?? token.split(".")[0].slice(0, 10).toUpperCase();
}

async function routeLabel(plan: RoutePlan, where: string): Promise<string> {
  const path: string[] = [];
  for (const sg of plan.segments) for (const tk of sg.tokens) if (path.at(-1) !== tk) path.push(tk);
  const names = await Promise.all(path.map(symbolOf));
  const how = plan.official ? `✅ official ${where} launch pool` : `🌊 deepest liquidity · $${Math.round(plan.liquidityUsd).toLocaleString("en-US")}`;
  return `${how} · ${names.join(" → ")}`;
}

const VIA_NAMES: Record<string, string> = {
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "USDC",
  "usdt.tether-token.near": "USDT",
  "token.0xshitzu.near": "SHITZU",
  "token.v2.ref-finance.near": "REF",
  "token.rhealab.near": "RHEA",
};

const LAUNCHPAD_NAME = { justhoot: "JustHoot", nearly: "nearly.trade" } as const;

function explorer(id: string) {
  return id === "near" ? undefined : { label: "View token", href: `https://nearblocks.io/token/${id}` };
}

function lookalikeWarning(sym: string, lookalikes: number, best: TokenInfo): string[] {
  const w: string[] = [];
  if (lookalikes > 0)
    w.push(
      `${lookalikes} other token(s) also use the symbol ${sym}. Picked ${best.verified ? "the verified contract" : "the one with the most real wNEAR volume"}: ${best.id}. Double-check it.`,
    );
  if (!best.verified && best.id !== "near") w.push("This contract is not on Allpilot's verified list. Memecoins can go to zero.");
  return w;
}

function usd(amountBase: string, decimals: number, price?: number) {
  if (!price) return undefined;
  return (Number(amountBase) / 10 ** decimals) * price;
}

function impactWarning(usdIn?: number, usdOut?: number): string[] {
  if (!usdIn || !usdOut || usdIn < 0.5) return [];
  const loss = 1 - usdOut / usdIn;
  if (loss > 0.05) return [`Price impact / fees look high: you get ~${(loss * 100).toFixed(1)}% less value out than in.`];
  return [];
}

// ---------------------------------------------------------------- balances

export async function getBalances(accountId: string, symbols: string[] = ["NEAR", "USDC", "USDT", "HOOT", "NEARLY", "REF"]) {
  const out: { symbol: string; token: string; amount: string }[] = [];
  for (const s of symbols) {
    const id = VERIFIED[s.toUpperCase()] ?? s;
    try {
      if (id === "near") {
        out.push({ symbol: "NEAR", token: "near", amount: fromBase(await getNativeBalance(accountId), 24, 4) });
        continue;
      }
      const r = await resolveToken(id);
      if (!r.best) continue;
      const bal = await ftBalance(r.best.id, accountId);
      out.push({ symbol: r.best.symbol, token: r.best.id, amount: fromBase(bal, r.best.decimals, 4) });
    } catch {
      /* skip unknown */
    }
  }
  return out;
}

// ---------------------------------------------------------------- swap

export async function swap(opts: {
  from: string;
  to: string;
  amount: string; // human units of `from`
  venue?: "near-intents" | "rhea" | "auto";
  accountId?: string;
  slippageBps?: number;
  noLongTailRedirect?: boolean;
}): Promise<ActionCard> {
  const [rin, rout] = await Promise.all([resolveToken(opts.from), resolveToken(opts.to)]);
  if (!rin.best) throw new Error(`I couldn't find a token called "${opts.from}" on NEAR.`);
  if (!rout.best) throw new Error(`I couldn't find a token called "${opts.to}" on NEAR.`);
  const tin = rin.best;
  const tout = rout.best;
  if (tout.launchpad || tin.launchpad) {
    return memeTrade({ token: tout.launchpad ? tout.id : tin.id, side: tout.launchpad ? "buy" : "sell", amount: opts.amount, accountId: opts.accountId });
  }
  const amountIn = toBase(opts.amount, tin.decimals);
  const slippage = opts.slippageBps ?? DEFAULT_SLIPPAGE;
  const venue = opts.venue ?? "near-intents";

  // NEAR ↔ a long-tail token (not a major, not on NEAR Intents): use the deepest-liquidity route
  const isNear = (t: TokenInfo) => t.id === "near" || t.id === WRAP_NEAR;
  const isMajor = async (t: TokenInfo) => isNear(t) || MAJORS.has(t.id) || !!(await findIntentsTokenById(t.id));
  if (!opts.noLongTailRedirect && ((isNear(tin) && !(await isMajor(tout))) || (isNear(tout) && !(await isMajor(tin))))) {
    const longTail = isNear(tin) ? tout : tin;
    return memeTrade({ token: longTail.id, side: isNear(tin) ? "buy" : "sell", amount: opts.amount, accountId: opts.accountId, slippageBps: opts.slippageBps });
  }

  if (venue !== "rhea") {
    const oin = await findIntentsTokenById(tin.id);
    const oout = await findIntentsTokenById(tout.id);
    if (oin && oout) {
      return intentsCard({
        kind: "swap",
        title: `Swap ${opts.amount} ${tin.symbol} → ${tout.symbol}`,
        origin: oin,
        dest: oout,
        amountIn,
        amountHuman: opts.amount,
        accountId: opts.accountId,
        recipient: opts.accountId,
        refundTo: opts.accountId,
        slippage,
        nativeIn: tin.id === "near",
        extraWarnings: [...lookalikeWarning(tout.symbol, rout.lookalikes, tout)],
      });
    }
    if (venue === "near-intents")
      // fall through to Rhea with a note
      return withNote(await rheaSwapCard(tin, tout, opts.amount, amountIn, slippage, opts.accountId, rout.lookalikes), `${tin.symbol}/${tout.symbol} isn't on NEAR Intents, so I routed it through Rhea instead.`);
  }
  return rheaSwapCard(tin, tout, opts.amount, amountIn, slippage, opts.accountId, rout.lookalikes);
}

function withNote(card: ActionCard, note: string): ActionCard {
  card.warnings.unshift(note);
  return card;
}

async function findIntentsTokenById(id: string): Promise<IntentsToken | null> {
  const list = await intentsTokens();
  const contract = id === "near" ? WRAP_NEAR : id;
  return list.find((t) => t.blockchain === "near" && t.assetId === `nep141:${contract}`) ?? null;
}

async function rheaSwapCard(tin: TokenInfo, tout: TokenInfo, human: string, amountIn: string, slippage: number, accountId: string | undefined, lookalikes: number): Promise<ActionCard> {
  const plan = await planRheaSwap({ tokenIn: tin.id, tokenOut: tout.id, amountIn, slippageBps: slippage, accountId });
  if (!plan) throw new Error(`Rhea has no route for ${tin.symbol} → ${tout.symbol} right now.`);
  const usdIn = usd(amountIn, tin.decimals, tin.priceUsd);
  const usdOut = usd(plan.amountOut, tout.decimals, tout.priceUsd);
  return {
    id: uid(),
    kind: "swap",
    title: `Swap ${human} ${tin.symbol} → ${tout.symbol}`,
    venue: "rhea",
    lines: [
      { label: "You pay", value: `${human} ${tin.symbol}` },
      { label: "You get (est.)", value: `${fromBase(plan.amountOut, tout.decimals)} ${tout.symbol}` },
      { label: "Minimum", value: `${fromBase(plan.minAmountOut, tout.decimals)} ${tout.symbol}` },
      { label: "Route", value: `Rhea smart router · ${plan.hops.length - 1} hop(s)` },
      { label: "Slippage", value: `${slippage / 100}%` },
    ],
    warnings: [...lookalikeWarning(tout.symbol, lookalikes, tout), ...impactWarning(usdIn, usdOut)],
    transactions: plan.transactions,
    nearSpend: totalAttachedNear(plan.transactions).toString(),
    usdIn,
    needsWallet: !accountId,
    links: [explorer(tout.id)].filter(Boolean) as ActionCard["links"],
    expiresAt: Date.now() + 2 * 60_000,
  };
}

// ---------------------------------------------------------------- NEAR Intents (swap + bridge)

async function intentsCard(o: {
  kind: "swap" | "bridge";
  title: string;
  origin: IntentsToken;
  dest: IntentsToken;
  amountIn: string;
  amountHuman: string;
  accountId?: string;
  recipient?: string;
  refundTo?: string;
  slippage: number;
  nativeIn?: boolean;
  extraWarnings?: string[];
}): Promise<ActionCard> {
  const originOnNear = o.origin.blockchain === "near";
  const canExecute = !!(o.recipient && o.refundTo && (!originOnNear || o.accountId));
  const q = await intentsQuote({
    originAsset: o.origin.assetId,
    destinationAsset: o.dest.assetId,
    amount: o.amountIn,
    recipient: o.recipient ?? (o.dest.blockchain === "near" ? "intents.near" : placeholderFor(o.dest.blockchain)),
    refundTo: o.refundTo ?? (originOnNear ? "intents.near" : placeholderFor(o.origin.blockchain)),
    slippageBps: o.slippage,
    dry: !canExecute,
  });
  const quote = q.quote;
  const destSym = o.dest.symbol === "wNEAR" ? "NEAR" : o.dest.symbol;
  const originSym = o.origin.symbol === "wNEAR" && o.nativeIn ? "NEAR" : o.origin.symbol;
  const lines = [
    { label: "You send", value: `${o.amountHuman} ${originSym} on ${chainName(o.origin.blockchain)}` },
    { label: "You get (est.)", value: `${quote.amountOutFormatted} ${destSym} on ${chainName(o.dest.blockchain)}` },
    { label: "Minimum", value: `${fromBase(quote.minAmountOut, o.dest.decimals)} ${destSym}` },
    { label: "Route", value: "NEAR Intents (1Click) — same engine as near.com" },
    { label: "Time", value: quote.timeEstimate ? `~${quote.timeEstimate}s` : "a few seconds" },
  ];
  if (o.recipient && o.kind === "bridge") lines.push({ label: "Recipient", value: o.recipient });

  const warnings = [...(o.extraWarnings ?? [])];
  if (!process.env.ONECLICK_JWT) warnings.push("No 1Click partner key set, so NEAR Intents adds a 0.2% fee.");
  if (o.dest.symbol === "wNEAR") warnings.push("You'll receive wNEAR (wrapped NEAR). It's 1:1 with NEAR.");
  warnings.push(...impactWarning(Number(quote.amountInUsd) || undefined, Number(quote.amountOutUsd) || undefined));

  const transactions: PlannedTx[] = [];
  let externalDeposit: { chain: string; symbol: string; amount: string } | undefined;
  const depositAddress = quote.depositAddress;

  if (canExecute && depositAddress) {
    if (originOnNear && o.accountId) {
      const token = o.origin.contractAddress ?? o.origin.assetId.replace(/^nep141:/, "");
      const actions = [];
      if (o.nativeIn && token === WRAP_NEAR) {
        const needSelf = await storageNeeded(WRAP_NEAR, o.accountId);
        if (needSelf) actions.push(storageDeposit(o.accountId, needSelf));
        actions.push(fc("near_deposit", {}, 10, o.amountIn));
      }
      const needDeposit = await storageNeeded(token, depositAddress);
      if (needDeposit) actions.push(storageDeposit(depositAddress, needDeposit));
      actions.push(ftTransfer(depositAddress, o.amountIn));
      // Make sure the user can receive the output token on NEAR.
      if (o.dest.blockchain === "near" && o.recipient === o.accountId) {
        const outToken = o.dest.contractAddress ?? o.dest.assetId.replace(/^nep141:/, "");
        transactions.push(...(await prepTxs({ accountId: o.accountId, outputToken: outToken })));
      }
      appendTx(transactions, { receiverId: token, actions });
    } else {
      externalDeposit = { chain: chainName(o.origin.blockchain), symbol: o.origin.symbol, amount: o.amountHuman };
      if (o.dest.blockchain === "near" && o.accountId) {
        const outToken = o.dest.contractAddress ?? o.dest.assetId.replace(/^nep141:/, "");
        transactions.push(...(await prepTxs({ accountId: o.accountId, outputToken: outToken })));
      }
    }
  }

  return {
    id: uid(),
    kind: o.kind,
    title: o.title,
    venue: "near-intents" as Venue,
    lines,
    warnings,
    transactions,
    nearSpend: totalAttachedNear(transactions).toString(),
    usdIn: Number(quote.amountInUsd) || undefined,
    intents: depositAddress ? { depositAddress, depositMemo: quote.depositMemo, externalDeposit } : undefined,
    needsWallet: originOnNear && !o.accountId,
    expiresAt: quote.deadline ? Date.parse(quote.deadline) : Date.now() + 10 * 60_000,
    links: depositAddress ? [{ label: "Track on NEAR Intents explorer", href: `https://explorer.near-intents.org/transactions/${depositAddress}` }] : [],
  };
}

const CHAIN_NAMES: Record<string, string> = {
  near: "NEAR", eth: "Ethereum", sol: "Solana", btc: "Bitcoin", base: "Base", arb: "Arbitrum", pol: "Polygon",
  bsc: "BNB Chain", avax: "Avalanche", op: "Optimism", tron: "Tron", ton: "TON", doge: "Dogecoin", xrp: "XRP Ledger",
  zec: "Zcash", sui: "Sui", aptos: "Aptos", gnosis: "Gnosis", bera: "Berachain", stellar: "Stellar", cardano: "Cardano", ltc: "Litecoin",
};
export const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();
export function placeholderFor(chain: string) {
  // Only used for dry (quote-only) requests; never receives funds.
  // (Example addresses from the 1Click OpenAPI docs.)
  if (["eth", "base", "arb", "pol", "bsc", "avax", "op", "gnosis", "bera"].includes(chain)) return "0x2527D02599Ba641c19FEa793cD0F167589a0f10D";
  if (chain === "sol") return "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
  if (chain === "btc") return "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
  if (chain === "near") return "intents.near";
  throw new Error(`To quote on ${chainName(chain)} I need a real ${chainName(chain)} address from you.`);
}

export async function listBridgeChains(symbol?: string) {
  const list = await intentsTokens();
  const filtered = symbol ? list.filter((t) => t.symbol.toUpperCase() === symbol.toUpperCase()) : list;
  const chains = [...new Set(filtered.map((t) => t.blockchain))].map(chainName);
  return chains;
}

export async function bridge(opts: {
  token: string; // symbol, e.g. USDC
  amount: string;
  fromChain: string; // "near" or another chain
  toChain: string;
  toToken?: string; // optional different symbol on the destination (bridge + swap)
  recipient?: string; // destination address (required when leaving NEAR)
  refundTo?: string; // origin-chain address (required when arriving to NEAR from elsewhere)
  accountId?: string;
}): Promise<ActionCard> {
  const fromC = normalizeChain(opts.fromChain) ?? "near";
  const toC = normalizeChain(opts.toChain) ?? "near";
  const origin = await findIntentsToken(opts.token, fromC);
  const dest = await findIntentsToken(opts.toToken ?? opts.token, toC);
  if (!origin) throw new Error(`NEAR Intents doesn't support ${opts.token} on ${chainName(fromC)}. Try: ${(await listBridgeChains(opts.token)).join(", ") || "another token"}.`);
  if (!dest) throw new Error(`NEAR Intents doesn't support ${opts.toToken ?? opts.token} on ${chainName(toC)}. Available chains for it: ${(await listBridgeChains(opts.toToken ?? opts.token)).join(", ")}.`);

  const nativeIn = fromC === "near" && opts.token.toUpperCase() === "NEAR";
  const recipient = toC === "near" ? opts.recipient ?? opts.accountId : opts.recipient;
  const refundTo = fromC === "near" ? opts.accountId : opts.refundTo;
  if (toC === "near" && recipient && !isNearAccountId(recipient)) throw new Error(`"${recipient}" is not a valid NEAR account.`);

  const warnings: string[] = [];
  if (!recipient) warnings.push(`Tell me the ${chainName(toC)} address that should receive the funds, and I'll make it signable.`);
  if (fromC !== "near" && !refundTo) warnings.push(`Tell me your ${chainName(fromC)} address for refunds, then I'll give you a deposit address.`);
  if (fromC !== "near") warnings.push(`You'll send from your ${chainName(fromC)} wallet to the deposit address shown. Send exactly the amount, on the right chain.`);

  return intentsCard({
    kind: "bridge",
    title: `Bridge ${opts.amount} ${opts.token.toUpperCase()} · ${chainName(fromC)} → ${chainName(toC)}`,
    origin,
    dest,
    amountIn: toBase(opts.amount, origin.decimals),
    amountHuman: opts.amount,
    accountId: opts.accountId,
    recipient,
    refundTo,
    slippage: DEFAULT_SLIPPAGE,
    nativeIn,
    extraWarnings: warnings,
  });
}

// ---------------------------------------------------------------- memecoins (JustHoot, nearly.trade, Rhea)

export async function memeTrade(opts: {
  token: string; // symbol or contract
  side?: "buy" | "sell";
  amount: string; // NEAR to spend (buy) or tokens to sell (sell)
  accountId?: string;
  slippageBps?: number;
}): Promise<ActionCard> {
  const side = opts.side ?? "buy";
  const r = await resolveToken(opts.token, { memeOnly: false });
  if (!r.best) throw new Error(`I couldn't find a meme token called "${opts.token}".`);
  const t = r.best;
  const slippage = opts.slippageBps ?? MEME_SLIPPAGE;
  const prices = await rheaPrices();
  const nearPrice = Number(prices[WRAP_NEAR]?.price ?? 0);

  const tokenIn = side === "buy" ? "near" : t.id;
  const tokenOut = side === "buy" ? t.id : "near";
  const decIn = side === "buy" ? 24 : t.decimals;
  const decOut = side === "buy" ? t.decimals : 24;
  const amountIn = toBase(opts.amount, decIn);

  // Launchpad memes: only their official launch pool. Everything else: the route with the deepest real liquidity.
  // Either way the rest of the path to NEAR goes through hub assets / a second linked transaction if needed.
  let plan: RoutePlan;
  try {
    plan = await planRoute({ tokenIn, tokenOut, amountIn, slippageBps: slippage, accountId: opts.accountId });
  } catch (e) {
    if (e instanceof NoOfficialPoolError) throw e;
    if (e instanceof ThinLiquidityError) throw new Error(`Not trading ${t.symbol}: ${e.message}`);
    // one-sided launch pools: nobody has bought yet, so there's nothing to sell into
    if (t.launchpad && side === "sell") throw new Error(`${t.symbol}'s launch pool has no buyers yet, so there's nothing to sell into right now.`);
    // last resort: NEAR Intents, if its solvers support the token
    if (!t.launchpad && (await findIntentsTokenById(t.id).catch(() => null))) {
      return swap({ from: side === "buy" ? "near" : t.id, to: side === "buy" ? t.id : "near", amount: opts.amount, venue: "near-intents", accountId: opts.accountId, slippageBps: opts.slippageBps, noLongTailRedirect: true });
    }
    throw new Error(e instanceof NoRouteError ? `No route with real liquidity to ${side} ${t.symbol} (${t.id}).` : `Couldn't route ${t.symbol}: ${e instanceof Error ? e.message : e}`);
  }
  const off = plan.official ?? null;

  const where = t.launchpad ? LAUNCHPAD_NAME[t.launchpad] : launchpadName(t.id) ?? "Rhea";
  const thin = !off && plan.liquidityUsd < 1000;
  const symIn = side === "buy" ? "NEAR" : t.symbol;
  const symOut = side === "buy" ? t.symbol : "NEAR";
  const usdIn = side === "buy" ? Number(opts.amount) * nearPrice : usd(amountIn, t.decimals, t.priceUsd);
  const usdOut = side === "buy" ? usd(plan.amountOut, t.decimals, t.priceUsd) : (Number(plan.amountOut) / 1e24) * nearPrice;

  return {
    id: uid(),
    kind: "meme",
    title: `${side === "buy" ? "Buy" : "Sell"} ${t.symbol} ${side === "buy" ? `with ${opts.amount} NEAR` : `· ${opts.amount}`}`,
    venue: plan.segments.some((sg) => sg.venue === "rhea-dcl") ? "rhea-dcl" : "rhea",
    launchpad: t.launchpad,
    lines: [
      { label: "Token", value: `${t.symbol}${t.name && t.name !== t.symbol ? ` · ${t.name}` : ""}` },
      { label: "Contract", value: t.id },
      { label: "Launchpad", value: where },
      { label: "You pay", value: `${opts.amount} ${symIn}` },
      { label: "You get (est.)", value: `${fromBase(plan.amountOut, decOut)} ${symOut}` },
      { label: "Minimum", value: `${fromBase(plan.minAmountOut, decOut)} ${symOut}` },
      { label: "Route", value: await routeLabel(plan, where) },
      ...(off ? [{ label: "Official pool", value: off.poolId }] : [{ label: "Pools", value: plan.segments.map((sg) => sg.poolIds.join(" → ")).join("  ⟶  ") }]),
      ...(plan.segments.length > 1 ? [{ label: "Transactions", value: `${plan.segments.length} linked swaps (Rhea classic + DCL), signed together` }] : []),
      { label: "Slippage", value: `${slippage / 100}%` },
    ],
    warnings: [
      ...lookalikeWarning(t.symbol, r.lookalikes, t),
      ...impactWarning(usdIn, usdOut),
      ...(thin ? [`Thin market: even the deepest route only holds ~$${Math.round(plan.liquidityUsd)}. Big trades will move the price a lot.`] : []),
      ...(plan.leftoverToken ? [`Two-step route: if the first swap fills better than its minimum, the small surplus stays in your wallet as ${await symbolOf(plan.leftoverToken)}.`] : []),
    ],
    transactions: plan.transactions,
    nearSpend: totalAttachedNear(plan.transactions).toString(),
    usdIn,
    needsWallet: !opts.accountId,
    links: [
      explorer(t.id),
      t.launchpad === "justhoot" ? { label: "Open on JustHoot", href: "https://justhoot.fun" } : undefined,
      t.launchpad === "nearly" ? { label: "Open on nearly.trade", href: "https://nearly.trade" } : undefined,
    ].filter(Boolean) as ActionCard["links"],
    expiresAt: Date.now() + 2 * 60_000,
  };
}

export async function trendingMemes() {
  const [launches, prices] = await Promise.all([latestNearlyLaunches(10), rheaPrices()]);
  const fresh = launches
    .filter((l) => !/^test/i.test(l.symbol))
    .slice(0, 6)
    .map((l) => ({ symbol: l.symbol, name: l.name, token: l.token, launchpad: "nearly.trade", ageMin: Math.round((Date.now() - l.created_at_ms) / 60_000) }));
  const majors = ["HOOT", "NEARLY", "BLACKDRAGON", "SHITZU"].map((s) => ({
    symbol: s,
    token: VERIFIED[s],
    priceUsd: Number(prices[VERIFIED[s]]?.price ?? 0) || undefined,
  }));
  return { verified: majors, freshOnNearly: fresh };
}
