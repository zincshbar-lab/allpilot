// Allpilot's brain: NEAR AI Cloud (OpenAI-compatible, private inference) with tool calls.
// Without NEAR_AI_API_KEY it falls back to a small offline command parser so the app still runs.

import OpenAI from "openai";
import type { ActionCard, ChatMessage, ChatResponse } from "./cards";
import { bridge, getBalances, listBridgeChains, memeTrade, swap, trendingMemes } from "./actions";

const SYSTEM = `You are Pip, the cheerful co-pilot inside Allpilot — a cute AI trading buddy on NEAR.
You help the user:
1. swap tokens on NEAR (default venue: NEAR Intents, the engine behind near.com swaps; use venue "rhea" when they mention Ref/Rhea),
2. bridge assets between NEAR and other chains with NEAR Intents,
3. buy or sell memecoins launched on JustHoot ("hoot") and nearly.trade ("nearly"), or listed on Rhea/Ref.

Rules:
- ALWAYS use tools to get quotes. Never invent prices, amounts, contracts or addresses.
- You never sign or send anything. Tools create an action card; the user reviews it and signs with their own wallet. Say so briefly.
- If a required detail is missing (amount, token, destination address), ask one short question instead of guessing.
- Memecoins are risky. If a tool returns warnings about lookalike tokens, repeat the important one.
- Keep replies short, warm and playful (1–3 sentences, an emoji is fine). Don't repeat the numbers already shown on the card.
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
      name: "get_balances",
      description: "Show the connected user's balances.",
      parameters: { type: "object", properties: { symbols: { type: "array", items: { type: "string" } } } },
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

type Ctx = { accountId?: string; cards: ActionCard[] };

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
    case "bridge_chains":
      return { chains: await listBridgeChains(args.symbol ? String(args.symbol) : undefined) };
  }
  return { error: `Unknown tool ${name}` };
}

export async function chat(messages: ChatMessage[], accountId?: string): Promise<ChatResponse> {
  const ctx: Ctx = { accountId, cards: [] };
  if (!process.env.NEAR_AI_API_KEY) return offline(messages, ctx);

  const client = new OpenAI({ apiKey: process.env.NEAR_AI_API_KEY, baseURL: process.env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai/v1" });
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
      return offline(messages, { accountId, cards: [] });
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

export async function offline(messages: ChatMessage[], ctx: Ctx): Promise<ChatResponse> {
  const text = (messages.at(-1)?.content ?? "").toLowerCase().trim();
  const reply = (r: string): ChatResponse => ({ reply: r, cards: ctx.cards, mode: "offline" });
  try {
    let m: RegExpMatchArray | null;
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
      `I'm in offline mode (no NEAR AI key set), so I understand simple commands:\n• swap 1 near to usdc\n• swap 5 usdc to near on ref\n• buy 0.2 near of hoot\n• sell 1000 nearly\n• bridge 5 usdc from near to base 0xYourAddress\n• trending memes · balance`,
    );
  } catch (e) {
    return reply(`Oops 🙈 ${e instanceof Error ? e.message : String(e)}`);
  }
}
