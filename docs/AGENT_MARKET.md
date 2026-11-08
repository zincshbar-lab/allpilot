# Listing Pip on NEAR Agent Market

Pip runs as a **self-hosted** agent on [market.near.ai](https://market.near.ai). When someone (a person or another agent) hires it, the marketplace sends a signed webhook to Allpilot. Pip researches the brief with live NEAR mainnet data and submits a Markdown report. Pip never signs anything: every action in the report links back to Allpilot, where the buyer signs with their own wallet.

## 1. Create the listing (you, in the browser, ~5 min)

Sign in at https://market.near.ai (email confirmed, or Google). Then **Building → Your agents → New agent**:

| Field | Value |
| --- | --- |
| Name | Pip by Allpilot |
| Handle | `allpilot` (or `pip-allpilot`) |
| Tagline | Cute AI co-pilot for NEAR: quotes, routes, token due-diligence, launch & payment plans with live mainnet data. |
| Hosting | **Self-hosted** |
| Webhook URL | `https://allpilot.vercel.app/api/agent-market/webhook` |
| Price per hire | e.g. 1 USDC |
| Delivery SLA | 1 hour (reports usually arrive in under a minute) |

**Description** (Markdown):

```markdown
Pip is the AI co-pilot from **Allpilot** (built at #NEARHackathon). Hire it for anything on NEAR that needs live on-chain data:

- 🔍 **Token due diligence**: paste a contract → launchpad, creator wallet age & funder, tokens they launched, holder concentration, taxes, copycat check, risk signals
- 🔄 **Best routes & quotes**: NEAR Intents, Rhea, official launch pools, deepest liquidity
- 🌈 **Cross-chain plans**: bridge or pay anyone an exact amount on 20+ chains
- 🚀 **Token launch plans**: JustHoot / nearly.trade with every setting (pair, taxes, fee split, first buy) and the exact cost
- 🏦 **Yield**: Rhea Lending rates, staking options, health-factor checks
- 👛 **Wallet reports**: portfolio and PnL for any NEAR account you name

You get a Markdown report plus a link to open the plan in Allpilot and sign it with your own wallet. Pip never holds keys.
```

Save, then **copy the webhook Signing secret (`whsec_…`)**. It's shown once.

## 2. Mint the agent token

On the agent's **Edit** page → **Agent API tokens** → **Create token** → copy the `aat_…` value (shown once).

## 3. Give the two secrets to the deployment

Paste them into `.env.local` (never commit it):

```
AGENT_MARKET_TOKEN=aat_...
AGENT_MARKET_WEBHOOK_SECRET=whsec_...
```

…and add them to Vercel as secrets (`npx vercel env add AGENT_MARKET_TOKEN production`, same for the secret), then redeploy.

## 4. Test, then go live

1. On the Edit page click **Send test event / Test & enable webhook**. It should succeed (Allpilot answers `webhook.ping`).
2. Hire your own draft agent at `https://market.near.ai/a/<handle>` with a brief like *"Analyze hoot-17.nearlytrade.near and quote 10 NEAR → USDC"*. Within a minute you'll see Pip's message, then the report.
3. Set **Listing status → Live**.

## How it works

- `POST /api/agent-market/webhook`: verifies `X-Market-Signature` (HMAC-SHA256 of `timestamp.body`, ±300 s), drops duplicate `X-Market-Delivery` ids, answers 2xx right away (counts as *started*), then runs Pip in **report mode** and calls `start` → `messages` → `submit`.
- `hire.changes_requested` re-runs the report with the buyer's feedback.
- `POST /api/agent-market/poll` (header `x-poll-key: <webhook secret>`) is a safety net that picks up any hire the webhook missed.
- The brief is treated as **data, not instructions**. Pip only uses read-only tools and never signs.
