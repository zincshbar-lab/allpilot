// The "action card" the AI hands to the UI. The AI only *proposes*; the user reviews the card
// and their own wallet signs. Nothing here holds keys.

import type { PlannedTx } from "./tx";

export type Venue = "near-intents" | "rhea" | "rhea-dcl";

export type ActionCard = {
  id: string;
  kind: "swap" | "bridge" | "meme" | "info";
  title: string;
  venue?: Venue;
  launchpad?: "justhoot" | "nearly" | null;
  lines: { label: string; value: string }[];
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
    externalDeposit?: { chain: string; symbol: string; amount: string };
  };
  needsWallet?: boolean;
  links?: { label: string; href: string }[];
  expiresAt?: number;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatResponse = { reply: string; cards: ActionCard[]; mode: "near-ai" | "offline" };
