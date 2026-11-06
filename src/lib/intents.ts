// NEAR Intents 1Click API — powers the near.com-style swaps and cross-chain bridging.
// Docs: https://docs.near-intents.org  ·  OpenAPI: https://1click.chaindefuser.com/docs/v0/openapi.yaml

const BASE = "https://1click.chaindefuser.com";

export type IntentsToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  contractAddress?: string;
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  // Optional partner JWT (rule Q-006): without it 1Click charges a 0.2% fee.
  if (process.env.ONECLICK_JWT) h.Authorization = `Bearer ${process.env.ONECLICK_JWT}`;
  return h;
}

let tokenCache: { at: number; list: IntentsToken[] } | null = null;

export async function intentsTokens(): Promise<IntentsToken[]> {
  if (tokenCache && Date.now() - tokenCache.at < 5 * 60_000) return tokenCache.list;
  const res = await fetch(`${BASE}/v0/tokens`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`1Click tokens: ${res.status}`);
  const list = (await res.json()) as IntentsToken[];
  tokenCache = { at: Date.now(), list };
  return list;
}

/** Friendly chain aliases → 1Click `blockchain` ids. */
const CHAIN_ALIASES: Record<string, string> = {
  near: "near", ethereum: "eth", eth: "eth", solana: "sol", sol: "sol", bitcoin: "btc", btc: "btc",
  base: "base", arbitrum: "arb", arb: "arb", polygon: "pol", pol: "pol", matic: "pol", bsc: "bsc",
  bnb: "bsc", avalanche: "avax", avax: "avax", optimism: "op", op: "op", tron: "tron", trx: "tron",
  ton: "ton", doge: "doge", dogecoin: "doge", xrp: "xrp", ripple: "xrp", zcash: "zec", zec: "zec",
  sui: "sui", aptos: "aptos", apt: "aptos", gnosis: "gnosis", berachain: "bera", bera: "bera",
  stellar: "stellar", xlm: "stellar", cardano: "cardano", ada: "cardano", litecoin: "ltc", ltc: "ltc",
};

export function normalizeChain(chain?: string): string | undefined {
  if (!chain) return undefined;
  const c = chain.toLowerCase().trim();
  return CHAIN_ALIASES[c] ?? c;
}

export async function findIntentsToken(symbol: string, chain?: string): Promise<IntentsToken | null> {
  const list = await intentsTokens();
  let sym = symbol.toUpperCase().trim();
  const bc = normalizeChain(chain);
  if (sym === "NEAR" && (!bc || bc === "near")) sym = "WNEAR";
  const matches = list.filter((t) => t.symbol.toUpperCase() === sym && (!bc || t.blockchain === bc));
  if (matches.length) return matches.sort((a, b) => (a.blockchain === "near" ? -1 : b.blockchain === "near" ? 1 : 0))[0];
  return null;
}

export type QuoteInput = {
  originAsset: string;
  destinationAsset: string;
  amount: string; // base units
  recipient: string;
  refundTo: string;
  slippageBps: number;
  dry: boolean;
  /** EXACT_OUTPUT = the recipient gets exactly `amount` (payments); payer's input carries the slippage buffer. */
  swapType?: "EXACT_INPUT" | "EXACT_OUTPUT";
};

export type IntentsQuote = {
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd?: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd?: string;
    minAmountIn?: string;
    minAmountOut: string;
    timeEstimate?: number;
    depositAddress?: string;
    depositMemo?: string;
    deadline?: string;
  };
  signature: string;
  timestamp: string;
  correlationId: string;
};

export async function intentsQuote(q: QuoteInput): Promise<IntentsQuote> {
  const body = {
    dry: q.dry,
    swapType: q.swapType ?? "EXACT_INPUT",
    slippageTolerance: q.slippageBps,
    originAsset: q.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: q.destinationAsset,
    amount: q.amount,
    refundTo: q.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: q.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    referral: "allpilot",
  };
  const res = await fetch(`${BASE}/v0/quote`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`1Click quote failed: ${json?.message ?? res.status}`);
  return json as IntentsQuote;
}

export async function intentsStatus(depositAddress: string, depositMemo?: string) {
  const u = new URL(`${BASE}/v0/status`);
  u.searchParams.set("depositAddress", depositAddress);
  if (depositMemo) u.searchParams.set("depositMemo", depositMemo);
  const res = await fetch(u, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  return res.json();
}

/** Tell 1Click about the deposit tx so it starts sooner (optional per docs). */
export async function intentsSubmitDeposit(txHash: string, depositAddress: string, nearSenderAccount?: string) {
  const res = await fetch(`${BASE}/v0/deposit/submit`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ txHash, depositAddress, ...(nearSenderAccount ? { nearSenderAccount } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  return res.json().catch(() => ({}));
}
