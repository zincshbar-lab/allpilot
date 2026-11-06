// Allpilot's brain: NEAR AI Cloud (OpenAI-compatible, private inference) with tool calls.
// Without NEAR_AI_API_KEY it falls back to a small offline command parser so the app still runs.

import OpenAI from "openai";
import type { ActionCard, ChatMessage, ChatResponse } from "./cards";
import { bridge, getBalances, listBridgeChains, memeTrade, swap, trendingMemes } from "./actions";
import { pay, paymentLink } from "./pay";
import { launchToken, normalizeLaunchpad } from "./launch";
import { addLiquidity } from "./liquidity";
import { borrow, lendingOverview, repay, supply, withdrawSupply } from "./lending";
import { stake, stakingOverview, unstake, withdrawUnstaked } from "./staking";
import { analyzeToken, looksLikeAddress } from "./analyze";
import { portfolioCard } from "./portfolio";
import { resolveToken } from "./tokens";

const SYSTEM = `You are Pip, the cheerful co-pilot inside Allpilot — a cute AI trading buddy on NEAR.
You help the user:
1. swap tokens on NEAR (default venue: NEAR Intents, the engine behind near.com swaps; use venue "rhea" when they mention Ref/Rhea),
2. bridge assets between NEAR and other chains with NEAR Intents,
3. buy or sell memecoins launched on JustHoot ("hoot") and nearly.trade ("nearly"), or listed on Rhea/Ref,
4. pay anyone an exact amount on any chain, paying with whatever token they hold ("Pay with Intents"),
5. create payment links / a checkout widget so others can pay them from any wallet or chain,
6. launch a brand-new memecoin on JustHoot or nearly.trade (with a token picture the user uploads),
7. add liquidity to Rhea (Ref) classic pools,
8. lend & borrow on Rhea Lending (formerly Burrow): supply, borrow, repay, withdraw — always with the health factor,
10. show the user's portfolio — every token they hold, memes included, with live prices and USD value,
11. analyze any token contract (or wallet): launchpad, creator, creator wallet age/funder/other launches, holders, price, taxes, copycats, risk signals.
9. stake NEAR: liquid staking (LiNEAR, Rhea rNEAR, Meta Pool stNEAR — tradable, instant exit via swap) or native staking with a validator (unstake takes ~2–3 days).

Rules:
- ALWAYS use tools to get quotes. Never invent prices, amounts, contracts or addresses.
- You never sign or send anything. Tools create an action card; the user reviews it and signs with their own wallet. Say so briefly.
- If a required detail is missing (amount, token, destination address), ask one short question instead of guessing.
- Memecoins are risky. If a tool returns warnings about lookalike tokens, repeat the important one.
- Keep replies short, warm and playful (1–3 sentences, an emoji is fine). Don't repeat the numbers already shown on the card.
- Formatting: plain short lines only. **bold** and \`code\` are fine; never use tables, headings (#) or long lists — the chat bubble can't render them.
- For payments, the recipient gets EXACTLY the amount; the payer may pay in another token/chain. Always repeat the recipient so the user can double-check it. Never guess a recipient address.
- A payment link with no recipient goes to the connected wallet; if none is connected, ask who should receive.
- Token launches: you need launchpad, name and ticker. If the launchpad isn't given, ask which one, briefly comparing them:
  JustHoot = opens at a $5,000 value, ~0.06–0.1 NEAR cost, ticker 2–10 chars, description/links added on its site later;
  nearly.trade = ~0.2 NEAR cost, ticker 1–12 chars, description + website/twitter/telegram stored on-chain.
  A first buy (dev buy) is optional. If no picture is uploaded yet, tell them they can tap 📎 to add one before signing.
  Launches are permanent — make sure the name and ticker are what they want.
- Liquidity: you need two tokens and the amount of the first; the second is matched to the pool ratio. Mention impermanent loss briefly.
- Lending: supplying uses the asset as collateral by default. Before borrowing, the user needs collateral; tool errors explain health problems — relay them. Mention liquidation risk briefly when borrowing.
- Staking: if they don't say where, ask "liquid (LiNEAR / rNEAR / stNEAR — keep a tradable token, exit instantly) or a validator (native, ~2–3 day unstake)?" Use lending_info / staking_info for rates and positions instead of guessing.
- If the user pastes a contract address, or asks whether a token is safe/legit/a rug, call analyze_token. Summarize the risk signals in 1–2 lines; never call a token "safe" — say what the signals show.
- For "my balances / portfolio / holdings / what do I hold", call portfolio (needs a connected wallet).
- NEVER substitute a different token, chain, launchpad or recipient than the user asked for. If what they asked isn't possible, say so and ask what they'd like instead.
- Not financial advice. If asked what to buy, you can show trending/verified tokens but don't recommend.`;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "swap_tokens",
      description: "Quote and prepare a token swap on NEAR. Returns an action card for the user to sign.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Token to sell: symbol (NEAR, USDC) or contract id" },
          to: { type: "string", description: "Token to buy: symbol or contract id" },
          amount: { type: "string", description: "Amount of `from`, human units, e.g. '1.5'" },
          venue: { type: "string", enum: ["near-intents", "rhea", "auto"], description: "near-intents = near.com engine (default); rhea = Ref/Rhea AMM" },
          slippage_percent: { type: "number" },
        },
        required: ["from", "to", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bridge_assets",
      description: "Bridge (optionally bridge+swap) between NEAR and another chain via NEAR Intents.",
      parameters: {
        type: "object",
        properties: {
          token: { type: "string", description: "Symbol sent, e.g. USDC, ETH, NEAR, SOL, BTC" },
          amount: { type: "string" },
          from_chain: { type: "string", description: "near, eth, sol, btc, base, arb, bsc, ..." },
          to_chain: { type: "string" },
          to_token: { type: "string", description: "Optional different symbol to receive" },
          recipient: { type: "string", description: "Destination address. Defaults to the user's NEAR account when arriving on NEAR." },
          refund_to: { type: "string", description: "User's address on the origin chain (needed when origin is not NEAR)" },
        },
        required: ["token", "amount", "from_chain", "to_chain"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trade_meme",
      description: "Buy a memecoin with NEAR, or sell it back to NEAR. Works for JustHoot, nearly.trade and Rhea-listed memes.",
      parameters: {
        type: "object",
        properties: {
          token: { type: "string", description: "Meme symbol (HOOT, NEARLY, BLACKDRAGON) or contract id" },
          side: { type: "string", enum: ["buy", "sell"] },
          amount: { type: "string", description: "NEAR to spend when buying; tokens to sell when selling" },
          slippage_percent: { type: "number" },
        },
        required: ["token", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trending_memes",
      description: "List verified memecoins and the freshest nearly.trade launches.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "portfolio",
      description: "The connected wallet's full portfolio: every token held (memes included) with live price and USD value. Prefer this over get_balances.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_token",
      description: "Due-diligence report on a token contract address or symbol (or a wallet): launchpad, creator, creator wallet age & funder & number of tokens launched, holder concentration, price/market cap, taxes, copycats, risk signals.",
      parameters: { type: "object", properties: { token: { type: "string", description: "Contract address (e.g. idog.nearlytrade.near) or symbol" } }, required: ["token"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_balances",
      description: "Quick balances for a few major tokens (use portfolio for the full picture).",
      parameters: { type: "object", properties: { symbols: { type: "array", items: { type: "string" } } } },
    },
  },
  {
    type: "function",
    function: {
      name: "pay",
      description: "Pay a recipient an exact amount (they receive exactly `amount` of `token` on `to_chain`). The payer can pay with a different token or chain via NEAR Intents.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient: NEAR account (alice.near), EVM 0x address, Solana or Bitcoin address" },
          amount: { type: "string", description: "Exact amount the recipient should receive" },
          token: { type: "string", description: "Token the recipient receives, e.g. USDC" },
          to_chain: { type: "string", description: "Chain the recipient receives on. Required for 0x addresses." },
          pay_with: { type: "string", description: "Token the user pays with, if different (e.g. NEAR, ETH)" },
          pay_from_chain: { type: "string", description: "Chain the user pays from (default near)" },
          refund_to: { type: "string", description: "User's address on pay_from_chain when it isn't NEAR" },
          memo: { type: "string" },
        },
        required: ["to", "amount", "token"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_payment_link",
      description: "Create a shareable checkout link + embeddable 'Pay with Intents' widget. Anyone can pay it with any token on any chain; the receiver gets exactly the amount.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "string" },
          token: { type: "string", description: "Token to receive, e.g. USDC" },
          to: { type: "string", description: "Receiver. Omit to use the connected wallet." },
          chain: { type: "string", description: "Chain to receive on (default: from the address, NEAR for .near accounts)" },
          memo: { type: "string", description: "What the payment is for, e.g. 'Order #42'" },
        },
        required: ["amount", "token"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "launch_token",
      description: "Prepare a new memecoin launch on JustHoot or nearly.trade (the user signs). Uses the picture the user uploaded, if any.",
      parameters: {
        type: "object",
        properties: {
          launchpad: { type: "string", enum: ["justhoot", "nearly"] },
          name: { type: "string", description: "Token name, 1–32 chars" },
          symbol: { type: "string", description: "Ticker, letters/digits only" },
          description: { type: "string", description: "nearly.trade only, max 500 chars" },
          website: { type: "string" },
          twitter: { type: "string" },
          telegram: { type: "string" },
          first_buy_near: { type: "string", description: "Optional NEAR to buy at launch (dev buy)" },
        },
        required: ["launchpad", "name", "symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_liquidity",
      description: "Add liquidity to a Rhea (Ref) classic pool. The second token amount is matched to the pool ratio.",
      parameters: {
        type: "object",
        properties: {
          token_a: { type: "string", description: "First token (symbol or contract), e.g. NEAR" },
          amount_a: { type: "string", description: "Amount of token_a to deposit" },
          token_b: { type: "string", description: "Second token, e.g. USDC" },
          pool_id: { type: "number", description: "Optional specific Rhea pool id" },
        },
        required: ["token_a", "amount_a", "token_b"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lending",
      description: "Rhea Lending (Burrow): supply (lend, earns interest, used as collateral), borrow against collateral, repay a loan, or withdraw supplied tokens.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["supply", "borrow", "repay", "withdraw"] },
          token: { type: "string", description: "e.g. USDC, NEAR, USDT, ETH, LiNEAR" },
          amount: { type: "string", description: "Human amount. Omit with all=true for repay/withdraw everything." },
          all: { type: "boolean" },
          as_collateral: { type: "boolean", description: "supply only; default true" },
        },
        required: ["action", "token"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lending_info",
      description: "Rhea Lending markets (supply/borrow APRs) and the user's supplied/borrowed balances and health factor.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "stake",
      description: "Stake NEAR. provider = 'linear' | 'rnear' | 'stnear' (liquid) or a validator pool id like astro-stakers.poolv1.near (native).",
      parameters: { type: "object", properties: { amount: { type: "string" }, provider: { type: "string" } }, required: ["amount", "provider"] },
    },
  },
  {
    type: "function",
    function: {
      name: "unstake",
      description: "Unstake: liquid tokens (linear/rnear/stnear) are swapped back to NEAR instantly on Rhea; validator pools start a ~2–3 day unstake.",
      parameters: { type: "object", properties: { provider: { type: "string" }, amount: { type: "string" }, all: { type: "boolean" } }, required: ["provider"] },
    },
  },
  {
    type: "function",
    function: {
      name: "withdraw_unstaked",
      description: "Withdraw NEAR that finished unstaking from a validator pool.",
      parameters: { type: "object", properties: { validator: { type: "string" } }, required: ["validator"] },
    },
  },
  {
    type: "function",
    function: {
      name: "staking_info",
      description: "Liquid staking rates (LiNEAR, rNEAR, stNEAR), popular validators with fees, and the user's staked balances.",
      parameters: { type: "object", properties: { validators: { type: "array", items: { type: "string" } } } },
    },
  },
  {
    type: "function",
    function: {
      name: "bridge_chains",
      description: "List chains NEAR Intents supports, optionally for one token symbol.",
      parameters: { type: "object", properties: { symbol: { type: "string" } } },
    },
  },
];

type Ctx = { accountId?: string; cards: ActionCard[]; baseUrl?: string; icon?: string };

function cardSummary(c: ActionCard) {
  return {
    card_id: c.id,
    title: c.title,
    details: Object.fromEntries(c.lines.map((l) => [l.label, l.value])),
    warnings: c.warnings,
    ready_to_sign: c.transactions.length > 0 || !!c.intents?.externalDeposit,
    needs_wallet: c.needsWallet,
  };
}

async function runTool(name: string, args: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  const slip = typeof args.slippage_percent === "number" ? Math.round(args.slippage_percent * 100) : undefined;
  if (slip !== undefined && (slip < 1 || slip > 2000)) return { error: "Slippage must be between 0.01% and 20%." };
  switch (name) {
    case "swap_tokens": {
      const c = await swap({ from: String(args.from), to: String(args.to), amount: String(args.amount), venue: args.venue as never, accountId: ctx.accountId, slippageBps: slip });
      ctx.cards.push(c);
      return cardSummary(c);
    }
    case "bridge_assets": {
      const c = await bridge({
        token: String(args.token), amount: String(args.amount), fromChain: String(args.from_chain), toChain: String(args.to_chain),
        toToken: args.to_token ? String(args.to_token) : undefined, recipient: args.recipient ? String(args.recipient) : undefined,
        refundTo: args.refund_to ? String(args.refund_to) : undefined, accountId: ctx.accountId,
      });
      ctx.cards.push(c);
      return cardSummary(c);
    }
    case "trade_meme": {
      const c = await memeTrade({ token: String(args.token), side: (args.side as "buy" | "sell") ?? "buy", amount: String(args.amount), accountId: ctx.accountId, slippageBps: slip });
      ctx.cards.push(c);
      return cardSummary(c);
    }
    case "trending_memes":
      return trendingMemes();
    case "get_balances":
      if (!ctx.accountId) return { error: "Wallet not connected." };
      return getBalances(ctx.accountId, (args.symbols as string[]) ?? undefined);
    case "pay": {
      const c = await pay({
        to: String(args.to), amount: String(args.amount), token: String(args.token),
        toChain: args.to_chain ? String(args.to_chain) : undefined, payWith: args.pay_with ? String(args.pay_with) : undefined,
        payFromChain: args.pay_from_chain ? String(args.pay_from_chain) : undefined, refundTo: args.refund_to ? String(args.refund_to) : undefined,
        memo: args.memo ? String(args.memo) : undefined, accountId: ctx.accountId,
      });
      ctx.cards.push(c);
      return cardSummary(c);
    }
    case "create_payment_link": {
      const to = args.to ? String(args.to) : ctx.accountId;
      if (!to) return { error: "No receiver: connect a wallet or say who should receive the payments." };
      const c = await paymentLink({ to, amount: String(args.amount), token: String(args.token), chain: args.chain ? String(args.chain) : undefined, memo: args.memo ? String(args.memo) : undefined, baseUrl: ctx.baseUrl ?? "http://localhost:3000" });
      ctx.cards.push(c);
      return { ...cardSummary(c), url: c.checkout?.url };
    }
    case "launch_token": {
      const launchpad = normalizeLaunchpad(String(args.launchpad ?? ""));
      if (!launchpad) return { error: "Which launchpad: JustHoot or nearly.trade?" };
      const c = await launchToken({
        launchpad, name: String(args.name), symbol: String(args.symbol),
        description: args.description ? String(args.description) : undefined, website: args.website ? String(args.website) : undefined,
        twitter: args.twitter ? String(args.twitter) : undefined, telegram: args.telegram ? String(args.telegram) : undefined,
        firstBuyNear: args.first_buy_near ? String(args.first_buy_near) : undefined, icon: ctx.icon, accountId: ctx.accountId,
      });
      ctx.cards.push(c);
      return { ...cardSummary(c), picture_uploaded: !!c.icon };
    }
    case "add_liquidity": {
      const c = await addLiquidity({ tokenA: String(args.token_a), tokenB: String(args.token_b), amountA: String(args.amount_a), poolId: typeof args.pool_id === "number" ? args.pool_id : undefined, accountId: ctx.accountId });
      ctx.cards.push(c);
      return cardSummary(c);
    }
    case "portfolio": {
      if (!ctx.accountId) return { error: "Wallet not connected — ask them to connect to see their portfolio." };
      const c = await portfolioCard(ctx.accountId);
      ctx.cards.push(c);
      return { title: c.title, top: c.rows?.slice(0, 8).map((r) => `${r.symbol}: ${r.amount} = ${r.value}`), warnings: c.warnings };
    }
    case "analyze_token": {
      const q = String(args.token ?? "");
      let id = looksLikeAddress(q);
      if (!id) {
        const r = await resolveToken(q);
        if (!r.best || r.best.id === "near") return { error: `I couldn't find a token "${q}". Paste its contract address.` };
        id = r.best.id;
      }
      const c = await analyzeToken(id);
      ctx.cards.push(c);
      return { title: c.title, sections: c.sections?.map((s) => ({ [s.title]: s.lines.map((l) => `${l.label}: ${l.value}`) })) };
    }
    case "lending": {
      const a = String(args.action);
      const base = { token: String(args.token), amount: args.amount ? String(args.amount) : undefined, all: args.all === true, accountId: ctx.accountId };
      const c =
        a === "supply" ? await supply({ ...base, amount: base.amount ?? "", collateral: args.as_collateral !== false })
        : a === "borrow" ? await borrow({ ...base, amount: base.amount ?? "" })
        : a === "repay" ? await repay(base)
        : await withdrawSupply(base);
      ctx.cards.push(c);
      return cardSummary(c);
    }
    case "lending_info":
      return lendingOverview(ctx.accountId);
    case "stake": {
      const c = await stake({ amount: String(args.amount), provider: String(args.provider), accountId: ctx.accountId });
      ctx.cards.push(c);
      return cardSummary(c);
    }
    case "unstake": {
      const c = await unstake({ provider: String(args.provider), amount: args.amount ? String(args.amount) : undefined, all: args.all === true, accountId: ctx.accountId });
      ctx.cards.push(c);
      return cardSummary(c);
    }
    case "withdraw_unstaked": {
      const c = await withdrawUnstaked({ validator: String(args.validator), accountId: ctx.accountId });
      ctx.cards.push(c);
      return cardSummary(c);
    }
    case "staking_info":
      return stakingOverview(ctx.accountId, (args.validators as string[]) ?? []);
    case "bridge_chains":
      return { chains: await listBridgeChains(args.symbol ? String(args.symbol) : undefined) };
  }
  return { error: `Unknown tool ${name}` };
}

export async function chat(messages: ChatMessage[], accountId?: string, baseUrl?: string, icon?: string): Promise<ChatResponse> {
  const ctx: Ctx = { accountId, cards: [], baseUrl, icon };
  if (!process.env.NEAR_AI_API_KEY) return offline(messages, ctx);

  // Instant path: a clear trade command ("buy 0.1 near of hoot", "swap 1 near to usdc") doesn't need the
  // LLM — parse it directly and answer in ~1s. Anything chatty or ambiguous still goes to NEAR AI.
  const fast = await offline(messages, { accountId, cards: [], baseUrl, icon }, { tradesOnly: true });
  if (fast) return { ...fast, mode: "near-ai" };

  const client = new OpenAI({
    apiKey: process.env.NEAR_AI_API_KEY,
    baseURL: process.env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai/v1",
    timeout: 30_000,
    maxRetries: 1,
  });
  const model = process.env.NEAR_AI_MODEL ?? "deepseek/deepseek-v4.1-flash";
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: `${SYSTEM}\nConnected wallet: ${accountId ?? "none (ask them to connect before signing)"}.` },
    ...messages.slice(-16).map((m) => ({ role: m.role, content: m.content }) as const),
  ];

  for (let step = 0; step < 5; step++) {
    let res: OpenAI.Chat.Completions.ChatCompletion;
    try {
      res = await client.chat.completions.create({ model, messages: convo, tools, tool_choice: "auto", temperature: 0.3 });
    } catch (e) {
      // NEAR AI unavailable (no credits, outage, bad key): keep the app working with the offline parser.
      if (step > 0 && ctx.cards.length) return { reply: "Here's what I found! ✨", cards: ctx.cards, mode: "near-ai" };
      console.warn("NEAR AI call failed, using offline brain:", e instanceof Error ? e.message : e);
      return (await offline(messages, { accountId, cards: [], baseUrl, icon }))!;
    }
    const msg = res.choices[0].message;
    if (!msg.tool_calls?.length) return { reply: msg.content ?? "", cards: ctx.cards, mode: "near-ai" };
    convo.push(msg);
    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      let out: unknown;
      try {
        out = await runTool(call.function.name, JSON.parse(call.function.arguments || "{}"), ctx);
      } catch (e) {
        out = { error: e instanceof Error ? e.message : String(e) };
      }
      convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out).slice(0, 6000) });
    }
  }
  return { reply: "Here's what I found! ✨", cards: ctx.cards, mode: "near-ai" };
}

// ---------------------------------------------------------------- offline fallback

const NUM = "(\\d+(?:\\.\\d+)?)";
const TOK = "\\$?([a-z0-9._-]+)";

export async function offline(messages: ChatMessage[], ctx: Ctx): Promise<ChatResponse>;
export async function offline(messages: ChatMessage[], ctx: Ctx, opts: { tradesOnly: true }): Promise<ChatResponse | null>;
export async function offline(messages: ChatMessage[], ctx: Ctx, opts?: { tradesOnly: true }): Promise<ChatResponse | null> {
  const text = (messages.at(-1)?.content ?? "").toLowerCase().trim();
  const reply = (r: string): ChatResponse => ({ reply: r, cards: ctx.cards, mode: "offline" });
  try {
    let m: RegExpMatchArray | null;
    const rawText = messages.at(-1)?.content ?? "";
    // a bare contract address (or a NearBlocks / launchpad link) → analyze it
    const addr = looksLikeAddress(rawText);
    if (addr) {
      await runTool("analyze_token", { token: addr }, ctx);
      const isWallet = ctx.cards.at(-1)?.title.startsWith("Wallet");
      return reply(isWallet ? "That's a wallet, not a token — here's its on-chain profile 🔍" : "Here's what the chain says about it 🔍 Check the risk signals before you ape.");
    }
    // analyze / check / scan / is X safe
    if ((m = text.match(/^(?:analy[sz]e|check|scan|research|dd|inspect)\s+\$?([a-z0-9._-]+)\s*\??$/) ?? text.match(/^is\s+\$?([a-z0-9._-]+)\s+(?:safe|legit|a rug|a scam)\s*\??$/))) {
      await runTool("analyze_token", { token: m[1] }, ctx);
      return reply("Analysis ready 🔍 These are signals, not a verdict.");
    }
    // portfolio / balances / holdings
    if (/^(?:show\s+)?(?:my\s+)?(?:portfolio|balances?|holdings|wallet)\s*\??$|what do i (?:hold|have)/.test(text)) {
      if (!ctx.accountId) return reply("Connect your wallet first (top-right) and I'll show your whole portfolio 👛");
      await runTool("portfolio", {}, ctx);
      return reply("Your portfolio 👛 Memes are priced live from their pools. Tap 🔍 on any token to analyze it.");
    }
    // launch Pip Coin $PIP on hoot [with first buy 0.5 near]   (case kept from the raw message)
    if ((m = rawText.match(/(?:launch|create|deploy)\s+(?:a\s+|my\s+)?(?:new\s+)?(?:token|coin|meme(?:coin)?)?\s*(?:called|named)?\s*"?([A-Za-z0-9 ]{1,32}?)"?\s+\(?\$([A-Za-z0-9]{1,12})\)?\s+on\s+(just\s?hoot|hoot|nearly(?:\.trade)?)(?:.*?first\s+buy\s+(?:of\s+)?(\d+(?:\.\d+)?))?/i))) {
      const [, name, symbol, pad, firstBuy] = m;
      await runTool("launch_token", { launchpad: pad, name: name.trim(), symbol, first_buy_near: firstBuy }, ctx);
      return reply(`Launch card ready 🚀${ctx.icon ? "" : " Tip: tap 📎 to add a token picture, then ask again."} Check the name and ticker — launches are permanent.`);
    }
    // withdraw unstaked near from astro-stakers.poolv1.near
    if ((m = text.match(/withdraw\s+(?:my\s+)?unstaked(?:\s+near)?\s+(?:from\s+)?([a-z0-9_-]+\.(?:poolv1|pool)\.near)/))) {
      await runTool("withdraw_unstaked", { validator: m[1] }, ctx);
      return reply("Withdraw card ready 🥩 Your unlocked NEAR goes back to your wallet.");
    }
    // stake 5 near with linear | on astro-stakers.poolv1.near
    if ((m = text.match(new RegExp(`^stake\\s+${NUM}\\s*near\\s+(?:with|on|into|to|via|using)\\s+([a-z0-9._ -]+?)\\s*$`)))) {
      await runTool("stake", { amount: m[1], provider: m[2] }, ctx);
      return reply("Staking card ready 🥩 Rewards start accruing once it's staked.");
    }
    // unstake [all|2] linear | unstake 2 near from pool.poolv1.near
    if ((m = text.match(/^unstake\s+(all|\d+(?:\.\d+)?)?\s*(?:near\s+)?(?:my\s+)?(?:from\s+)?([a-z0-9._-]+)\s*$/))) {
      const [, amt, prov] = m;
      await runTool("unstake", { provider: prov, amount: amt && amt !== "all" ? amt : undefined, all: !amt || amt === "all" }, ctx);
      return reply("Unstake card ready 🥩");
    }
    // supply|lend 10 usdc   ·   borrow 5 usdc   ·   repay all usdc   ·   withdraw all usdc from lending
    if ((m = text.match(new RegExp(`^(?:supply|lend)\\s+${NUM}\\s+${TOK}`)))) {
      await runTool("lending", { action: "supply", amount: m[1], token: m[2] }, ctx);
      return reply("Supply card ready 🏦 It earns interest and counts as collateral.");
    }
    if ((m = text.match(new RegExp(`^borrow\\s+${NUM}\\s+${TOK}`)))) {
      await runTool("lending", { action: "borrow", amount: m[1], token: m[2] }, ctx);
      return reply("Borrow card ready 🏦 Keep an eye on your health factor — below 1.0 means liquidation.");
    }
    if ((m = text.match(new RegExp(`^repay\\s+(?:(all|${NUM.slice(1, -1)})\\s+)?(?:my\\s+)?${TOK}`)))) {
      const amt = m[1];
      await runTool("lending", { action: "repay", token: m[2], amount: amt && amt !== "all" ? amt : undefined, all: !amt || amt === "all" }, ctx);
      return reply("Repay card ready 🏦");
    }
    if ((m = text.match(new RegExp(`^withdraw\\s+(all|${NUM.slice(1, -1)})\\s+${TOK}\\s+from\\s+(?:rhea\\s+)?(?:lending|burrow)`)))) {
      await runTool("lending", { action: "withdraw", token: m[2], amount: m[1] !== "all" ? m[1] : undefined, all: m[1] === "all" }, ctx);
      return reply("Withdraw card ready 🏦");
    }
    // add lp 1 near and usdc [on ref]   |   add liquidity 1 near + usdc
    if ((m = text.match(new RegExp(`add\\s+(?:lp|liquidity)\\s+(?:with\\s+|of\\s+)?${NUM}\\s+${TOK}\\s+(?:and|\\+|with|/)\\s+${TOK}`)))) {
      await runTool("add_liquidity", { amount_a: m[1], token_a: m[2], token_b: m[3] }, ctx);
      return reply("Liquidity card ready 💧 The second token is matched to the pool's ratio. Sign the steps in order.");
    }
    // payment link 5 usdc [to alice.near] [on base] [for order 42]
    if ((m = text.match(new RegExp(`(?:payment|pay|checkout|invoice)\\s+link\\s+(?:for\\s+)?${NUM}\\s+${TOK}(?:\\s+to\\s+([^\\s]+))?(?:\\s+on\\s+([a-z]+))?(?:\\s+for\\s+(.+))?$`)))) {
      const [, amount, token, to, chain, memo] = m;
      const out = await runTool("create_payment_link", { amount, token, to, chain, memo: memo ? (messages.at(-1)?.content ?? "").slice(-memo.length) : undefined }, ctx);
      if ((out as { error?: string }).error) return reply((out as { error: string }).error);
      return reply("Your checkout link is ready 🔗 Anyone can pay it with any token on any chain — you get exactly that amount.");
    }
    // pay alice.near 10 usdc [with near] [on base]   |   pay/send 10 usdc to alice.near [with eth]
    if (
      (m = text.match(new RegExp(`(?:pay|send|tip)\\s+${NUM}\\s+${TOK}\\s+to\\s+([^\\s]+)(?:\\s+on\\s+([a-z]+))?(?:\\s+(?:with|using)\\s+${TOK})?`))) ||
      (m = text.match(new RegExp(`(?:pay|tip)\\s+([^\\s]+\\.near|0x[0-9a-f]{40}|[0-9a-f]{64})\\s+${NUM}\\s+${TOK}(?:\\s+on\\s+([a-z]+))?(?:\\s+(?:with|using)\\s+${TOK})?`)))
    ) {
      const named = /^\d/.test(m[1]) ? { amount: m[1], token: m[2], to: m[3] } : { to: m[1], amount: m[2], token: m[3] };
      const raw = messages.at(-1)?.content ?? "";
      const to = raw.match(new RegExp(named.to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))?.[0] ?? named.to; // keep address case (EVM checksums)
      await runTool("pay", { to, amount: named.amount, token: named.token, to_chain: m[4], pay_with: m[5] }, ctx);
      return reply(`Payment card ready 💌 Double-check the recipient (${to}) before you sign.`);
    }
    // bridge 10 usdc from near to eth 0xabc…   |   bridge 0.01 eth from eth to near refund 0x…
    if ((m = text.match(new RegExp(`bridge\\s+${NUM}\\s+${TOK}(?:\\s+from\\s+([a-z]+))?\\s+to\\s+([a-z]+)(?:\\s+(?:address\\s+)?([^\\s]+))?(?:.*refund(?:\\s+to)?\\s+([^\\s]+))?`)))) {
      const [, amount, token, from = "near", to, addr, refund] = m;
      const toNear = to === "near";
      await runTool("bridge_assets", { amount, token, from_chain: from, to_chain: to, recipient: toNear ? undefined : addr, refund_to: refund ?? (toNear ? addr : undefined) }, ctx);
      return reply("Bridge quote ready via NEAR Intents 🌉 Check the card, then sign with your wallet.");
    }
    // buy 0.5 near of hoot  |  buy hoot with 0.5 near  |  ape 1 near into nearly
    if ((m = text.match(new RegExp(`(?:buy|ape)\\s+${NUM}\\s*near\\s+(?:of|into|worth of)?\\s*${TOK}`))) || (m = text.match(new RegExp(`(?:buy|ape)\\s+${TOK}\\s+with\\s+${NUM}\\s*near`)))) {
      const [amount, token] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
      await runTool("trade_meme", { token, amount, side: "buy" }, ctx);
      return reply("Meme snack incoming 🦉 Review the card — memecoins are spicy, so only spend what you're happy to lose.");
    }
    // sell 1000 hoot
    if ((m = text.match(new RegExp(`sell\\s+${NUM}\\s+${TOK}`)))) {
      await runTool("trade_meme", { token: m[2], amount: m[1], side: "sell" }, ctx);
      return reply("Sell quote ready. Sign it when you're happy 💸");
    }
    // swap 1 near to usdc (on ref)
    if ((m = text.match(new RegExp(`(?:swap|trade|convert|exchange)\\s+${NUM}\\s+${TOK}\\s+(?:to|for|into)\\s+${TOK}`)))) {
      const venue = /\b(ref|rhea)\b/.test(text) ? "rhea" : "near-intents";
      await runTool("swap_tokens", { amount: m[1], from: m[2], to: m[3], venue }, ctx);
      return reply(`Swap quote via ${venue === "rhea" ? "Rhea (Ref)" : "NEAR Intents"} ready 🎀`);
    }
    if (opts?.tradesOnly) return null; // not a clear trade command: let the LLM handle it
    if (/trend|hot memes|what.*meme|new launch/.test(text)) {
      const t = await trendingMemes();
      return reply(
        `Verified memes: ${t.verified.map((v) => `$${v.symbol}`).join(", ")}.\nFresh on nearly.trade: ${t.freshOnNearly.map((f) => `$${f.symbol} (${f.ageMin}m old)`).join(", ") || "nothing new"}.\nSay "buy 0.1 near of HOOT" to try one.`,
      );
    }
    if (/balance|portfolio|wallet/.test(text)) {
      if (!ctx.accountId) return reply("Connect your wallet first (top-right) and I'll peek at your balances 👛");
      const b = await getBalances(ctx.accountId);
      return reply(b.map((x) => `${x.symbol}: ${x.amount}`).join(" · ") || "No balances found.");
    }
    return reply(
      `I'm in offline mode (no NEAR AI key set), so I understand simple commands:\n• swap 1 near to usdc\n• swap 5 usdc to near on ref\n• buy 0.2 near of hoot\n• sell 1000 nearly\n• bridge 5 usdc from near to base 0xYourAddress\n• pay alice.near 5 usdc (add "with near" to pay in NEAR)\n• payment link 10 usdc for order 42\n• launch Pip Coin $PIP on hoot (tap 📎 to add a picture)\n• add lp 1 near and usdc\n• supply 10 usdc · borrow 5 usdc · repay all usdc\n• stake 5 near with linear · unstake all linear\n• my portfolio · paste any token address to analyze it\n• trending memes · balance`,
    );
  } catch (e) {
    if (opts?.tradesOnly) return null; // let the LLM explain or recover
    return reply(`Oops 🙈 ${e instanceof Error ? e.message : String(e)}`);
  }
}
