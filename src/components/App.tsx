"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ActionCard, ChatResponse } from "@/lib/cards";
import { getPolicy, getServerPolicy, savePolicy, subscribePolicy, type GuardPolicy } from "@/lib/guard";
import { ActionCardView } from "./ActionCardView";
import { Pip } from "./Pip";
import { RichText } from "./RichText";
import { useWallet } from "./useWallet";

type Msg = { role: "user" | "assistant"; content: string; cards?: ActionCard[] };

const SUGGESTIONS = [
  { label: "🔄 Swap 1 NEAR → USDC", text: "swap 1 near to usdc" },
  { label: "🌊 Swap on Ref", text: "swap 1 near to usdc on ref" },
  { label: "🦉 Buy HOOT", text: "buy 0.1 near of hoot" },
  { label: "✨ Buy NEARLY", text: "buy 0.1 near of nearly" },
  { label: "🌈 Bridge USDC → Base", text: "bridge 5 usdc from near to base" },
  { label: "🔥 Trending memes", text: "trending memes" },
];

type Trending = {
  verified: { symbol: string; token: string; priceUsd?: number }[];
  freshOnNearly: { symbol: string; name: string; token: string; ageMin: number }[];
};

export default function App() {
  const wallet = useWallet();
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi, I'm Pip! 🦉✨ Tell me what you want to do in plain words. I can swap on NEAR Intents (like near.com), bridge to other chains, and buy memecoins on JustHoot, nearly.trade and Ref. I only suggest — your wallet signs.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"near-ai" | "offline">();
  const policy = useSyncExternalStore(subscribePolicy, getPolicy, getServerPolicy);
  const [showGuard, setShowGuard] = useState(false);
  const [trending, setTrending] = useState<Trending>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // braces matter: newer browsers return a Promise from scrollIntoView
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);
  useEffect(() => {
    fetch("/api/trending", { method: "POST" })
      .then((r) => r.json())
      .then((d) => !d.error && setTrending(d))
      .catch(() => {});
  }, []);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res: ChatResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), accountId: wallet.accountId }),
      }).then((r) => r.json());
      setMode(res.mode);
      setMsgs((m) => [...m, { role: "assistant", content: res.reply, cards: res.cards }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Oops, I lost my map 🙈 Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  const updatePolicy = (p: GuardPolicy) => savePolicy(p);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-6 flex-1 flex flex-col">
      {/* header */}
      <header className="flex items-center gap-3 flex-wrap">
        <Pip size={46} className="bob shrink-0" />
        <div className="mr-auto">
          <h1 className="text-2xl font-bold leading-none tracking-tight">
            All<span className="text-pink">pilot</span>
          </h1>
          <p className="text-xs text-ink-soft mt-1">your cute AI co-pilot for NEAR</p>
        </div>
        <button className="btn bg-surface border-2 border-line px-3 py-2 text-sm" onClick={() => setShowGuard((s) => !s)} aria-expanded={showGuard}>
          🛡️ Guard · {policy.maxNearPerAction} NEAR
        </button>
        {wallet.accountId ? (
          <button className="btn bg-lav-soft border-2 border-line px-3 py-2 text-sm max-w-[220px] truncate" onClick={wallet.disconnect} title="Disconnect">
            👛 {wallet.accountId}
          </button>
        ) : (
          <button className="btn bg-pink text-white px-4 py-2 text-sm" onClick={wallet.connect} disabled={!wallet.ready}>
            Connect wallet
          </button>
        )}
      </header>

      {showGuard && (
        <section className="card pop mt-4 p-4 text-sm">
          <h2 className="font-semibold mb-1">🛡️ Pilot Guard</h2>
          <p className="text-ink-soft mb-3">Hard limits checked in your browser before any wallet prompt. Pip can&apos;t change these.</p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              Max NEAR per action
              <input type="number" min={0.01} step={0.5} value={policy.maxNearPerAction} onChange={(e) => updatePolicy({ ...policy, maxNearPerAction: Number(e.target.value) || 0 })} className="w-24 rounded-xl border-2 border-line bg-surface-2 px-2 py-1" />
            </label>
            <label className="flex items-center gap-2">
              Max USD per action
              <input type="number" min={1} step={5} value={policy.maxUsdPerAction} onChange={(e) => updatePolicy({ ...policy, maxUsdPerAction: Number(e.target.value) || 0 })} className="w-24 rounded-xl border-2 border-line bg-surface-2 px-2 py-1" />
            </label>
          </div>
        </section>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px] flex-1 min-h-0">
        {/* chat */}
        <main className="card flex flex-col min-h-[70dvh] lg:min-h-0 lg:h-[calc(100dvh-140px)]">
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4" aria-live="polite">
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end pop">
                  <p className="max-w-[85%] rounded-3xl rounded-br-md bg-pink text-white px-4 py-2.5 whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              ) : (
                <div key={i} className="flex gap-2.5 pop">
                  <Pip size={34} className="shrink-0 mt-1" mood={m.cards?.length ? "wow" : "happy"} />
                  <div className="min-w-0 flex-1 max-w-[560px]">
                    <p className="inline-block rounded-3xl rounded-tl-md bg-surface-2 border-2 border-line px-4 py-2.5 whitespace-pre-wrap break-words"><RichText text={m.content} /></p>
                    {m.cards?.map((c) => (
                      <ActionCardView key={c.id} card={c} accountId={wallet.accountId} policy={policy} onConnect={wallet.connect} signAndSend={wallet.signAndSend} />
                    ))}
                  </div>
                </div>
              ),
            )}
            {busy && (
              <div className="flex gap-2.5 items-center">
                <Pip size={34} mood="think" className="shrink-0" />
                <p className="typing rounded-3xl bg-surface-2 border-2 border-line px-4 py-2.5 text-ink-soft">
                  Pip is checking the skies<span>.</span><span>.</span><span>.</span>
                </p>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t-2 border-line p-3 sm:p-4">
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
              {SUGGESTIONS.map((s) => (
                <button key={s.text} className="btn shrink-0 bg-surface-2 border-2 border-line px-3 py-1.5 text-xs" onClick={() => send(s.text)} disabled={busy}>
                  {s.label}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder='Try "buy 0.2 near of hoot" or "bridge 10 usdc to solana"'
                className="flex-1 min-w-0 rounded-full border-2 border-line bg-surface-2 px-4 py-3 outline-none focus:border-lav"
                aria-label="Message Pip"
              />
              <button className="btn bg-lav text-white px-5" disabled={busy || !input.trim()} aria-label="Send">
                ✈️
              </button>
            </form>
            <p className="mt-2 text-[11px] text-ink-soft text-center">
              {mode === "offline" ? "Offline brain (simple commands) · add NEAR_AI_API_KEY for full chat" : mode === "near-ai" ? "Brain: NEAR AI Cloud · private inference" : "Brain: NEAR AI Cloud"} · Mainnet · Not financial advice
            </p>
          </div>
        </main>

        {/* side panel */}
        <aside className="space-y-4">
          <section className="card p-4">
            <h2 className="font-semibold mb-2">🐸 Meme garden</h2>
            {!trending && <p className="text-sm text-ink-soft">Picking fresh memes…</p>}
            {trending && (
              <>
                <p className="text-xs text-ink-soft mb-1.5">Verified</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {trending.verified.map((v) => (
                    <button key={v.token} className="btn bg-butter-soft border-2 border-line px-2.5 py-1 text-xs" onClick={() => send(`buy 0.1 near of ${v.token}`)} title={v.token}>
                      ${v.symbol}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-ink-soft mb-1.5">Fresh on nearly.trade</p>
                <ul className="space-y-1.5">
                  {trending.freshOnNearly.map((f) => (
                    <li key={f.token} className="flex items-center gap-2 text-sm">
                      <span className="truncate flex-1" title={f.token}>${f.symbol}</span>
                      <span className="text-[11px] text-ink-soft">{f.ageMin < 120 ? `${f.ageMin}m` : `${Math.round(f.ageMin / 60)}h`}</span>
                      <button className="btn bg-surface-2 border-2 border-line px-2 py-0.5 text-[11px]" onClick={() => send(`buy 0.1 near of ${f.token}`)}>
                        quote
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-ink-soft mt-3">New launches are unverified and very risky.</p>
              </>
            )}
          </section>
          <section className="card p-4 text-sm">
            <h2 className="font-semibold mb-2">How Pip flies</h2>
            <ol className="space-y-1.5 text-ink-soft">
              <li>1. You ask in plain words.</li>
              <li>2. Pip fetches live quotes: NEAR Intents, Rhea, DCL pools.</li>
              <li>3. 🛡️ Pilot Guard checks contracts and limits.</li>
              <li>4. Your wallet signs. Pip never holds keys.</li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
