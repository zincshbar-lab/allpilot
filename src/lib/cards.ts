// The "action card" the AI hands to the UI. The AI only *proposes*; the user reviews the card
// and their own wallet signs. Nothing here holds keys.

import type { PlannedTx } from "./tx";

export type Venue = "near-intents" | "rhea" | "rhea-dcl" | "direct" | "rhea-lending" | "staking";

export type ActionCard = {
  id: string;
  kind: "swap" | "bridge" | "meme" | "pay" | "link" | "launch" | "lp" | "lend" | "stake" | "portfolio" | "analysis" | "pnl" | "share" | "info";
  title: string;
  venue?: Venue;
  launchpad?: "justhoot" | "nearly" | null;
  /** Token picture (data URL) for launch cards. */
  icon?: string;
  lines: { label: string; value: string }[];
  /** Grouped lines (token analysis). */
  sections?: CardSection[];
  /** Token table (portfolio). */
  rows?: { token: string; symbol: string; amount: string; price: string; value: string; badge?: string; note?: string }[];
  /** Per-token profit & loss (pnl). */
  pnlRows?: { token: string; symbol: string; badge?: string; trades: string; invested: string; realized: string; unrealized: string; total: string; roi: string; up: boolean; held: string; unknown?: boolean }[];
  warnings: string[];
  /** NEAR-side transactions for the connected wallet to sign. Empty when it is a quote only. */
  transactions: PlannedTx[];
  /** NEAR (yocto) the transactions attach in total — checked by the Pilot Guard spend limit. */
  nearSpend: string;
  /** USD value of what the user sends, for the guard's USD limit. */
  usdIn?: number;
  /** 1Click: deposit address to track; for inbound bridges the user sends here from another chain. */
  intents?: {
    depositAddress: string;
    depositMemo?: string;
    externalDeposit?: {
      chain: string; // display name
      symbol: string;
      amount: string; // human amount
      /** For paying straight from MetaMask / Phantom: */
      chainCode?: string; // 1Click blockchain id: eth, base, arb, sol, …
      amountBase?: string; // exact amount in the token's smallest unit
      tokenAddress?: string | null; // ERC-20 / SPL mint; null = the chain's native coin
      decimals?: number;
    };
  };
  /** Payments: the recipient the user named. The Pilot Guard allows plain transfers only to this account. */
  payment?: { recipient: string; chain: string; memo?: string };
  /** Shareable image (PnL card): PNG url, share page, X intent. */
  share?: { image: string; page: string; xUrl: string };
  /** Payment links: shareable checkout URL + embed snippets. */
  checkout?: { url: string; iframe: string; button: string };
  needsWallet?: boolean;
  links?: { label: string; href: string }[];
  expiresAt?: number;
};

export type CardSection = { title: string; lines: { label: string; value: string }[] };

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatResponse = { reply: string; cards: ActionCard[]; mode: "near-ai" | "offline" };
