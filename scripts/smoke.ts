// Read-only smoke test of every Allpilot feature against live NEAR mainnet.
// Fetches real quotes and builds the (unsigned) transactions a wallet would sign. Signs and sends NOTHING.
//
//   npm run smoke                      # uses a well-known public account for balance-dependent checks
//   npm run smoke -- your-account.near

import type { ActionCard } from "../src/lib/cards";
import { bridge, memeTrade, swap, trendingMemes } from "../src/lib/actions";
import { merchantCheckout, pay, paymentLink } from "../src/lib/pay";
import { launchToken } from "../src/lib/launch";
import { addLiquidity } from "../src/lib/liquidity";
import { lendingOverview, supply } from "../src/lib/lending";
import { stake, stakingOverview } from "../src/lib/staking";
import { checkCard } from "../src/lib/guard";
import { portfolioCard } from "../src/lib/portfolio";
import { analyzeToken } from "../src/lib/analyze";
import { pnlCard } from "../src/lib/pnl";
import { sharePnlCard } from "../src/lib/pnlShare";
import { launchOptions } from "../src/lib/launch";

const acct = process.argv[2] ?? "zavodil.near";
const POLICY = { maxNearPerAction: 1000, maxUsdPerAction: 100000 };
const TEST_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let passed = 0;
let failed = 0;

function show(name: string, c: ActionCard) {
  const guard = checkCard(c, POLICY, acct);
  console.log(`\n✅ ${name}: ${c.title}${c.venue ? ` [${c.venue}]` : ""}`);
  for (const l of c.lines) console.log(`   ${l.label}: ${l.value}`);
  for (const s of c.sections ?? []) for (const l of s.lines) console.log(`   ${s.title} · ${l.label}: ${l.value}`);
  for (const r of (c.pnlRows ?? []).slice(0, 6)) console.log(`   ${r.symbol}: ${r.trades} · in ${r.invested} · total ${r.total} ${r.roi}`);
  for (const r of (c.rows ?? []).slice(0, 6)) console.log(`   ${r.symbol}: ${r.amount} @ ${r.price} = ${r.value}${r.badge ? ` [${r.badge}]` : ""}`);
  for (const w of c.warnings) console.log(`   ⚠ ${w}`);
  const txs = c.transactions.map((t) => `${t.receiverId}(${t.actions.map((a) => ("methodName" in a.params ? a.params.methodName : a.type)).join("+")})`);
  console.log(`   txs: ${txs.join(" → ") || "none (quote only)"}`);
  if (c.transactions.length) console.log(`   Pilot Guard: ${guard.ok ? "pass" : `BLOCKED — ${guard.reasons.join(" ")}`}`);
}

async function run(name: string, f: () => Promise<ActionCard>) {
  try {
    show(name, await f());
    passed++;
  } catch (e) {
    console.log(`\n❌ ${name}: ${e instanceof Error ? e.message : e}`);
    failed++;
  }
}

(async () => {
  console.log(`Allpilot smoke test · account ${acct} · mainnet · read-only`);
  await run("swap (NEAR Intents)", () => swap({ from: "NEAR", to: "USDC", amount: "1", accountId: acct }));
  await run("swap (Rhea)", () => swap({ from: "NEAR", to: "USDC", amount: "1", venue: "rhea", accountId: acct }));
  await run("buy meme (JustHoot HOOT)", () => memeTrade({ token: "HOOT", amount: "0.1", accountId: acct }));
  await run("buy non-launchpad token (deepest liquidity)", () => memeTrade({ token: "blackdragon.tkn.near", amount: "0.5", accountId: acct }));
  await run("sell non-launchpad token (deepest liquidity)", () => memeTrade({ token: "token.0xshitzu.near", side: "sell", amount: "100", accountId: acct }));
  await run("buy meme paired with RHEA (two linked swaps)", () => memeTrade({ token: "alphar.nearlytrade.near", amount: "0.5", accountId: acct }));
  await run("buy LiNEAR (stable/rated pool)", () => memeTrade({ token: "linear-protocol.near", amount: "0.5", accountId: acct }));
  await run("buy meme (nearly.trade NEARLY)", () => memeTrade({ token: "nearly", amount: "0.1", accountId: acct }));
  await run("bridge out (NEAR → Base)", () => bridge({ token: "USDC", amount: "5", fromChain: "near", toChain: "base", recipient: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", accountId: acct }));
  await run("bridge in (Ethereum → NEAR, quote)", () => bridge({ token: "ETH", amount: "0.01", fromChain: "eth", toChain: "near", accountId: acct }));
  await run("pay (exact output, pay in NEAR)", () => pay({ to: "intents.near", amount: "1", token: "USDC", payWith: "NEAR", accountId: acct }));
  await run("payment link", () => paymentLink({ to: "intents.near", amount: "10", token: "USDC", memo: "Order 42", baseUrl: "https://allpilot.vercel.app" }));
  await run("launch token (JustHoot)", () => launchToken({ launchpad: "justhoot", name: "Smoke Test", symbol: "SMOKE", icon: TEST_ICON, accountId: acct }));
  await run("launch JustHoot · USDC pair · 3% tax · 50/25/25 split · hosted description", () => launchToken({ launchpad: "justhoot", name: "Smoke Tax", symbol: "SMKT", pair: "USDC", taxPct: 3, split: { creator: 50, burn: 25, holders: 25 }, description: "smoke test", accountId: acct, baseUrl: "https://allpilot.vercel.app" }));
  await run("launch nearly · RHEA pair · 2%/3% tax · fees to holders · fee_to", () => launchToken({ launchpad: "nearly", name: "Smoke Tax", symbol: "SMKT", pair: "RHEA", buyTaxPct: 2, sellTaxPct: 3, split: { creator: 0, burn: 50, holders: 50 }, feeMode: "holders", accountId: acct }));
  await run("share PnL card (image + X link)", () => sharePnlCard("wowzer.near", "https://allpilot.vercel.app"));
  await run("store checkout setup (merchant NEAR account → website code)", () => merchantCheckout({ merchant: "intents.near", baseUrl: "https://allpilot.vercel.app" }));
  await run("launch token (nearly.trade)", () => launchToken({ launchpad: "nearly", name: "Smoke Test", symbol: "SMOKE", description: "test", icon: TEST_ICON, accountId: acct }));
  await run("add liquidity (Rhea)", () => addLiquidity({ tokenA: "near", tokenB: "usdc", amountA: "1", accountId: acct }));
  await run("lend (supply USDC)", () => supply({ token: "usdc", amount: "10", accountId: acct }));
  await run("stake (LiNEAR)", () => stake({ amount: "1", provider: "linear", accountId: acct }));
  await run("portfolio (memes priced)", () => portfolioCard(acct));
  await run("pnl (a public meme trader)", () => pnlCard("wowzer.near"));
  await run("analyze token (verified HOOT)", () => analyzeToken("hoot-8ecf65.launchpad.justhoot.near"));
  await run("analyze token (copycat HOOT)", () => analyzeToken("hoot-17.nearlytrade.near"));
  await run("stake (validator)", () => stake({ amount: "1", provider: "astro-stakers.poolv1.near", accountId: acct }));

  try {
    const [t, l, s, o] = await Promise.all([trendingMemes(), lendingOverview(), stakingOverview(), launchOptions()]);
    console.log(`\n✅ info: ${t.freshOnNearly.length} fresh launches · ${l.markets.length} lending markets · ${s.liquid.length} liquid-staking providers · launch pairs JustHoot ${o.justhoot.pairs.length} / nearly ${o.nearly.pairs.length}`);
    passed++;
  } catch (e) {
    console.log(`\n❌ info: ${e instanceof Error ? e.message : e}`);
    failed++;
  }
  console.log(`\n${passed} passed, ${failed} failed. Nothing was signed or sent.`);
  process.exit(failed ? 1 : 0);
})();
