# Allpilot 🦉✈️ — a cute AI co-pilot for NEAR

> Built at **NEAR HACKATHON** (Nov 2026). Tracks: **Unstoppable DeFi** (`defi`), **Agent Economy** (`agents`), **AI Security & Defense** (`security`), **Privacy & Private AI** (`privacy`).

## The problem

Doing things on NEAR means juggling different apps: near.com / NEAR Intents for swaps and bridges, Rhea (Ref) for AMM trades, and launchpads like JustHoot and nearly.trade for memecoins. Each one has its own UI, token lists full of copycat contracts, and different transaction formats.

## What Allpilot does

You chat with **Pip** in plain words. Pip fetches live quotes and turns your request into an **action card**: a fully built transaction that **your own wallet** signs. Pip never holds keys.

| You say | What happens | Venue |
| --- | --- | --- |
| `swap 1 near to usdc` | Quote + deposit address from NEAR Intents 1Click; wrap → `ft_transfer` to the deposit address | NEAR Intents (the near.com swap engine) |
| `swap 2 usdc to near on ref` | Best route from the Rhea smart router; one `ft_transfer_call` to `v2.ref-finance.near` | Rhea / Ref |
| `bridge 5 usdc from near to base 0xYourAddr` | Cross-chain quote; sign one tx on NEAR, funds arrive on Base | NEAR Intents |
| `bridge 0.01 eth from ethereum to near refund 0xYourAddr` | You get a deposit address to send ETH to from your EVM wallet; Allpilot tracks the status | NEAR Intents |
| `buy 0.1 near of hoot` | Finds the verified HOOT contract, quotes its Rhea DCL pool, wraps and swaps in one tx | JustHoot → Rhea DCL |
| `buy 0.1 near of nearly` | Same for nearly.trade tokens (direct or 2-hop pools) | nearly.trade → Rhea DCL |
| `sell 100 hoot` | Sells back to native NEAR | Rhea DCL |
| `trending memes` | Verified memes + freshest nearly.trade launches (read on-chain from `nearlytrade.near`) | — |

### How NEAR fits in

- **NEAR Intents (1Click API)** does swaps and cross-chain bridging (BTC, ETH, SOL, Base, Arbitrum and 20+ chains) with no custodian. It's the same engine near.com uses.
- **Rhea DCL** (`dclv2.ref-labs.near`): JustHoot (`*.justhoot.near`) and nearly.trade (`*.nearlytrade.near`) launch every memecoin as one-sided liquidity in a DCL pool. Allpilot reads `list_pools` / `quote` directly from the contract, so any new launch is buyable right away.
- **Rhea classic AMM** (`v2.ref-finance.near`) via the public smart router.
- **NEAR AI Cloud** (OpenAI-compatible, private inference) is the chat brain, with tool calling.
- **HOT's NEAR Connect** handles wallet connection: HOT, Meteor, Intear, Ledger, MyNearWallet, OKX, NEAR Mobile, Trezu, Nightly, Hana, Ethereum wallets (MetaMask etc. via EVM-on-NEAR) and NEAR CLI. The wallet list ships with the app (`src/lib/wallet-manifest.json`) as a fallback, so the picker is never empty if GitHub is slow or blocked.

### 🛡️ Pilot Guard (agent safety)

The AI only proposes. Before any wallet prompt, the browser checks every proposed transaction against rules the user controls, which the model can't change:

- spend limits per action (NEAR attached and USD value, editable in the UI)
- method allowlist: `near_deposit`, `storage_deposit`, `ft_transfer_call`, `ft_transfer`
- `ft_transfer_call` may only target known DEX contracts (`v2.ref-finance.near`, `dclv2.ref-labs.near`)
- plain `ft_transfer` may only go to the 1Click deposit address from that quote
- storage deposits capped at 0.01 NEAR and only for you or the deposit address
- expired quotes can't be signed

It also catches **copycat tokens**. NEAR symbols aren't unique (we found 15+ fake "HOOT" contracts). Allpilot pins verified contracts, ranks the rest by real wNEAR volume through their pool, and warns on every card where lookalikes exist.

## Try it (judges: start here)

Requirements: Node 20+.

```bash
npm install
cp .env.example .env.local   # optional: add NEAR_AI_API_KEY for full natural-language chat
npm run dev
```

Open http://localhost:3000, then:

1. Click **🦉 Buy HOOT**. You should see a card with the verified contract `hoot-8ecf65.launchpad.justhoot.near`, a live Rhea DCL quote, and a warning about lookalike tokens.
2. Click **🔄 Swap 1 NEAR → USDC**. You should see a NEAR Intents quote (est. output, minimum, ~time).
3. Type `bridge 5 usdc from near to base 0x2527D02599Ba641c19FEa793cD0F167589a0f10D`. You should see a bridge card with the recipient filled in.
4. Click **Connect wallet**, then repeat any request. The card now has **Sign with wallet (n tx)** and a green **Pilot Guard** line.
5. Open **🛡️ Guard**, set *Max NEAR per action* to `0.05`, and ask for `buy 0.1 near of hoot`. The Guard turns red and blocks signing.

**Without `NEAR_AI_API_KEY`** the app runs in *offline brain* mode: a small command parser that handles all the commands above, so everything stays reproducible. **With a key** (get one at https://cloud.near.ai), Pip understands free-form chat and calls the same tools.

Read-only smoke test (live mainnet quotes, builds unsigned transactions, signs nothing):

```bash
npx tsx scripts/smoke.ts some-account.near
```

## Architecture

```
src/
  app/api/chat           POST: chat → agent → action cards
  app/api/intents-status POST: 1Click status (+ optional deposit tx submit)
  app/api/trending       POST: verified memes + fresh nearly.trade launches
  lib/agent.ts           NEAR AI Cloud tool-calling loop + offline parser
  lib/actions.ts         swap / bridge / memeTrade / trending → ActionCard
  lib/intents.ts         NEAR Intents 1Click client
  lib/rhea.ts            Rhea smart router + v2.ref-finance.near tx builder
  lib/dcl.ts             Rhea DCL pool index, quotes, swap tx builder
  lib/tokens.ts          symbol → contract resolver, verified list, copycat ranking
  lib/guard.ts           Pilot Guard (runs client-side before signing)
  components/            App, ActionCardView, Pip mascot, useWallet (NEAR Connect)
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `NEAR_AI_API_KEY` | — | NEAR AI Cloud key. Leave unset for offline mode. |
| `NEAR_AI_MODEL` | `deepseek/deepseek-v4.1-flash` | Any tool-calling model on NEAR AI Cloud |
| `NEAR_AI_BASE_URL` | `https://cloud-api.near.ai/v1` | |
| `ONECLICK_JWT` | — | 1Click partner JWT (removes the 0.2% fee, rule Q-006) |
| `NEAR_RPC_URLS` | fastnear, shitzuapes, drpc | Comma-separated mainnet RPCs |

## Hackathon compliance notes

- **Built in the window**: all code was written during NEAR HACKATHON (after the 2026-10-19 announcement). There was no earlier code.
- **Libraries / boilerplate (Q-005)**: `create-next-app` (Next.js 16, React 19, Tailwind 4), `@hot-labs/near-connect`, `openai` SDK (pointed at NEAR AI Cloud), `zod`. Written with help from AI coding assistants (Claude Code).
- **Mainnet (Q-007)**: NEAR Intents has no testnet, so Allpilot runs on mainnet. Test with a separate dev account and tiny amounts. Quotes without a wallet are `dry: true`.
- **Secrets**: keys live only in `.env.local` (git-ignored). Nothing is committed.
- **License**: MIT (see `LICENSE`).
- **Other projects by the author**: none.

## Disclaimer

Experimental hackathon software on mainnet. Memecoins can go to zero. Not financial advice.
