// Read-only smoke test: fetches live quotes and builds (unsigned) transactions. Run: npx tsx scripts/smoke.ts [account.near]
import { bridge, memeTrade, swap, trendingMemes } from "../src/lib/actions";

const acct = process.argv[2] ?? "zavodil.near";
const show = (name: string, c: Awaited<ReturnType<typeof swap>>) => {
  console.log(`\n=== ${name}: ${c.title} [${c.venue}]`);
  for (const l of c.lines) console.log(`  ${l.label}: ${l.value}`);
  for (const w of c.warnings) console.log(`  ⚠ ${w}`);
  console.log(`  txs: ${c.transactions.map((t) => `${t.receiverId}(${t.actions.map((a) => a.params.methodName).join("+")})`).join(" → ") || "none"}`);
  console.log(`  nearSpend: ${c.nearSpend}`);
};
const run = async (name: string, f: () => Promise<Awaited<ReturnType<typeof swap>>>) => {
  try { show(name, await f()); } catch (e) { console.log(`\n=== ${name}: ERROR ${e instanceof Error ? e.message : e}`); }
};

(async () => {
  await run("intents swap", () => swap({ from: "NEAR", to: "USDC", amount: "1", accountId: acct }));
  await run("rhea swap", () => swap({ from: "NEAR", to: "USDC", amount: "1", venue: "rhea", accountId: acct }));
  await run("meme HOOT", () => memeTrade({ token: "HOOT", amount: "0.5", accountId: acct }));
  await run("meme NEARLY", () => memeTrade({ token: "nearly", amount: "0.5", accountId: acct }));
  await run("meme BLACKDRAGON", () => memeTrade({ token: "blackdragon", amount: "0.5", accountId: acct }));
  await run("sell HOOT", () => memeTrade({ token: "HOOT", side: "sell", amount: "100", accountId: acct }));
  await run("bridge out", () => bridge({ token: "USDC", amount: "5", fromChain: "near", toChain: "base", recipient: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", accountId: acct }));
  await run("bridge in (dry)", () => bridge({ token: "ETH", amount: "0.01", fromChain: "eth", toChain: "near", accountId: acct }));
  console.log("\n=== trending", JSON.stringify(await trendingMemes()).slice(0, 600));
})();
