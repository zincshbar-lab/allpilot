"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ActionCard } from "@/lib/cards";
import { getPolicy, getServerPolicy, subscribePolicy } from "@/lib/guard";
import { ActionCardView } from "./ActionCardView";
import { Pip } from "./Pip";
import { useWallet } from "./useWallet";

type Asset = { assetId: string; symbol: string; chain: string; chainName: string; price: number };

/**
 * Universal checkout ("Pay with Intents"). Opened from a payment link or embedded as an iframe.
 * The payee fixed amount + token + chain in the URL; the payer picks what they pay with.
 */
export default function Checkout() {
  const sp = useSearchParams();
  const to = sp.get("to") ?? "";
  const amount = sp.get("amount") ?? "";
  const token = (sp.get("token") ?? "").toUpperCase();
  const chain = sp.get("chain") ?? "near";
  const memo = sp.get("memo") ?? "";
  const embed = sp.get("embed") === "1";

  const wallet = useWallet();
  const policy = useSyncExternalStore(subscribePolicy, getPolicy, getServerPolicy);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [payChain, setPayChain] = useState("near");
  const [paySymbol, setPaySymbol] = useState<string>();
  const [refundTo, setRefundTo] = useState("");
  const [card, setCard] = useState<ActionCard>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/pay/assets", { method: "POST" })
      .then((r) => r.json())
      .then((d) => d.assets && setAssets(d.assets))
      .catch(() => setError("Couldn't load payment options. Refresh to try again."));
  }, []);

  const chains = useMemo(() => {
    const m = new Map<string, string>();
    assets.forEach((a) => m.set(a.chain, a.chainName));
    return [...m.entries()].sort((a, b) => (a[0] === "near" ? -1 : b[0] === "near" ? 1 : a[1].localeCompare(b[1])));
  }, [assets]);
  const tokensOnChain = useMemo(() => assets.filter((a) => a.chain === payChain), [assets, payChain]);
  // default: same token as requested if available on that chain, else the chain's first token
  const symbol = paySymbol && tokensOnChain.some((t) => t.symbol === paySymbol) ? paySymbol : (tokensOnChain.find((t) => t.symbol === token) ?? tokensOnChain[0])?.symbol;
  const selected = tokensOnChain.find((t) => t.symbol === symbol);
  const fromNear = payChain === "near";
  const valid = to && Number(amount) > 0 && token;

  async function quote() {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    setCard(undefined);
    try {
      const r = await fetch("/api/pay/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, amount, token, chain, memo, payWithAssetId: selected.assetId, accountId: wallet.accountId, refundTo }),
      }).then((x) => x.json());
      if (r.error) setError(r.error);
      else setCard(r.card);
    } catch {
      setError("Network hiccup, please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!valid) {
    return (
      <div className="flex-1 grid place-items-center p-4">
        <div className="card p-6 max-w-sm text-center">
          <Pip size={56} mood="think" className="mx-auto" />
          <p className="mt-3 font-semibold">This payment link is incomplete.</p>
          <p className="text-sm text-ink-soft mt-1">Ask the seller for a new link, or make one by chatting with Pip on the home page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`mx-auto w-full ${embed ? "max-w-md p-2" : "max-w-md px-4 py-6"} flex-1`}>
      {!embed && (
        <Link href="/" className="flex items-center gap-2 mb-4 w-fit">
          <Pip size={36} />
          <span className="font-bold text-lg">
            All<span className="text-pink">pilot</span>
          </span>
        </Link>
      )}

      <section className="card overflow-hidden">
        <div className="bg-pink-soft px-5 py-4">
          <p className="text-xs font-semibold text-ink-soft">💌 Pay with Intents</p>
          <p className="text-3xl font-bold mt-1 break-words">
            {amount} {token}
          </p>
          <p className="text-sm mt-1 break-all">
            to <span className="font-mono text-xs">{to}</span> on {chains.find((c) => c[0] === chain)?.[1] ?? chain.toUpperCase()}
          </p>
          {memo && <p className="text-sm mt-1">For: {memo}</p>}
        </div>

        <div className="p-5 space-y-3 text-sm">
          <p className="font-semibold">Pay with anything you hold</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs text-ink-soft">Chain</span>
              <select value={payChain} onChange={(e) => { setPayChain(e.target.value); setCard(undefined); }} className="w-full rounded-xl border-2 border-line bg-surface-2 px-2 py-2">
                {chains.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-ink-soft">Token</span>
              <select value={symbol ?? ""} onChange={(e) => { setPaySymbol(e.target.value); setCard(undefined); }} className="w-full rounded-xl border-2 border-line bg-surface-2 px-2 py-2">
                {tokensOnChain.map((t) => (
                  <option key={t.assetId} value={t.symbol}>{t.symbol}</option>
                ))}
              </select>
            </label>
          </div>

          {!fromNear && (
            <label className="block space-y-1">
              <span className="text-xs text-ink-soft">Your {chains.find((c) => c[0] === payChain)?.[1]} address (for refunds)</span>
              <input value={refundTo} onChange={(e) => setRefundTo(e.target.value.trim())} placeholder="Where unused funds go back" className="w-full rounded-xl border-2 border-line bg-surface-2 px-3 py-2 font-mono text-xs" />
            </label>
          )}

          {fromNear && !wallet.accountId ? (
            <button className="btn w-full bg-pink text-white py-3" onClick={wallet.connect} disabled={!wallet.ready}>
              Connect NEAR wallet
            </button>
          ) : (
            <button className="btn w-full bg-lav text-white py-3" onClick={quote} disabled={busy || !selected || (!fromNear && !refundTo)}>
              {busy ? "Finding the best route…" : `Get quote in ${symbol ?? "…"}`}
            </button>
          )}
          {fromNear && wallet.accountId && <p className="text-xs text-ink-soft text-center">Paying from 👛 {wallet.accountId}</p>}
          {error && <p className="text-xs text-danger break-words">{error}</p>}
        </div>
      </section>

      {card && <ActionCardView card={card} accountId={wallet.accountId} policy={policy} onConnect={wallet.connect} signAndSend={wallet.signAndSend} />}

      <p className="mt-4 text-[11px] text-ink-soft text-center">
        Settled by NEAR Intents · the receiver gets exactly {amount} {token} · unused buffer is refunded{embed ? "" : " · Not financial advice"}
      </p>
    </div>
  );
}
