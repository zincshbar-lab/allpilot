"use client";

import { useEffect, useState } from "react";
import type { ActionCard } from "@/lib/cards";
import { checkCard, type GuardPolicy } from "@/lib/guard";

const VENUE: Record<string, { label: string; cls: string; icon: string }> = {
  "near-intents": { label: "NEAR Intents", cls: "bg-sky-soft", icon: "🌐" },
  rhea: { label: "Rhea · Ref", cls: "bg-mint-soft", icon: "🌊" },
  "rhea-dcl": { label: "Rhea DCL pool", cls: "bg-mint-soft", icon: "🌊" },
  direct: { label: "Direct transfer", cls: "bg-lav-soft", icon: "💸" },
};
const KIND: Record<ActionCard["kind"], { icon: string; tint: string }> = {
  swap: { icon: "🔄", tint: "bg-lav-soft" },
  bridge: { icon: "🌈", tint: "bg-sky-soft" },
  meme: { icon: "🐸", tint: "bg-butter-soft" },
  pay: { icon: "💌", tint: "bg-pink-soft" },
  link: { icon: "🔗", tint: "bg-pink-soft" },
  launch: { icon: "🚀", tint: "bg-butter-soft" },
  lp: { icon: "💧", tint: "bg-mint-soft" },
  info: { icon: "💡", tint: "bg-pink-soft" },
};

type Status = "idle" | "signing" | "sent" | "tracking" | "done" | "failed";

export function ActionCardView({
  card,
  accountId,
  policy,
  onConnect,
  signAndSend,
}: {
  card: ActionCard;
  accountId?: string;
  policy: GuardPolicy;
  onConnect: () => void;
  signAndSend: (txs: ActionCard["transactions"]) => Promise<string[]>;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [hashes, setHashes] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [intentState, setIntentState] = useState<string>();
  const [now, setNow] = useState(0); // 0 until mounted: quotes count as fresh on first paint

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const guard = checkCard(card, policy, accountId, now);
  const external = card.intents?.externalDeposit;
  const signable = card.transactions.length > 0;
  const expired = !!card.expiresAt && now > card.expiresAt;

  // Track NEAR Intents status after signing (or for external deposits).
  useEffect(() => {
    if (!card.intents?.depositAddress) return;
    if (status !== "tracking") return;
    let stop = false;
    const poll = async (first: boolean) => {
      try {
        const r = await fetch("/api/intents-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ depositAddress: card.intents!.depositAddress, depositMemo: card.intents!.depositMemo, txHash: first ? hashes.at(-1) : undefined, sender: accountId }),
        }).then((x) => x.json());
        if (stop) return;
        if (r.status) setIntentState(r.status);
        if (["SUCCESS", "REFUNDED", "FAILED"].includes(r.status)) {
          setStatus(r.status === "SUCCESS" ? "done" : "failed");
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!stop) setTimeout(() => poll(false), 5000);
    };
    poll(true);
    return () => {
      stop = true;
    };
  }, [status, card.intents, hashes, accountId]);

  async function sign() {
    setError(undefined);
    const fresh = checkCard(card, policy, accountId, Date.now()); // re-check at click time
    if (!fresh.ok) {
      setError(fresh.reasons.join(" "));
      return;
    }
    try {
      setStatus("signing");
      const h = await signAndSend(card.transactions);
      setHashes(h);
      if (card.intents?.depositAddress && !external) setStatus("tracking");
      else setStatus("done");
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const kind = KIND[card.kind];
  const venue = card.venue ? VENUE[card.venue] : undefined;

  return (
    <div className="card pop mt-3 overflow-hidden">
      <div className={`flex flex-wrap items-center gap-2 px-4 py-3 ${kind.tint}`}>
        {card.icon ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-uploaded data URL preview
          <img src={card.icon} alt="Token picture" className="w-9 h-9 rounded-full border-2 border-line object-cover bg-surface" />
        ) : (
          <span className="text-xl" aria-hidden>{kind.icon}</span>
        )}
        <h3 className="font-semibold leading-tight flex-1 min-w-[10rem] break-words">{card.title}</h3>
        {venue && (
          <span className={`text-xs font-semibold rounded-full px-2.5 py-1 border-2 border-line ${venue.cls} whitespace-nowrap`}>
            {venue.icon} {venue.label}
          </span>
        )}
      </div>

      <dl className="px-4 py-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {card.lines.map((l) => (
          <div key={l.label} className="contents">
            <dt className="text-ink-soft">{l.label}</dt>
            <dd className={`text-right font-medium ${["Contract", "Recipient", "Pays to", "Token"].includes(l.label) ? "font-mono text-xs break-all" : "break-words"}`}>{l.value}</dd>
          </div>
        ))}
      </dl>

      {card.warnings.length > 0 && (
        <ul className="mx-4 mb-3 rounded-2xl bg-butter-soft px-3 py-2 text-xs space-y-1">
          {card.warnings.map((w) => (
            <li key={w} className="flex gap-1.5"><span aria-hidden>🔔</span><span>{w}</span></li>
          ))}
        </ul>
      )}

      {card.checkout && <CheckoutSnippets checkout={card.checkout} />}

      {external && card.intents && (
        <div className="mx-4 mb-3 rounded-2xl bg-sky-soft px-3 py-3 text-sm">
          <p className="font-semibold mb-1">Send from your {external.chain} wallet</p>
          <p>Send exactly <b>{external.amount} {external.symbol}</b> on <b>{external.chain}</b> to:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 min-w-0 break-all rounded-xl bg-surface px-2 py-1.5 text-xs border-2 border-line">{card.intents.depositAddress}</code>
            <button className="btn bg-surface border-2 border-line px-3 py-1.5 text-xs" onClick={() => navigator.clipboard?.writeText(card.intents!.depositAddress)}>Copy</button>
          </div>
          {card.intents.depositMemo && <p className="mt-1 text-xs">Memo (required): <code>{card.intents.depositMemo}</code></p>}
          <button className="btn mt-3 bg-surface border-2 border-line px-3 py-1.5 text-xs" onClick={() => setStatus("tracking")} disabled={status === "tracking" || status === "done"}>
            I&apos;ve sent it — track it
          </button>
        </div>
      )}

      <div className="px-4 pb-4 flex flex-wrap items-center gap-2">
        {signable && !accountId && (
          <button className="btn bg-pink text-white px-4 py-2" onClick={onConnect}>Connect wallet to sign</button>
        )}
        {signable && accountId && (
          <button
            className="btn bg-pink text-white px-4 py-2"
            onClick={sign}
            disabled={!guard.ok || status === "signing" || status === "tracking" || status === "done" || expired}
          >
            {status === "signing" ? "Waiting for wallet…" : status === "done" || status === "tracking" ? "Signed ✓" : `Sign with wallet (${card.transactions.length} tx)`}
          </button>
        )}
        {!signable && !external && card.needsWallet && (
          <button className="btn bg-pink text-white px-4 py-2" onClick={onConnect}>Connect wallet, then ask again</button>
        )}
        {card.links?.map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="text-xs underline text-ink-soft hover:text-ink">{l.label} ↗</a>
        ))}
      </div>

      {signable && (
        <div className={`mx-4 mb-4 rounded-2xl px-3 py-2 text-xs ${guard.ok ? "bg-mint-soft" : "bg-danger-soft"}`}>
          <b>🛡️ Pilot Guard:</b>{" "}
          {guard.ok ? `checks passed — only known contracts, within your ${policy.maxNearPerAction} NEAR / $${policy.maxUsdPerAction} limits.` : guard.reasons.join(" ")}
        </div>
      )}

      {(status === "tracking" || intentState) && (
        <p className="mx-4 mb-4 text-xs text-ink-soft">NEAR Intents status: <b>{intentState ?? "checking…"}</b></p>
      )}
      {status === "done" && hashes.length > 0 && (
        <p className="mx-4 mb-4 text-xs">
          🎉 Done!{" "}
          {hashes.map((h) => (
            <a key={h} className="underline mr-2" href={`https://nearblocks.io/txns/${h}`} target="_blank" rel="noreferrer">{h.slice(0, 8)}…</a>
          ))}
        </p>
      )}
      {status === "failed" && <p className="mx-4 mb-4 text-xs text-danger">The swap was {intentState?.toLowerCase()} — funds go back to your refund address.</p>}
      {error && <p className="mx-4 mb-4 text-xs text-danger break-words">Wallet said: {error}</p>}
    </div>
  );
}

function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-xs text-ink-soft mb-1">{label}</p>
      <div className="flex items-start gap-2">
        <code className={`flex-1 min-w-0 break-all rounded-xl bg-surface px-2 py-1.5 text-[11px] border-2 border-line max-h-24 overflow-y-auto ${mono ? "font-mono" : ""}`}>{value}</code>
        <button
          className="btn bg-surface border-2 border-line px-3 py-1.5 text-xs shrink-0"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function CheckoutSnippets({ checkout }: { checkout: NonNullable<ActionCard["checkout"]> }) {
  return (
    <div className="mx-4 mb-3 rounded-2xl bg-pink-soft px-3 py-3 space-y-3">
      <CopyRow label="Share this link — the payer picks any token on any chain" value={checkout.url} />
      <CopyRow label="Embed on a website (checkout widget)" value={checkout.iframe} />
      <CopyRow label="…or a “Pay with Intents” button" value={checkout.button} />
    </div>
  );
}
