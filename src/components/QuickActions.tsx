"use client";

import { useState } from "react";

// `text` sends straight away; `fill` drops an editable template into the chat box (for things that need
// a recipient or a name), highlighting `select` so the user can type over it.
export type Suggestion = { label: string; text?: string; fill?: string; select?: string };

type Pill = Suggestion & { icon: keyof typeof ICONS; featured?: boolean };

// Line icons in the same weight, drawn with currentColor so they follow the theme.
const ICONS = {
  rocket: <path d="M5 15c-1.5 1-2 4-2 4s3-.5 4-2m-2-2 4 4m-4-4 3-6c2-4 6-6 10-6 0 4-2 8-6 10l-6 3m6-8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />,
  wallet: <path d="M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2Zm14 6h.01" />,
  fire: <path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s.5 2 2 2c0-3 2-5 2-8Z" />,
  swap: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  pay: <path d="M3 7h18v10H3zM3 11h18M7 15h3" />,
  link: <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />,
  bridge: <path d="M3 17h18M5 17V9m14 8V9M5 9c3 0 4 3 7 3s4-3 7-3M9 17v-4m6 4v-4" />,
  drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  chart: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  bank: <path d="M3 10l9-6 9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" />,
  coins: <path d="M8 8a5 3 0 1 0 0 .01M3 8v4c0 1.7 2.2 3 5 3s5-1.3 5-3V8M11 14.5c.6.3 1.3.5 2 .5 2.8 0 5-1.3 5-3V8m-5 8v4c0 1.7 2.2 3 5 3s5-1.3 5-3v-4" />,
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.3-4.3" />,
  stake: <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4Zm-3 9 2 2 4-4" />,
};

function Icon({ name, className = "" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const MAIN: Pill[] = [
  { icon: "rocket", label: "Launch a token", featured: true, fill: "launch My Token $TICKER on nearly", select: "My Token $TICKER" },
  { icon: "wallet", label: "Portfolio", text: "my portfolio" },
  { icon: "chart", label: "My PnL", text: "my pnl" },
  { icon: "trend", label: "Earn yield", text: "where can I earn yield on NEAR and USDC? compare staking and lending rates" },
  { icon: "swap", label: "Swap", text: "swap 1 near to usdc" },
  { icon: "pay", label: "Pay a friend", fill: "pay friend.near 1 usdc", select: "friend.near" },
];

const MORE: Pill[] = [
  { icon: "search", label: "Analyze a token", fill: "analyze paste-contract-address.near", select: "paste-contract-address.near" },
  { icon: "stake", label: "Stake NEAR", fill: "stake 5 near with linear", select: "5" },
  { icon: "bank", label: "Lend USDC", fill: "supply 10 usdc", select: "10" },
  { icon: "coins", label: "Borrow", fill: "borrow 5 usdc", select: "5" },
  { icon: "fire", label: "Trending memes", text: "trending memes" },
  { icon: "link", label: "Payment link", text: "payment link 5 usdc for coffee" },
  { icon: "bridge", label: "USDC → Base", text: "bridge 5 usdc from near to base" },
  { icon: "drop", label: "Add liquidity", text: "add lp 1 near and usdc" },
  { icon: "swap", label: "Swap on Ref", text: "swap 1 near to usdc on ref" },
];

export function QuickActions({ onPick, disabled }: { onPick: (s: Suggestion) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const pills = open ? [...MAIN, ...MORE] : MAIN;
  return (
    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick actions">
      {pills.map((p) => (
        <button
          key={p.label}
          onClick={() => onPick(p)}
          disabled={disabled}
          className={`btn pop inline-flex items-center gap-2 border-2 px-4 py-2 text-sm ${
            p.featured ? "bg-butter-soft border-butter font-semibold" : "bg-surface border-line"
          }`}
        >
          <Icon name={p.icon} className={p.featured ? "text-pink" : "text-ink-soft"} />
          {p.label}
        </button>
      ))}
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn inline-flex items-center gap-1.5 border-2 border-line bg-surface px-4 py-2 text-sm text-ink-soft"
        aria-expanded={open}
      >
        <Icon name="chevron" className={`transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Less" : "More"}
      </button>
    </div>
  );
}
