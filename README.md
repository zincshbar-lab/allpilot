# Allpilot 🤖✈️ — a cute AI co-pilot for NEAR

> Built at **NEAR HACKATHON** (Nov 2026). Tracks: **Unstoppable DeFi** (`defi`), **Real-World Money** (`realworld`), **Memecoins With Mechanics** (`memecoins`), **Agent Economy** (`agents`), **AI Security & Defense** (`security`), **Privacy & Private AI** (`privacy`).

**🌐 Live demo: https://allpilot.vercel.app** (mainnet, NEAR AI brain on) · Store checkout setup: [/checkout-widget](https://allpilot.vercel.app/checkout-widget?merchant=intents.near) · Demo store: [/demo-store](https://allpilot.vercel.app/demo-store) · Checkout example: [pay 1 USDC](https://allpilot.vercel.app/pay?to=intents.near&amount=1&token=USDC&chain=near&memo=Demo)

## The problem

Doing things on NEAR means juggling many apps: near.com / NEAR Intents for swaps and bridges, Rhea (Ref) for trading and liquidity, Rhea Lending for borrowing, separate sites for staking, and launchpads like JustHoot and nearly.trade for memecoins. Each has its own UI, token lists full of copycat contracts, and different transaction formats. Paying someone across chains, or getting paid by a customer who holds a different token, is even harder, and a small shop has no simple way to take crypto from whatever wallet its customers use. Meanwhile anyone can launch a token in seconds, so it's hard to tell a real meme from a copycat or a serial rugger, and normal wallets don't even show what your memes are worth. And handing all of that to an AI is scary unless something stops it from doing the wrong thing.

## What Allpilot does

You chat with **Pip**, a little robot pilot in an aviator cap, in plain words. Pip fetches live quotes and turns your request into an **action card**: a fully built transaction that **your own wallet** signs. Pip never holds keys.

| You say | What happens | Venue |
| --- | --- | --- |
| `swap 1 near to usdc` | Quote + deposit address from NEAR Intents 1Click; wrap → `ft_transfer` to the deposit address | NEAR Intents (the near.com swap engine) |
| `swap 2 usdc to near on ref` | Best route from the Rhea smart router; one `ft_transfer_call` to `v2.ref-finance.near` | Rhea / Ref |
| `bridge 5 usdc from near to base 0xYourAddr` | Cross-chain quote; sign one tx on NEAR, funds arrive on Base | NEAR Intents |
| `bridge 0.01 eth from ethereum to near refund 0xYourAddr` | You get a deposit address to send ETH to from your EVM wallet; Allpilot tracks the status | NEAR Intents |
| `buy 0.1 near of hoot` | Finds the verified HOOT contract, quotes **only its official JustHoot launch pool**, wraps and swaps in one tx | JustHoot → Rhea DCL |
| `buy 0.1 near of nearly` | Same for nearly.trade tokens, **only through its official launch pool** | nearly.trade → Rhea DCL |
| `buy 1 near of blackdragon` | Tokens not from JustHoot/nearly.trade route through the pool with the **deepest real liquidity** (USD TVL); pools under $50 are refused | Rhea / Rhea DCL |
| `sell 100 hoot` | Sells back to native NEAR | Rhea DCL |
| `trending memes` | Verified memes + freshest nearly.trade launches (read on-chain from `nearlytrade.near`) | — |
| `my pnl` (or `pnl on hoot`) | Profit & loss on your buys and sells: realized, unrealized, per token, ROI | Rhea / DCL swap logs via FastNEAR |
| `my portfolio` | Every token you hold, memes included, with a real USD price and value (🔍 on any row analyzes it) | FastNEAR + Rhea prices + live DCL pool quotes |
| paste `idog.nearlytrade.near` (or a NearBlocks / launchpad link, or `analyze hoot`, `is X safe?`) | Token due-diligence report: launchpad, creator, creator wallet age / funder / tokens launched, holders, price, taxes, copycats, risk signals | FastNEAR tx history + on-chain views |
| `pay alice.near 5 usdc` | Same token on NEAR: one direct `ft_transfer` to the recipient, no fee | Direct |
| `pay alice.near 5 usdc with near` | Recipient gets **exactly** 5 USDC; you pay in NEAR (exact-output quote) | NEAR Intents |
| `send 5 usdc to 0xAbc… on base` | Pay someone on another chain from your NEAR wallet | NEAR Intents |
| `payment link 10 usdc for Order 42` | Fixed-amount invoice: shareable checkout link + embeddable widget + "Pay with Intents" button | NEAR Intents |
| `set up a crypto checkout for my store` (+ your NEAR account, or the connected wallet) | **Store checkout** for any website: code to paste once; each customer pays their **cart total** with any crypto and **NEAR lands in your wallet**; sends you to your setup page to finish | NEAR Intents + `checkout.js` |
| 📎 + `launch Pip Coin $PIP on hoot` | Launches a new memecoin with your uploaded picture: token + Rhea DCL pool in one tx | JustHoot `launch_meme` |
| `launch Robo $ROBO on nearly paired with USDC, 2% buy tax, 3% sell tax, half burned half to holders, fees to holders` | **Every launchpad setting**: pair, first buy, taxes, fee/tax split, fee mode, fee recipient, payouts, description & links | JustHoot / nearly.trade |
| `share my pnl` | A cute PnL image card (Pip + total + ROI + best trade) with **Post on 𝕏**, download and a share link | `/api/pnl-card` (next/og) |
| 🎤 or any language (`lanza un token…`, `买 1 NEAR 的 hoot`) | Voice input in your browser's language; Pip replies in the language you write in | Web Speech API + NEAR AI |
| 📎 + `launch Owl $OWL on nearly with first buy 0.2 near` | Same on nearly.trade, with description/links on-chain and an optional first buy | nearly.trade `launch` |
| `add lp 1 near and usdc` | Picks the deepest classic pool, matches the pool ratio, then register → deposit → `add_liquidity` | Rhea / Ref |
| `supply 10 usdc` | Lends USDC (earns the supply APR) and uses it as collateral; shows your health factor | Rhea Lending |
| `borrow 5 usdc` | Borrows against your collateral via `execute_with_pyth`; refuses anything that would leave health < 1.05 | Rhea Lending |
| `repay all usdc` · `withdraw all usdc from lending` | Repays debt from your wallet (with a tiny interest buffer) or withdraws supplied tokens, health-checked | Rhea Lending |
| `stake 5 near with linear` (or `rnear`, `stnear`) | Liquid staking via `deposit_and_stake`; shows the live share price and tokens you'll get | LiNEAR / Rhea rNEAR / Meta Pool |
| `stake 3 near on astro-stakers.poolv1.near` | Native staking with a validator (fee shown, high fees flagged) | Validator pool |
| **☰ → 💬 Chats** | New chat, switch or delete chats; conversations save in your browser (old quotes reopen locked, with **Get a fresh quote**) | — |
| `unstake all linear` · `unstake 1 near from <pool>` | Liquid: instant swap back to NEAR on Rhea (spread vs fair value shown). Native: `unstake`, then `withdraw my unstaked near from <pool>` after ~2–3 days | Rhea / validator |

### How NEAR fits in

- **NEAR Intents (1Click API)** does swaps and cross-chain bridging (BTC, ETH, SOL, Base, Arbitrum and 20+ chains) with no custodian. It's the same engine near.com uses. It also settles every payment: exact-output quotes mean a payee or store gets exactly the amount, whatever the payer holds.
- **Rhea DCL** (`dclv2.ref-labs.near`): JustHoot (`*.justhoot.near`) and nearly.trade (`*.nearlytrade.near`) launch every memecoin as one-sided liquidity in a DCL pool. Allpilot reads `list_pools` / `quote` directly from the contract, so any new launch is buyable right away.
- **Rhea classic AMM** (`v2.ref-finance.near`) via the public smart router for swaps, and `register_tokens` → deposit → `add_liquidity` for providing liquidity.
- **Launchpad factories**: `v2-launchpad.justhoot.near` (`launch_meme`) and `nearlytrade.near` (`launch`), each minting a NEP-141 token and opening its Rhea DCL pool in one transaction, priced live with `get_launch_deposit` / `quote_launch`.
- **Rhea Lending** (`contract.main.burrow.near`, formerly Burrow): supply / borrow / repay / withdraw through `ft_transfer_call` and `execute_with_pyth`.
- **Staking**: liquid staking with LiNEAR (`linear-protocol.near`), Rhea rNEAR (`lst.rhealab.near`) and Meta Pool stNEAR (`meta-pool.near`), and native staking with any `*.poolv1.near` validator.
- **FastNEAR public APIs** provide what a wallet holds, top holders per token, and full transaction history. The token analyzer uses them to find each token's launch transaction, its creator, and the creator's own first transaction (wallet age and funder). This is the **scam-detection** side of the AI Security & Defense track.
- **NEAR AI Cloud** (OpenAI-compatible, private inference) is the chat brain, with tool calling. Clear commands (`buy …`, `swap …`, `pay …`, `launch … on …`, `add lp …`, `supply …`, `borrow …`, `stake … with …`, a pasted address, `my portfolio`, `my pnl`) take an instant path that skips the LLM (~1 s). Every network call has a timeout, and if NEAR AI is unavailable Pip falls back to the command parser.
- **HOT's NEAR Connect** handles wallet connection: HOT, Meteor, Intear, Ledger, MyNearWallet, OKX, NEAR Mobile, Trezu, Nightly, Hana, Ethereum wallets (MetaMask etc. via EVM-on-NEAR) and NEAR CLI. The wallet list ships with the app (`src/lib/wallet-manifest.json`) as a fallback, so the picker is never empty if GitHub is slow or blocked.

### 💌 Pay with Intents (payments & invoice links)

A merchant (or friend) asks for an **exact amount of one token on one chain**: "10 USDC to shop.near". The payer pays with **whatever they hold, on whatever chain**.

1. **Make a link.** Tell Pip `payment link 10 usdc for Order 42`. You get a `/pay?to=…&amount=…&token=…&chain=…&memo=…` URL, an `<iframe>` widget and a "Pay with Intents" button snippet to paste on any website.
2. **Payer opens it** and picks a chain + token (NEAR, USDC, ETH on Base, SOL, BTC… anything NEAR Intents supports).
3. **Allpilot asks NEAR Intents 1Click for an `EXACT_OUTPUT` quote.** The output is fixed, so the payee gets exactly 10 USDC. The slippage buffer sits on the payer's side and anything unused is refunded.
4. **Paying from NEAR:** the payer's wallet signs one tx (wrap if needed, then transfer to the 1Click deposit address). **Paying from another chain:** the page shows a deposit address and exact amount to send from their own wallet (MetaMask, Phantom, a BTC wallet…), then tracks status live.
5. **Solvers settle it** through NEAR Intents and deliver the token to the payee. No custodian, no bridge UI, no account on our side.

Same token on NEAR (`pay alice.near 5 usdc`) skips Intents entirely: it's a direct transfer with no fee. Recipients are checked before quoting: NEAR accounts must exist, EVM addresses must be well-formed, and Pip always repeats the recipient.

### 🛒 Universal checkout widget (any store)

Any merchant, app or e-commerce site can add a crypto checkout. **The merchant only sets a NEAR account.** Each customer pays **their cart total** with any crypto NEAR Intents supports, and **NEAR lands in the merchant's wallet**.

1. **The merchant asks Pip:** `set up a crypto checkout for my store`. Pip uses the connected wallet, or the NEAR account they type (`… pay to yourshop.near`). Merchants receive NEAR, so Pip refuses EVM or Solana addresses for the merchant and explains that customers can still pay from any chain.
2. **Pip generates the website code.** The merchant pastes it once:

```html
<script src="https://allpilot.vercel.app/checkout.js" data-merchant="yourshop.near" defer></script>
<!-- on the checkout page: the store sets data-amount to the cart total (USD by default); data-ref (order id) is optional -->
<button data-allpilot-checkout></button>
```

3. **The amount is the cart total**, read when the customer clicks. Pip's code has no amount or order id built in. The store's template fills `data-amount` (and optionally `data-ref` with its order id) (Shopify `{{ cart.total_price | money_without_currency }}`, WooCommerce `WC()->cart->get_total('edit')`). A no-code site can use `data-amount-from="#cart-total"` to read the total shown on the page ("$49.50" works), and custom JS can call `Allpilot.checkout({ amount, ref })`. The button label follows the cart live ("Pay $37.50 with crypto"). Prices are in USD by default and converted to NEAR at the live price, rounded up so the merchant never gets less. `data-currency="NEAR"` prices in NEAR instead.
4. **The customer pays with whatever they have.** A popup on the store's page shows "$37.50 = 11.2952 NEAR". The customer picks any chain and token: a NEAR wallet, **MetaMask** and other EVM wallets (Ethereum, Base, Arbitrum, BNB…), **Phantom** (Solana), or a deposit address from any other wallet (BTC and more). NEAR Intents quotes an exact-output payment, and the unused buffer is refunded to the customer.
5. **NEAR lands in the merchant's wallet:** as wNEAR (wrapped NEAR, always 1:1) when the customer pays with other crypto, or plain NEAR when they pay in NEAR from a NEAR wallet. Nothing passes through Allpilot.
6. **The store knows it's paid.** The page gets `allpilot:paid` with `{ ref, amountNear, usd, depositAddress, txHash, sender }`, and `allpilot:status` for every step. The store's server confirms with `GET /api/pay/verify?deposit=<depositAddress>` (Intents) or `?tx=<hash>&sender=<account>` (direct NEAR transfer). It returns `{ paid, recipient, amount, amountFormatted, token }` read from 1Click or the chain, with CORS open. The total comes from the web page, so a store should ship only when `paid` is true, the recipient is its account, and the NEAR received is at least the order's `amountNear`.

**🧸 See it in a real store:** [`/demo-store`](https://allpilot.vercel.app/demo-store) is *Pip's Plushie Shop*, a small sample shop built the way a merchant would add the checkout. It loads `checkout.js` with `data-merchant="allpilot.near"`, and its cart page has `<button data-allpilot-checkout data-amount-from="#cart-total">`. Add or remove items and the button follows the cart total ("Pay $36.50 with crypto"). Click it and the popup converts the total to NEAR and lets you pay with any crypto. The page also shows "🎉 Paid!" when it receives `allpilot:paid`. **It's a real checkout:** paying moves real funds to `allpilot.near`, so only opening the popup and getting a quote is free.

The popup works on phones, follows light or dark mode, closes with ✕, Esc or a click outside, and has an "Open in new tab" fallback for wallets that won't open inside a frame. Pip's card makes the setup page the next step (**👉 Next: finish setup… · Open my setup page**), and Pip says so in its reply, because the checkout only takes payments once the store fills in the cart total. The setup page opens with a **Finish setting up** checklist that ticks off as the merchant goes (account set, button tested, code copied, cart total added, payment check added). It also has the NEAR account field (or **Connect wallet**), USD/NEAR pricing, a sample cart to try the real button, copy-ready code, Shopify/WooCommerce/no-code/JS examples and the verification steps. Fixed-amount invoices still work too: `payment link 25 usdc for order 1042`.

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

### 🎛️ Every launch setting

Pip supports **all** settings each launchpad's contract accepts, validates them before you sign, and quotes the exact cost from the contract:

| Setting | JustHoot (`v2-launchpad.justhoot.near`) | nearly.trade (`nearlytrade.near`) |
| --- | --- | --- |
| Pair | any of `get_allowed_quote_tokens` (NEAR, USDC, ZEC, RHEA, HOOT, PEARL, QTC) | any enabled `get_quotes` asset (NEAR, USDC, USDT, RHEA, ZEC, NEARLY, WBTC, ETH, KAT…) |
| First buy | NEAR pair only (`dev_buy_quote_max`; the quote then includes it) | NEAR pair only (`dev_buy`) |
| Tax | one transfer tax, 0–5% (`transfer_fee_pips`) | buy tax and sell tax, 0–4% each (`tax.buy_bps / sell_bps`) |
| Where fees/taxes go | `shares`: you / burn / holders (= 100%) | `tax` split you / burn / holders, plus `fee_mode` creator / burn / holders for the pool-fee creator share |
| Fee recipient | n/a | `fee_to` (another NEAR account) |
| Payout currency | n/a | `creator_paid_in` / `holders_paid_in`: NEAR or the pair |
| Description & links | hosted metadata JSON at `/api/token-meta?d=…` + its SHA-256 as `reference_hash` | stored on-chain |

Invalid combinations are refused with a clear reason: a first buy on a non-NEAR pair, taxes over the cap, a split that doesn't add up to 100%, or a pair the launchpad doesn't allow. Ask *"what launch settings can I choose?"* to get the live list.

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

### 📸 Shareable PnL card

`share my pnl` makes a 1200×630 image: Pip, your total PnL in NEAR and $, ROI, best trade, realized vs. open. It's rendered server-side by `next/og` at `/api/pnl-card/<account>` **from your on-chain swaps**, so a shared link can't be edited to show fake numbers. The card has **Post on 𝕏** (pre-written post with #NEARHackathon @NEARProtocol), **Download image** and **Copy link**. The link (`/share/pnl/<account>`) shows the card as the preview on X and Telegram.

### 📊 PnL on your buys and sells

`my pnl` (or the **My PnL** pill, or `pnl on <token>`) rebuilds your trades from the chain, so it includes trades made on **any** app (Allpilot, JustHoot, nearly.trade, neartrade, Rhea…):

1. Reads your last ~400 signed transactions (FastNEAR) and their receipt logs.
2. Pulls out every swap hop: Rhea DCL `EVENT_JSON` swap events (`swapper`, `token_in/out`, `amount_in/out`) and classic Rhea `Swapped X a for Y b` logs.
3. Nets the hops in each transaction, so NEAR → USDC → PRL → OYSTER becomes one *buy OYSTER for N NEAR*.
4. Prices each trade in **NEAR**. Legs paid in stablecoins or other tokens (e.g. selling a meme for PRL) are valued at today's price and marked ≈.
5. Average-cost accounting per token. **Realized** = sale proceeds − average cost of what was sold. **Unrealized** = (today's price − average cost) × what you still hold (capped at your actual wallet balance). Shown in NEAR and USD, with ROI.

Sales of tokens with **no recorded buy** (received by transfer, or bought before the scanned history) are shown as "sold X, cost unknown" and **left out** of the totals instead of being counted as pure profit. Tap 🔍 on any row to analyze that token.

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
| `setup_checkout` | Store checkout: merchant NEAR account → website code; customers pay cart totals with any crypto |
| `pay` · `create_payment_link` | Exact-amount payments to any chain; checkout links + widget |
| `launch_token` | Launch a memecoin on JustHoot or nearly.trade (with uploaded picture) |
| `add_liquidity` | Add liquidity to a Rhea classic pool |
| `lending` · `lending_info` | Supply / borrow / repay / withdraw on Rhea Lending; markets, positions, health |
| `stake` · `unstake` · `withdraw_unstaked` · `staking_info` | Liquid & validator staking; rates and your stakes |
| `pnl` · `share_pnl` | Profit & loss on the user's buys/sells; shareable image card |
| `launch_options` | Live list of every launch setting and allowed pair per launchpad |
| `portfolio` · `get_balances` | Full portfolio with live prices (memes included); quick major-token balances |
| `analyze_token` | Due-diligence report on a token contract (or wallet profile) |

The system prompt makes Pip ask instead of guessing (launchpad, staking type, recipient), never substitute a different token, chain or recipient than the one asked for, and never give financial advice.

### ✅ Official launch pools only (no fake LPs)

Anyone can open extra pools for a meme with thin or skewed liquidity. On Rhea DCL, NEARLY has 160+ pools and HOOT 24. So **every buy and sell of a JustHoot or nearly.trade token is locked to the pool its launchpad created at launch**, read on-chain:

| Launchpad | Where the official pool comes from |
| --- | --- |
| JustHoot v1 | the token's `get_config()` → `dcl_pool_id` / `dcl_quote_token_id` (and `platform_id` must be `launchpad.justhoot.near`) |
| JustHoot v2 | `v2-pool-creator.justhoot.near.get_launch_state({token_id})` → `launch.plan.pool_id`, confirmed by `v2-launchpad.justhoot.near.is_launched_token` |
| nearly.trade | `nearlytrade.near` launch record → `pool_id` + `quote` |

The pool must also exist on Rhea DCL and contain the token. If a meme launched against another asset (e.g. OYSTER/PRL, IDOG/AINEAR), the route is *official meme pool + the deepest path between that asset and NEAR* (see "Any pairing" below). If the official pool can't be verified, Allpilot **refuses** to trade the token rather than fall back to some other pool. Meme cards show `Route: ✅ official … launch pool · NEAR → … → TOKEN` with the official pool id, and the token analyzer lists the official pool and how many other pools it ignores. Portfolio and PnL prices use the official pool too.

### 🌊 Any pairing: NEAR can buy & sell tokens paired with other assets

One router (`src/lib/deeproute.ts`) gets **NEAR to and from any token, whatever it's paired with**: USDC, USDT, PRL, ZEC, RHEA, WBTC, KAT, HOOT, NEARLY, other memes, and so on.

1. **Launchpad memes** (JustHoot, nearly.trade): the meme leg is always the **official launch pool**. The rest of the way, from its quote asset to NEAR, is the deepest path.
2. **Everything else**: every Rhea pool holding the token is measured in USD liquidity. That's classic **simple, stable, rated and degen** pools (so LiNEAR/stNEAR use their $3–4M pools) and **all** DCL pools. The route starts at the deepest one.
3. **Hub hops**: if there's no direct pool to NEAR, the path goes through a hub (NEAR, USDC or USDT), e.g. `NEAR → USDC → PEARL → OYSTER`. A direct pool is preferred unless a hub route is much deeper.
4. **Two linked transactions** when needed: Rhea classic and Rhea DCL are separate contracts, so if the liquidity lives in both (e.g. ALPHAR is launched against RHEA, but RHEA↔NEAR liquidity is in classic pools), Allpilot builds **two swaps signed together**: `NEAR → RHEA` (classic), then `RHEA → ALPHAR` (official DCL pool). The second swap spends exactly the first one's guaranteed minimum, so it can't fail on amount. Any surplus from a better fill stays in your wallet, and the card says so.
5. **NEAR Intents fallback**: if Rhea has no route but NEAR Intents' solvers support the token, it's quoted through Intents.
6. **Safety**: routes whose shallowest pool holds under **$50** are refused (warn under $1,000). Selling into a launch pool **nobody has bought into yet** is explained instead of failing silently.

Cards show the full path and how it was chosen, e.g. `Route: ✅ official nearly.trade launch pool · NEAR → RHEA → ALPHAR` or `Route: 🌊 deepest liquidity · $40,898 · NEAR → BLACKDRAGON`, plus the pool ids and "2 linked swaps" when used.

**Coverage check** (read-only survey of real tokens paired with non-NEAR assets): every token whose pair asset has *any* real path to NEAR works for both buy and sell. That includes pairs against HOOT, ZEC, PRL, RHEA, WBTC, NEARLY, QTC, KAT, USDC, USDC.e and other memes. The only ones that can't trade are honest limits: launch pools nobody has bought into yet (nothing to sell into), dead test launches, and tokens launched against bridged BNB-chain memes that have **no pool against NEAR/USDC/USDT anywhere on NEAR** and aren't on NEAR Intents.

### 🦊 Pay from MetaMask / Phantom

When a payment or bridge starts on another chain, the card shows a deposit address **and** a one-click button. Nobody has to copy addresses:

- **🦊 Pay with MetaMask** (any injected EVM wallet) on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Gnosis, Berachain, Scroll and Monad. It switches to the right network, then sends the native coin or calls the token's ERC-20 `transfer(deposit, exact amount)`.
- **👻 Pay with Phantom** on Solana. It sends SOL, or for SPL tokens creates the deposit's token account if needed (idempotent) and does a `transferChecked` of the exact amount. Reads go through a tiny allow-listed proxy (`/api/solana-rpc`) because public Solana RPCs block browsers.

The wallet always shows the amount and recipient for you to confirm. The transaction hash is reported to NEAR Intents and the card tracks it live.

### 🎤 Voice & any language

Tap **🎤** and talk. The browser's speech recognition (your browser language) fills the chat box, and nothing sends until you press send. Pip replies in whatever language you write in, keeping symbols, contracts and numbers unchanged.

### 🤝 Hire Pip on NEAR Agent Market

Pip can be listed on [market.near.ai](https://market.near.ai) so people and other agents can hire it by the job (Agent Economy track). A signed webhook (`/api/agent-market/webhook`: HMAC-SHA256, ±300 s, dedupe) answers 2xx (= started), runs Pip in **report mode** on the brief (treated as data, read-only tools only), and submits a Markdown report with a link to open the plan in Allpilot and sign there. Setup steps and listing copy: [`docs/AGENT_MARKET.md`](docs/AGENT_MARKET.md).

### 💬 Chats that save themselves

Every conversation is saved automatically. Open **☰ → 💬 Chats** to start a **＋ New chat**, switch between earlier chats or delete one. Each chat shows its first message as the title, when you last used it, how many messages it has and which wallet was connected.

- Chats are stored **in your browser only** (localStorage). Nothing about them is sent to a server, and they don't follow you to another device.
- Up to 40 chats are kept. If the browser's storage fills up, the oldest chats are dropped first.
- Two open tabs don't overwrite each other's chats.
- **Old quotes can't be signed.** When a saved chat is reopened, every card that could move money (a sign button or a deposit address) is locked as a "saved quote". Its **Get a fresh quote** button asks Pip the same question again for a new, signable card. Info cards (portfolio, PnL, token analysis, payment links) stay fully usable.

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

0. The page shows the logo, your wallet button and a **☰** button; everything else (💬 Chats, Pilot Guard settings, "What Pip can do", Meme garden, how it works) lives in the ☰ menu, which opens and closes on click (or Esc). Under Pip's welcome message you'll see quick-action pills (**Launch a token**, **Portfolio**, **Earn yield**, **Swap**, **Pay a friend**, **More**). Click **More** to reveal the rest.
1. Type `buy 0.1 near of hoot`. You should see a card with the verified contract `hoot-8ecf65.launchpad.justhoot.near`, a live quote, **`Route: ✅ official JustHoot launch pool · NEAR → HOOT`** with official pool `hoot-8ecf65.launchpad.justhoot.near|wrap.near|10000` (HOOT has 24 pools; only this one is used), and a warning about lookalike tokens.
2. Click the **Swap** pill (sends `swap 1 near to usdc`). You should see a NEAR Intents quote (est. output, minimum, ~time).
3. Type `bridge 5 usdc from near to base 0x2527D02599Ba641c19FEa793cD0F167589a0f10D`. You should see a bridge card with the recipient filled in.
4. Click **Connect wallet**, then repeat any request. The card now has **Sign with wallet (n tx)** and a green **Pilot Guard** line.
5. Open the **☰ menu** (top-right) → **Pilot Guard**, set *Max NEAR per action* to `0.05`, close the menu (☰ again), and ask for `buy 0.1 near of hoot`. The Guard turns red and blocks signing.
6. Type `payment link 10 usdc to intents.near for Order 42`. You should see a link card with **Copy** buttons for the URL, an iframe widget and a button.
7. Click **Open checkout ↗** on that card. Pick **Chain: Base** and **Token: ETH**, paste any Base address as the refund address, and click **Get quote in ETH**. You should see the exact ETH to send and a deposit address, while the receiver still gets exactly 10 USDC on NEAR.
8. Tap **📎**, pick any picture, then type `launch Pip Coin $PIP on nearly`. You should see a 🚀 launch card with your picture, cost (~0.09 NEAR) and a permanent-launch warning. Try `launch Pip Coin $P on hoot` and see the ticker rule rejected.
9. Type `add lp 1 near and usdc`. You should see a 💧 card with the Rhea pool, its TVL, the USDC amount matched to the pool ratio, and 4 steps.
10. Click **Earn yield**. Pip compares Rhea Lending APRs with staking options. Then type `supply 10 usdc`: you should see a 🏦 card with the live supply APR, "collateral: yes" and your health factor. Try `borrow 100000 usdc`: it's refused with the health factor it would cause.
11. Type `stake 5 near with linear`. You should see a 🥩 card with the live LiNEAR rate and how much LiNEAR you'd get. `stake 3 near on astro-stakers.poolv1.near` shows the validator fee and the 2–3 day unstake note. Just `stake 10 near` makes Pip ask liquid or validator.
12. Paste `hoot-17.nearlytrade.near`. You should see a 🔍 analysis with **Risk signals · high** and *"NOT the verified $HOOT — the real one is hoot-8ecf65.launchpad.justhoot.near"*, plus its creator wallet, wallet age, funder and tax (buy 4% · sell 4%). Then type `analyze hoot` for the real one (creator `justhoot-owner.near`, wallet age, tokens launched, creator holds ~12%).
13. Connect a wallet and click **Portfolio**. You should see every token you hold with price and USD value, memes tagged by launchpad.
14. Connect a wallet that has traded memes and click **My PnL**. You should see total PnL in NEAR and $, realized vs. unrealized, and one row per token with buys/sells, invested, ROI and "closed" or "N held".
15. Type `buy 1 near of blackdragon`. You should see `Route: 🌊 deepest liquidity · $40K+ · NEAR → BLACKDRAGON` with pool `4276` (not one of BLACKDRAGON's smaller pools). Then `buy 0.5 near of nd.tkn.near`: it's refused because even its deepest pool is under the $50 liquidity floor.
16. Type `buy 1 near of alphar.nearlytrade.near` (launched against RHEA). You should see `Route: ✅ official nearly.trade launch pool · NEAR → RHEA → ALPHAR` and `Transactions: 2 linked swaps (Rhea classic + DCL), signed together`. Then `buy 1 near of oyster.v2-launchpad.justhoot.near` shows `NEAR → USDC → PEARL → OYSTER` in one transaction.
17. Type `launch Robo $ROBO on nearly paired with USDC, 2% buy tax and 3% sell tax, half burned half to holders, fees to holders`. The card should show `Pair: USDC`, `Buy / sell tax: 2% / 3% · 50% burned · 50% to holders` and pool fees → holders. Try `launch Bad $BAD on nearly paired with USDC with first buy 1 near`: it's refused (first buys need the NEAR pair).
18. Connect a wallet that has traded memes and type `share my pnl`. You should see the image card with **Post on 𝕏**, **Download image** and **Copy link**. Open the link: `/share/pnl/<account>` shows the same card (and that's the X preview).
19. Open the checkout from step 7 and pick **Base → USDC** (or **Solana → USDC**). After the quote, the card shows **🦊 Pay with MetaMask** (or **👻 Pay with Phantom**), which asks your wallet to send exactly the quoted amount to the deposit address.
20. Tap **🎤** and say a command, or type in another language (e.g. `lanza un token Gato $GATO en justhoot con 3% de impuesto`). Pip answers in that language.
21. Type `swap 1 near to usdc`, then reload the page. The chat is still there, and the swap card now says *Saved quote* with **Get a fresh quote** instead of a sign button. Open **☰ → 💬 Chats**, click **＋ New chat**, ask something else, and switch back and forth between the two chats in the list.
22. Type `set up a crypto checkout for my store, pay to intents.near` (or connect a wallet and say `create a checkout widget for my website`). You should see a 🛒 card that leads with **👉 Next: finish setup on your setup page** and an **Open my setup page** button, then the website code (`data-merchant="intents.near"` and an empty `<button data-allpilot-checkout>`, with no amount or order built in). The setup page opens with a *Finish setting up* checklist at 1 of 5. Try `accept crypto on my shop, send to 0x2527D02599Ba641c19FEa793cD0F167589a0f10D`: it's refused, because merchants receive in NEAR. Open the setup page, enter a sample cart total of `37.50` and click the button. The popup shows `$37.50 = … NEAR at today's price`. Pick **Base → USDC**, enter an address and **Get quote**: the card says the merchant gets exactly that NEAR and shows **🦊 Pay with MetaMask**. `curl "https://allpilot.vercel.app/api/pay/verify?deposit=<deposit address>"` answers `paid: false` until it's paid.
23. Open [`/demo-store`](https://allpilot.vercel.app/demo-store). Press **+** on *Co-pilot Mug* and *Aviator Cap*: the cart total and the ✨ button change together (e.g. **Pay $36.50 with crypto**). Click it. The popup shows `$36.50 = … NEAR at today's price` going to `allpilot.near`. Pick **Base → USDC**, enter any Base address and **Get quote**: the card says `allpilot.near` gets exactly that NEAR and shows **🦊 Pay with MetaMask**. Stop there unless you want to really buy something.

**Without `NEAR_AI_API_KEY`** the app runs in *offline brain* mode: a small command parser that handles every typed command above (swap, buy/sell, bridge, pay, payment link, store checkout setup, launch, add lp, supply/borrow/repay/withdraw, stake/unstake), so everything stays reproducible. Only the free-form questions (like the **Earn yield** pill) need the key. **With a key** (get one at https://cloud.near.ai), Pip understands free-form chat and calls the same tools.

Read-only smoke test of **every feature** (live mainnet quotes, builds the unsigned transactions, runs each through the Pilot Guard, signs nothing):

```bash
npm run smoke                      # or: npm run smoke -- your-account.near
```

Expected: `27 passed, 0 failed. Nothing was signed or sent.`

## Architecture

```
src/
  app/page.tsx              chat app (renders components/App)
  app/pay/page.tsx          checkout page (payment links, store checkout popup; ?usd= converts a cart total to NEAR)
  app/checkout-widget       store checkout setup page: NEAR account, live button, code, platform examples, checklist
  app/demo-store            Pip's Plushie Shop: a sample store using checkout.js (payments to allpilot.near)
  app/api/chat              POST: messages (+ wallet, + token picture) → agent → action cards
  app/api/pay/assets        POST: every token/chain a payer can use (from 1Click)
  app/api/pay/quote         POST: exact-output payment quote → action card
  app/api/intents-status    POST: 1Click status (+ optional deposit tx submit)
  app/api/pay/verify        GET: was an order paid? (1Click deposit status or the NEAR tx), CORS open for stores
  app/api/trending          POST: verified memes + fresh nearly.trade launches
  lib/agent.ts              NEAR AI Cloud tool-calling loop, system prompt, instant/offline command parser
  lib/actions.ts            swap / bridge / memeTrade / trending / balances
  lib/pay.ts                pay / paymentLink / merchantCheckout / payableAssets (Pay with Intents)
  lib/launch.ts             launchToken on JustHoot / nearly.trade (live cost quotes)
  lib/liquidity.ts          addLiquidity on Rhea classic pools
  lib/lending.ts            supply / borrow / repay / withdraw on Rhea Lending + health factor
  lib/staking.ts            liquid & native staking, unstake, withdraw unstaked
  lib/portfolio.ts          every held token with live USD prices (Rhea list or live pool quote)
  lib/analyze.ts            token / wallet due-diligence report + risk signals
  lib/pnl.ts                trade history from swap logs → realized / unrealized PnL
  lib/pnlShare.ts           PnL summary + share card (image, page, X intent)
  lib/externalPay.ts        pay deposit addresses from MetaMask (EVM) / Phantom (Solana)
  lib/agentMarket.ts        NEAR Agent Market worker: signature check, report mode, start/message/submit
  app/api/pnl-card          next/og PnL image · app/share/pnl: share page with X preview
  app/api/token-meta        JustHoot launch metadata (description + links) served from the URL
  app/api/solana-rpc        allow-listed read-only Solana RPC proxy for Phantom payments
  app/api/agent-market      webhook + poll safety net
  components/useVoice.ts    🎤 speech-to-text
  lib/chats.ts              saved chat sessions (localStorage), old quotes archived on restore
  public/checkout.js        store checkout for any website: button + popup, cart total read at click, paid events (no dependencies)
  lib/verifyPayment.ts      payment checks behind /api/pay/verify
  lib/history.ts            FastNEAR holdings, top holders, tx history (with retries)
  lib/launchpads.ts         known NEAR token factories / launchpads
  lib/intents.ts            NEAR Intents 1Click client
  lib/rhea.ts               Rhea smart router + v2.ref-finance.near swap builder (major tokens)
  lib/deeproute.ts          universal router: official meme pools, deepest liquidity, hub hops, two-step classic+DCL routes, $50 floor
  lib/dcl.ts                Rhea DCL pool index, official launch-pool registry, quotes, swap builder, nearly.trade launches
  lib/tokens.ts             symbol → contract resolver, verified list, copycat ranking
  lib/near.ts               read-only RPC (with fallback + timeouts), unit helpers
  lib/tx.ts                 transaction/action builders shared by server and client
  lib/cards.ts              ActionCard type (what the AI proposes)
  lib/guard.ts              Pilot Guard (runs in the browser before every wallet prompt)
  lib/image.ts              in-browser image → small on-chain token picture
  lib/wallet-manifest.json  bundled NEAR Connect wallet list (fallback)
  components/App.tsx        chat UI, 📎 upload, header (logo · wallet · ☰), ☰ menu with saved chats, Guard settings, skills, meme garden
  components/QuickActions   welcome-message pills (+ More/Less)
  components/ActionCardView card UI, signing, Intents status tracking, checkout snippets
  components/Checkout.tsx   checkout UI (any chain/token in, exact amount out; tells the store's page what happened)
  components/WidgetBuilder  store checkout setup page · DemoStore.tsx: the sample store
  components/useWallet.ts   NEAR Connect wallet hook
  components/Pip.tsx        Pip, the robot-pilot logo/mascot (app/icon.svg = favicon) · RichText.tsx: tiny safe markdown
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
| `PUBLIC_SITE_URL` | request origin | Base URL used in payment links and share images |
| `AGENT_MARKET_TOKEN` / `AGENT_MARKET_WEBHOOK_SECRET` | — | NEAR Agent Market agent token (`aat_…`) and webhook secret (`whsec_…`); see `docs/AGENT_MARKET.md` |

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
- Some wallets don't open inside iframes, so the embedded checkout widget works best when paying from another chain (deposit address / MetaMask / Phantom) or opened as a full page. The store checkout popup has an "Open in new tab" link for this.
- Store checkout: the cart total comes from the store's web page, so a customer could edit it in their browser. Stores should confirm each order with `/api/pay/verify` before shipping. Merchants receive NEAR as wNEAR (wrapped NEAR, 1:1) when customers pay with other crypto. Quotes from Base (USDC/MetaMask) and Solana (SOL/Phantom) were tested live; a completed customer payment through the store checkout has not been tested yet.
- Saved chats live in one browser (localStorage), so they don't follow you to another device.
- Voice input needs a browser with the Web Speech API (Chrome, Edge, Safari); the 🎤 button hides elsewhere. The Agent Market listing itself must be created by the owner on market.near.ai (account, token and webhook secret); until those env vars are set, the webhook answers 503.
- Prices, APRs and health factors come from live on-chain/Rhea data at quote time and can move before you sign.
- Token analysis gives risk *signals*, not verdicts. The creator is the signer of the token's launch transaction (or the launchpad's own record). If a wallet relayer signed it, or the token predates FastNEAR's indexed history, the creator/age shows as unknown. "Tokens launched" is exact for nearly.trade and otherwise counted from the creator's last 100 signed transactions. Top holders come from FastNEAR's top-100 list.
- PnL covers Rhea and Rhea DCL swaps in your last ~400 signed transactions. NEAR Intents (1Click) swaps settle in separate transactions and aren't included. Legs in stablecoins or other tokens use today's prices (≈), not the price at trade time.
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
10. PnL on buys and sells; new robot-pilot logo
11. Simpler page (☰ menu); meme trades locked to each token's official launch pool
12. Deepest-liquidity routing for all other tokens, with a $50 liquidity floor
13. Any pairing: hub hops (NEAR/USDC/USDT), all Rhea pool types, two linked classic+DCL swaps, NEAR Intents fallback
14. Shareable PnL card, every launchpad setting, MetaMask/Phantom checkout, voice & any language, NEAR Agent Market integration
15. Chat sessions: new chat, saved conversations in the browser, old quotes locked on restore
16. Universal checkout for any store: the merchant sets a NEAR account (connected or typed), each customer pays the cart total with any crypto, NEAR lands in the merchant's wallet; `checkout.js`, payment events, `/api/pay/verify`; Pip sends merchants to a setup page with a finish-setting-up checklist; a demo store (`/demo-store`) shows it in a real shop

## Hackathon compliance notes

- **Built in the window**: all code was written during NEAR HACKATHON (after the 2026-10-19 announcement). There was no earlier code.
- **Libraries / boilerplate (Q-005)**: `create-next-app` (Next.js 16, React 19, Tailwind 4), `@hot-labs/near-connect` (wallets), `openai` SDK (pointed at NEAR AI Cloud), `@solana/web3.js` + `@solana/spl-token` (Phantom payments, loaded only when used), `tsx` (dev, smoke test). Written with help from AI coding assistants (Claude Code).
- **Data sources**: FastNEAR public APIs (holdings, top holders, transaction history), Rhea price list, NEAR RPC.
- **References used** (formats were read, not copied): NEAR Intents 1Click OpenAPI; nearly.trade's verified contract source (`sam3dsol/Nearlytrade`); fastnear's open-source near.fm launch adapters for JustHoot; Burrow's official SDK (`burrowHQ/burrow-sdk-python`) for Rhea Lending; on-chain views of Rhea, LiNEAR, rNEAR and Meta Pool.
- **Hosted demo (Q-012)**: https://allpilot.vercel.app, kept up through judging (at least 2026-11-18).
- **Mainnet (Q-007)**: NEAR Intents has no testnet, so Allpilot runs on mainnet. Test with a separate dev account and tiny amounts. Quotes without a wallet are `dry: true`.
- **Secrets**: keys live only in `.env.local` (git-ignored). Nothing is committed.
- **License**: MIT (see `LICENSE`).
- **Other projects by the author**: none.

## Disclaimer

Experimental hackathon software on mainnet. Memecoins can go to zero. Not financial advice.
