# Allpilot 🦉✈️ — a cute AI co-pilot for NEAR

> Built at **NEAR HACKATHON** (Nov 2026). Tracks: **Unstoppable DeFi** (`defi`), **Real-World Money** (`realworld`), **Memecoins With Mechanics** (`memecoins`), **Agent Economy** (`agents`), **AI Security & Defense** (`security`), **Privacy & Private AI** (`privacy`).

**🌐 Live demo: https://allpilot.vercel.app** (mainnet, NEAR AI brain on) · Checkout example: [pay 1 USDC](https://allpilot.vercel.app/pay?to=intents.near&amount=1&token=USDC&chain=near&memo=Demo)

## The problem

Doing things on NEAR means juggling many apps: near.com / NEAR Intents for swaps and bridges, Rhea (Ref) for trading and liquidity, Rhea Lending for borrowing, separate sites for staking, and launchpads like JustHoot and nearly.trade for memecoins. Each has its own UI, token lists full of copycat contracts, and different transaction formats. Paying someone across chains, or getting paid by a customer who holds a different token, is even harder. Meanwhile anyone can launch a token in seconds, so it's hard to tell a real meme from a copycat or a serial rugger, and normal wallets don't even show what your memes are worth. And handing all of that to an AI is scary unless something stops it from doing the wrong thing.

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
| `my portfolio` | Every token you hold, memes included, with a real USD price and value (🔍 on any row analyzes it) | FastNEAR + Rhea prices + live DCL pool quotes |
| paste `idog.nearlytrade.near` (or a NearBlocks / launchpad link, or `analyze hoot`, `is X safe?`) | Token due-diligence report: launchpad, creator, creator wallet age / funder / tokens launched, holders, price, taxes, copycats, risk signals | FastNEAR tx history + on-chain views |
| `pay alice.near 5 usdc` | Same token on NEAR: one direct `ft_transfer` to the recipient, no fee | Direct |
| `pay alice.near 5 usdc with near` | Recipient gets **exactly** 5 USDC; you pay in NEAR (exact-output quote) | NEAR Intents |
| `send 5 usdc to 0xAbc… on base` | Pay someone on another chain from your NEAR wallet | NEAR Intents |
| `payment link 10 usdc for Order 42` | Shareable checkout link + embeddable widget + "Pay with Intents" button | NEAR Intents |
| 📎 + `launch Pip Coin $PIP on hoot` | Launches a new memecoin with your uploaded picture: token + Rhea DCL pool in one tx | JustHoot `launch_meme` |
| 📎 + `launch Owl $OWL on nearly with first buy 0.2 near` | Same on nearly.trade, with description/links on-chain and an optional first buy | nearly.trade `launch` |
| `add lp 1 near and usdc` | Picks the deepest classic pool, matches the pool ratio, then register → deposit → `add_liquidity` | Rhea / Ref |
| `supply 10 usdc` | Lends USDC (earns the supply APR) and uses it as collateral; shows your health factor | Rhea Lending |
| `borrow 5 usdc` | Borrows against your collateral via `execute_with_pyth`; refuses anything that would leave health < 1.05 | Rhea Lending |
| `repay all usdc` · `withdraw all usdc from lending` | Repays debt from your wallet (with a tiny interest buffer) or withdraws supplied tokens, health-checked | Rhea Lending |
| `stake 5 near with linear` (or `rnear`, `stnear`) | Liquid staking via `deposit_and_stake`; shows the live share price and tokens you'll get | LiNEAR / Rhea rNEAR / Meta Pool |
| `stake 3 near on astro-stakers.poolv1.near` | Native staking with a validator (fee shown, high fees flagged) | Validator pool |
| `unstake all linear` · `unstake 1 near from <pool>` | Liquid: instant swap back to NEAR on Rhea (spread vs fair value shown). Native: `unstake`, then `withdraw my unstaked near from <pool>` after ~2–3 days | Rhea / validator |

### How NEAR fits in

- **NEAR Intents (1Click API)** does swaps and cross-chain bridging (BTC, ETH, SOL, Base, Arbitrum and 20+ chains) with no custodian. It's the same engine near.com uses.
- **Rhea DCL** (`dclv2.ref-labs.near`): JustHoot (`*.justhoot.near`) and nearly.trade (`*.nearlytrade.near`) launch every memecoin as one-sided liquidity in a DCL pool. Allpilot reads `list_pools` / `quote` directly from the contract, so any new launch is buyable right away.
- **Rhea classic AMM** (`v2.ref-finance.near`) via the public smart router for swaps, and `register_tokens` → deposit → `add_liquidity` for providing liquidity.
- **Launchpad factories**: `v2-launchpad.justhoot.near` (`launch_meme`) and `nearlytrade.near` (`launch`), each minting a NEP-141 token and opening its Rhea DCL pool in one transaction, priced live with `get_launch_deposit` / `quote_launch`.
- **Rhea Lending** (`contract.main.burrow.near`, formerly Burrow): supply / borrow / repay / withdraw through `ft_transfer_call` and `execute_with_pyth`.
- **Staking**: liquid staking with LiNEAR (`linear-protocol.near`), Rhea rNEAR (`lst.rhealab.near`) and Meta Pool stNEAR (`meta-pool.near`), and native staking with any `*.poolv1.near` validator.
- **FastNEAR public APIs** provide what a wallet holds, top holders per token, and full transaction history. The token analyzer uses them to find each token's launch transaction, its creator, and the creator's own first transaction (wallet age and funder). This is the **scam-detection** side of the AI Security & Defense track.
- **NEAR AI Cloud** (OpenAI-compatible, private inference) is the chat brain, with tool calling. Clear commands (`buy …`, `swap …`, `pay …`, `launch … on …`, `add lp …`, `supply …`, `borrow …`, `stake … with …`, a pasted address, `my portfolio`) take an instant path that skips the LLM (~1 s). Every network call has a timeout, and if NEAR AI is unavailable Pip falls back to the command parser.
- **HOT's NEAR Connect** handles wallet connection: HOT, Meteor, Intear, Ledger, MyNearWallet, OKX, NEAR Mobile, Trezu, Nightly, Hana, Ethereum wallets (MetaMask etc. via EVM-on-NEAR) and NEAR CLI. The wallet list ships with the app (`src/lib/wallet-manifest.json`) as a fallback, so the picker is never empty if GitHub is slow or blocked.

### 💌 Pay with Intents (universal checkout)

A merchant (or friend) asks for an **exact amount of one token on one chain**: "10 USDC to shop.near". The payer pays with **whatever they hold, on whatever chain**.

1. **Make a link.** Tell Pip `payment link 10 usdc for Order 42`. You get a `/pay?to=…&amount=…&token=…&chain=…&memo=…` URL, an `<iframe>` widget and a "Pay with Intents" button snippet to paste on any website.
2. **Payer opens it** and picks a chain + token (NEAR, USDC, ETH on Base, SOL, BTC… anything NEAR Intents supports).
3. **Allpilot asks NEAR Intents 1Click for an `EXACT_OUTPUT` quote.** The output is fixed, so the payee gets exactly 10 USDC. The slippage buffer sits on the payer's side and anything unused is refunded.
4. **Paying from NEAR:** the payer's wallet signs one tx (wrap if needed, then transfer to the 1Click deposit address). **Paying from another chain:** the page shows a deposit address and exact amount to send from their own wallet (MetaMask, Phantom, a BTC wallet…), then tracks status live.
5. **Solvers settle it** through NEAR Intents and deliver the token to the payee. No custodian, no bridge UI, no account on our side.

Same token on NEAR (`pay alice.near 5 usdc`) skips Intents entirely: it's a direct transfer with no fee. Recipients are checked before quoting: NEAR accounts must exist, EVM addresses must be well-formed, and Pip always repeats the recipient.

### 🚀 Launch a memecoin (with a picture)

Tap **📎** to pick any image. It's center-cropped and shrunk **in your browser** to a ~2–7 KB WebP data URL, small enough for both launchpads' on-chain limits (JustHoot ~7 KB, nearly.trade 16 KB). Then say e.g. `launch Pip Coin $PIP on hoot`. If you don't say where, Pip asks and compares the two launchpads:

| | JustHoot | nearly.trade |
| --- | --- | --- |
| Contract / method | `v2-launchpad.justhoot.near` · `launch_meme({args})` | `nearlytrade.near` · `launch({args})` |
| Cost (live quote) | `get_launch_deposit` (~0.06–0.1 NEAR) | `quote_launch` (~0.09–0.2 NEAR) |
| Ticker | 2–10 letters/digits | 1–12 letters/digits |
| Description & links | off-chain, added on justhoot.fun | stored on-chain |
| Opens at | $5,000 FDV, NEAR pair | NEAR pair |

Both mint a fixed 1B supply and open a Rhea DCL pool in the same transaction. An optional **first buy** is attached in NEAR, and unused deposit is refunded by the factory. The launch formats come from nearly.trade's verified contract source and fastnear's open-source near.fm adapters.

### 💧 Add liquidity on Rhea (Ref)

`add lp 1 near and usdc` finds the deepest **classic** pool for the pair (Rhea's top-pools API, falling back to scanning `get_pools`). It reads live reserves, matches the second amount to the pool ratio, checks your balances, and builds: `storage_deposit` (first time) + `register_tokens` → `ft_transfer_call` of each token to `v2.ref-finance.near` (wrapping NEAR first) → `add_liquidity`. Anything the pool doesn't take stays in your Rhea balance. Pip warns about impermanent loss.

### 🏦 Lend & borrow (Rhea Lending, formerly Burrow)

`contract.main.burrow.near`, with call formats from Burrow's official SDK:
- **Supply:** `ft_transfer_call` with `{"Execute":{"actions":[{"IncreaseCollateral":…}]}}`. Native NEAR is wrapped first, and a first-time user gets the 0.1 NEAR (refundable) account storage deposit.
- **Borrow:** `execute_with_pyth({actions:[Borrow, Withdraw]})`. The protocol has switched to the Pyth oracle path, and wNEAR is unwrapped back to NEAR.
- **Repay:** `ft_transfer_call` with a `Repay` action.
- **Withdraw:** `DecreaseCollateral` + `Withdraw` via `execute_with_pyth`.

Action amounts use each market's inner decimals (token decimals + `extra_decimals`). Before building a borrow or withdraw, Pip computes your **health factor** the way the protocol does: Σ collateral × volatility ÷ Σ debt ÷ volatility, using Rhea prices. It refuses anything that would end below 1.05 and warns below 1.5. `lending_info` lists all live markets with supply/borrow APRs and your positions.

### 🥩 Stake NEAR

- **Liquid staking:** LiNEAR (`linear-protocol.near`), Rhea rNEAR (`lst.rhealab.near`) or Meta Pool stNEAR (`meta-pool.near`) via `deposit_and_stake`. You get a tradable token at the live share price (e.g. 1 LiNEAR ≈ 1.43 NEAR). To exit instantly, Pip swaps it back on Rhea and shows the spread vs. its staked value.
- **Native staking:** any `*.poolv1.near` / `*.pool.near` validator, showing its fee (warns above 20%). `unstake` / `unstake_all` start a ~4-epoch (≈2–3 days) unlock, then `withdraw_all`.

If you just say "stake 10 near", Pip asks liquid or validator. `staking_info` shows rates, popular validators and your staked balances.

### 👛 Portfolio with real meme prices

`my portfolio` (or the **Portfolio** pill) lists **every token the wallet holds**, from FastNEAR's `/v1/account/{id}/ft`, plus native NEAR. Each is priced in USD: first from Rhea's price list, and for fresh launchpad memes Rhea doesn't price, **live from their own pool** by quoting a sale of 1 token into wNEAR on Rhea DCL. Rows are sorted by value and tagged with their launchpad (JustHoot, nearly.trade, meme.cooking, tkn.near, NearPad…) or "verified". Dust under $0.01 is hidden, and tokens with no market are counted as $0 and flagged. Tap 🔍 on any row to analyze it.

### 🔍 Token analysis (paste any contract address)

Send just an address (`oyster.v2-launchpad.justhoot.near`), a NearBlocks / justhoot.fun / nearly.trade link, `analyze <symbol>` or `is <token> safe?`, and Pip builds a report:

| Section | What's in it | Where it comes from |
| --- | --- | --- |
| 🪙 Token | name, supply, creation date & age, tx count, **tax** | `ft_metadata`, `ft_total_supply`, first tx via FastNEAR; JustHoot `get_config.transfer_fee_pips`, nearly.trade `get_tax` |
| 🚀 Launchpad | which launchpad (JustHoot v1/v2, nearly.trade, meme.cooking, Rhea meme launchpad, tkn.near, NearPad, Shore Markets, token0, PrismPad, NearPaid, aidols, gra.fun… **or "unknown factory: X"**), the launch call, whether Allpilot can trade it, creator's first buy | token account suffix + the launch transaction |
| 👤 Creator | creator wallet, **wallet age**, **funder / who created it** (e.g. a wallet relayer), activity, NEAR balance, **number of tokens launched** (exact on nearly.trade, else from their last 100 signed txs), how much of this token they still hold | the token's first transaction signer (or the launchpad's own record) → the creator's first transaction |
| 👥 Holders | top-10 concentration (pools, Intents, DAOs excluded), largest wallet, % sitting in Rhea pools, holder count | FastNEAR `/v1/ft/{id}/top` |
| 📈 Market | live price, market cap (FDV), all-time wNEAR volume | Rhea prices / DCL quote, DCL pool stats |
| 🚦 Risk signals | 🟢/🟡/🔴 lines + overall low/medium/high: copycat of a verified symbol, fresh creator wallet (<7 days), serial launcher (≥5 tokens), creator holds >10%, creator dumped their first buy, top-10 >25/50%, few holders, brand new, tax, no market, unknown factory | all of the above |

If the address is a wallet rather than a token, you get a wallet profile instead (age, funder, activity, tokens launched). It's always framed as signals, not a verdict.

### 🧠 Pip's tools (what the AI can call)

The LLM never builds transactions itself. It calls these server-side tools (`src/lib/agent.ts`), and each one returns an **action card** with live numbers, warnings and unsigned transactions:

| Tool | Does |
| --- | --- |
| `swap_tokens` | Swap on NEAR Intents (default) or Rhea |
| `bridge_assets` · `bridge_chains` | Bridge between NEAR and 20+ chains; list supported chains |
| `trade_meme` · `trending_memes` | Buy/sell memecoins (JustHoot, nearly.trade, Rhea); verified + fresh launches |
| `pay` · `create_payment_link` | Exact-amount payments to any chain; checkout links + widget |
| `launch_token` | Launch a memecoin on JustHoot or nearly.trade (with uploaded picture) |
| `add_liquidity` | Add liquidity to a Rhea classic pool |
| `lending` · `lending_info` | Supply / borrow / repay / withdraw on Rhea Lending; markets, positions, health |
| `stake` · `unstake` · `withdraw_unstaked` · `staking_info` | Liquid & validator staking; rates and your stakes |
| `portfolio` · `get_balances` | Full portfolio with live prices (memes included); quick major-token balances |
| `analyze_token` | Due-diligence report on a token contract (or wallet profile) |

The system prompt makes Pip ask instead of guessing (launchpad, staking type, recipient), never substitute a different token, chain or recipient than the one asked for, and never give financial advice.

### 🛡️ Pilot Guard (agent safety)

The AI only proposes. Before any wallet prompt, the browser checks every proposed transaction against rules the user controls, which the model can't change:

- spend limits per action (NEAR attached and USD value, editable in the UI)
- method allowlist: `near_deposit`, `storage_deposit`, `ft_transfer_call`, `ft_transfer`
- `ft_transfer_call` may only target known DEX contracts (`v2.ref-finance.near`, `dclv2.ref-labs.near`)
- plain `ft_transfer` (and native NEAR transfers) may only go to the 1Click deposit address from that quote, or to the payee the user named in a payment
- storage deposits capped at 0.01 NEAR and only for you or the deposit address
- lending cards may only call `execute_with_pyth` on `contract.main.burrow.near`, send tokens to it, and pay its 0.1 NEAR account storage; staking cards may only call `deposit_and_stake` / `unstake` / `unstake_all` / `withdraw_all` on the three liquid-staking contracts or validator pools
- `launch_meme` / `launch` are only allowed on launch cards and only on the two launchpad factories; `register_tokens` / `add_liquidity` only on liquidity cards and only on `v2.ref-finance.near`
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

0. Under Pip's welcome message you'll see quick-action pills (**Launch a token**, **Portfolio**, **Earn yield**, **Swap**, **Pay a friend**, **More**). Click **More** to reveal the rest.
1. Click **More → Buy HOOT**. You should see a card with the verified contract `hoot-8ecf65.launchpad.justhoot.near`, a live Rhea DCL quote, and a warning about lookalike tokens.
2. Click the **Swap** pill (sends `swap 1 near to usdc`). You should see a NEAR Intents quote (est. output, minimum, ~time).
3. Type `bridge 5 usdc from near to base 0x2527D02599Ba641c19FEa793cD0F167589a0f10D`. You should see a bridge card with the recipient filled in.
4. Click **Connect wallet**, then repeat any request. The card now has **Sign with wallet (n tx)** and a green **Pilot Guard** line.
5. Open **🛡️ Guard**, set *Max NEAR per action* to `0.05`, and ask for `buy 0.1 near of hoot`. The Guard turns red and blocks signing.
6. Type `payment link 10 usdc to intents.near for Order 42`. You should see a link card with **Copy** buttons for the URL, an iframe widget and a button.
7. Click **Open checkout ↗** on that card. Pick **Chain: Base** and **Token: ETH**, paste any Base address as the refund address, and click **Get quote in ETH**. You should see the exact ETH to send and a deposit address, while the receiver still gets exactly 10 USDC on NEAR.
8. Tap **📎**, pick any picture, then type `launch Pip Coin $PIP on nearly`. You should see a 🚀 launch card with your picture, cost (~0.09 NEAR) and a permanent-launch warning. Try `launch Pip Coin $P on hoot` and see the ticker rule rejected.
9. Type `add lp 1 near and usdc`. You should see a 💧 card with the Rhea pool, its TVL, the USDC amount matched to the pool ratio, and 4 steps.
10. Click **Earn yield**. Pip compares Rhea Lending APRs with staking options. Then type `supply 10 usdc`: you should see a 🏦 card with the live supply APR, "collateral: yes" and your health factor. Try `borrow 100000 usdc`: it's refused with the health factor it would cause.
11. Type `stake 5 near with linear`. You should see a 🥩 card with the live LiNEAR rate and how much LiNEAR you'd get. `stake 3 near on astro-stakers.poolv1.near` shows the validator fee and the 2–3 day unstake note. Just `stake 10 near` makes Pip ask liquid or validator.
12. Paste `hoot-17.nearlytrade.near`. You should see a 🔍 analysis with **Risk signals · high** and *"NOT the verified $HOOT — the real one is hoot-8ecf65.launchpad.justhoot.near"*, plus its creator wallet, wallet age, funder and tax (buy 4% · sell 4%). Then type `analyze hoot` for the real one (creator `justhoot-owner.near`, wallet age, tokens launched, creator holds ~12%).
13. Connect a wallet and click **Portfolio**. You should see every token you hold with price and USD value, memes tagged by launchpad.

**Without `NEAR_AI_API_KEY`** the app runs in *offline brain* mode: a small command parser that handles every typed command above (swap, buy/sell, bridge, pay, payment link, launch, add lp, supply/borrow/repay/withdraw, stake/unstake), so everything stays reproducible. Only the free-form questions (like the **Earn yield** pill) need the key. **With a key** (get one at https://cloud.near.ai), Pip understands free-form chat and calls the same tools.

Read-only smoke test of **every feature** (live mainnet quotes, builds the unsigned transactions, runs each through the Pilot Guard, signs nothing):

```bash
npm run smoke                      # or: npm run smoke -- your-account.near
```

Expected: `18 passed, 0 failed. Nothing was signed or sent.`

## Architecture

```
src/
  app/page.tsx              chat app (renders components/App)
  app/pay/page.tsx          checkout page for payment links (?embed=1 for the iframe widget)
  app/api/chat              POST: messages (+ wallet, + token picture) → agent → action cards
  app/api/pay/assets        POST: every token/chain a payer can use (from 1Click)
  app/api/pay/quote         POST: exact-output payment quote → action card
  app/api/intents-status    POST: 1Click status (+ optional deposit tx submit)
  app/api/trending          POST: verified memes + fresh nearly.trade launches
  lib/agent.ts              NEAR AI Cloud tool-calling loop, system prompt, instant/offline command parser
  lib/actions.ts            swap / bridge / memeTrade / trending / balances
  lib/pay.ts                pay / paymentLink / payableAssets (Pay with Intents)
  lib/launch.ts             launchToken on JustHoot / nearly.trade (live cost quotes)
  lib/liquidity.ts          addLiquidity on Rhea classic pools
  lib/lending.ts            supply / borrow / repay / withdraw on Rhea Lending + health factor
  lib/staking.ts            liquid & native staking, unstake, withdraw unstaked
  lib/portfolio.ts          every held token with live USD prices (Rhea list or live pool quote)
  lib/analyze.ts            token / wallet due-diligence report + risk signals
  lib/history.ts            FastNEAR holdings, top holders, tx history (with retries)
  lib/launchpads.ts         known NEAR token factories / launchpads
  lib/intents.ts            NEAR Intents 1Click client
  lib/rhea.ts               Rhea smart router + v2.ref-finance.near swap builder
  lib/dcl.ts                Rhea DCL pool index, quotes, swap builder, nearly.trade launches
  lib/tokens.ts             symbol → contract resolver, verified list, copycat ranking
  lib/near.ts               read-only RPC (with fallback + timeouts), unit helpers
  lib/tx.ts                 transaction/action builders shared by server and client
  lib/cards.ts              ActionCard type (what the AI proposes)
  lib/guard.ts              Pilot Guard (runs in the browser before every wallet prompt)
  lib/image.ts              in-browser image → small on-chain token picture
  lib/wallet-manifest.json  bundled NEAR Connect wallet list (fallback)
  components/App.tsx        chat UI, 📎 upload, Guard settings, side panels
  components/QuickActions   welcome-message pills (+ More/Less)
  components/ActionCardView card UI, signing, Intents status tracking, checkout snippets
  components/Checkout.tsx   payment-link checkout
  components/useWallet.ts   NEAR Connect wallet hook
  components/Pip.tsx        the mascot 🦉 · RichText.tsx: tiny safe markdown
scripts/smoke.ts            read-only end-to-end check of every feature
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `NEAR_AI_API_KEY` | — | NEAR AI Cloud key. Leave unset for offline mode. |
| `NEAR_AI_MODEL` | `deepseek/deepseek-v4.1-flash` | Any tool-calling model on NEAR AI Cloud |
| `NEAR_AI_BASE_URL` | `https://cloud-api.near.ai/v1` | |
| `ONECLICK_JWT` | — | 1Click partner JWT (removes the 0.2% fee, rule Q-006) |
| `NEAR_RPC_URLS` | fastnear, shitzuapes, drpc | Comma-separated mainnet RPCs |
| `PUBLIC_SITE_URL` | request origin | Base URL used in payment links (set it when deployed) |

## Deploy (Vercel)

The live demo runs on Vercel. To deploy your own copy:

```bash
npx vercel link
npx vercel env add NEAR_AI_API_KEY production   # paste your key when asked
npx vercel deploy --prod
```

Payment links automatically use the deployment's address (or set `PUBLIC_SITE_URL`). API routes allow up to 60 s (`maxDuration`) for the first cold request, which builds the pool and price indexes.

## Known limitations

- Mainnet only (NEAR Intents has no testnet). A real wallet swap has been completed through Allpilot; the other features are verified up to the signing step by `npm run smoke`, so try them with tiny amounts first.
- Adding liquidity supports Rhea **classic** pools, not concentrated (DCL) pools.
- JustHoot keeps token descriptions/links off-chain, so add them on justhoot.fun after launching. Token pictures must fit ~7 KB (JustHoot) / 16 KB (nearly.trade); Allpilot shrinks them automatically.
- Liquid-staking exits use an instant Rhea swap (small spread shown on the card). The protocols' delayed 1:1 unstake isn't wired up yet.
- Some wallets don't open inside iframes, so the embedded checkout widget works best when paying from another chain (deposit address) or opened as a full page.
- Prices, APRs and health factors come from live on-chain/Rhea data at quote time and can move before you sign.
- Token analysis gives risk *signals*, not verdicts. The creator is the signer of the token's launch transaction (or the launchpad's own record). If a wallet relayer signed it, or the token predates FastNEAR's indexed history, the creator/age shows as unknown. "Tokens launched" is exact for nearly.trade and otherwise counted from the creator's last 100 signed transactions. Top holders come from FastNEAR's top-100 list.
- Portfolio prices for memes Rhea doesn't list are live pool quotes for 1 token, so very large bags would sell for less than the value shown.

## Build log

All built during NEAR HACKATHON (git history, `main`):

1. Chat co-pilot with swaps (NEAR Intents, Rhea), bridging and memecoin trading (JustHoot, nearly.trade), Pilot Guard, cute UI
2. All NEAR wallets in the connect picker (bundled wallet manifest)
3. Instant command path and network timeouts (replies in ~1 s)
4. Pay with Intents: exact-amount payments, checkout links, embeddable widget
5. Hosted on Vercel
6. Token launches with uploaded pictures, Rhea liquidity
7. Quick-action pills
8. Lend & borrow on Rhea Lending, NEAR staking (liquid + validators)
9. Portfolio with real meme prices, contract-address analysis (creator, wallet age, funder, launches, holders, risks)

## Hackathon compliance notes

- **Built in the window**: all code was written during NEAR HACKATHON (after the 2026-10-19 announcement). There was no earlier code.
- **Libraries / boilerplate (Q-005)**: `create-next-app` (Next.js 16, React 19, Tailwind 4), `@hot-labs/near-connect` (wallets), `openai` SDK (pointed at NEAR AI Cloud), `tsx` (dev, smoke test). No other runtime dependencies. Written with help from AI coding assistants (Claude Code).
- **Data sources**: FastNEAR public APIs (holdings, top holders, transaction history), Rhea price list, NEAR RPC.
- **References used** (formats were read, not copied): NEAR Intents 1Click OpenAPI; nearly.trade's verified contract source (`sam3dsol/Nearlytrade`); fastnear's open-source near.fm launch adapters for JustHoot; Burrow's official SDK (`burrowHQ/burrow-sdk-python`) for Rhea Lending; on-chain views of Rhea, LiNEAR, rNEAR and Meta Pool.
- **Hosted demo (Q-012)**: https://allpilot.vercel.app, kept up through judging (at least 2026-11-18).
- **Mainnet (Q-007)**: NEAR Intents has no testnet, so Allpilot runs on mainnet. Test with a separate dev account and tiny amounts. Quotes without a wallet are `dry: true`.
- **Secrets**: keys live only in `.env.local` (git-ignored). Nothing is committed.
- **License**: MIT (see `LICENSE`).
- **Other projects by the author**: none.

## Disclaimer

Experimental hackathon software on mainnet. Memecoins can go to zero. Not financial advice.
