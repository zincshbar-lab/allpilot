"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ActionCard, ChatResponse } from "@/lib/cards";
import { getPolicy, getServerPolicy, savePolicy, subscribePolicy, type GuardPolicy } from "@/lib/guard";
import { ActionCardView } from "./ActionCardView";
import { Pip } from "./Pip";
import { RichText } from "./RichText";
import { QuickActions, type Suggestion } from "./QuickActions";
import { useWallet } from "./useWallet";
import { fileToIcon } from "@/lib/image";
import { useVoice } from "./useVoice";

type Msg = { role: "user" | "assistant"; content: string; cards?: ActionCard[] };

const SUGGESTIONS: Suggestion[] = [
  { label: "🔄 Swap 1 NEAR → USDC", text: "swap 1 near to usdc" },
  { label: "💌 Pay a friend", fill: "pay friend.near 1 usdc", select: "friend.near" },
  { label: "🔗 Payment link", text: "payment link 5 usdc for coffee" },
  { label: "🚀 Launch a token", fill: "launch My Token $TICKER on hoot", select: "My Token $TICKER" },
  { label: "💧 Add liquidity", text: "add lp 1 near and usdc" },
  { label: "✨ Buy NEARLY", text: "buy 0.1 near of nearly" },
  { label: "🌈 Bridge USDC → Base", text: "bridge 5 usdc from near to base" },
  { label: "🌊 Swap on Ref", text: "swap 1 near to usdc on ref" },
  { label: "🔥 Trending memes", text: "trending memes" },
];

const SKILLS: { icon: string; title: string; desc: string; s: Suggestion }[] = [
  { icon: "🔄", title: "Swap", desc: "Best price on NEAR Intents (near.com engine) or Rhea/Ref", s: { label: "", text: "swap 1 near to usdc" } },
  { icon: "🌈", title: "Bridge", desc: "Move tokens between NEAR, Ethereum, Base, Solana, BTC and 20+ chains", s: { label: "", fill: "bridge 5 usdc from near to base 0xYourAddress", select: "0xYourAddress" } },
  { icon: "🐸", title: "Memecoins", desc: "Buy & sell on JustHoot, nearly.trade and Ref, with copycat checks", s: { label: "", text: "buy 0.1 near of hoot" } },
  { icon: "💌", title: "Pay anyone", desc: "They get the exact amount on any chain; you pay with any token", s: { label: "", fill: "pay friend.near 1 usdc with near", select: "friend.near" } },
  { icon: "🔗", title: "Payment links", desc: "A checkout link + website widget. Customers pay from any wallet or chain", s: { label: "", text: "payment link 10 usdc for order 42" } },
  { icon: "🚀", title: "Launch a token", desc: "Create your own memecoin on JustHoot or nearly.trade, with a picture (📎)", s: { label: "", fill: "launch My Token $TICKER on nearly", select: "My Token $TICKER" } },
  { icon: "💧", title: "Add liquidity", desc: "Provide liquidity to Rhea (Ref) pools and earn swap fees", s: { label: "", text: "add lp 1 near and usdc" } },
  { icon: "🏦", title: "Lend & borrow", desc: "Supply to earn interest, borrow against it on Rhea Lending — with your health factor", s: { label: "", fill: "supply 10 usdc", select: "10" } },
  { icon: "👛", title: "Portfolio", desc: "Everything you hold, memes included, with live prices", s: { label: "", text: "my portfolio" } },
  { icon: "📊", title: "My PnL", desc: "Profit & loss on your meme buys and sells, realized and unrealized", s: { label: "", text: "my pnl" } },
  { icon: "🔍", title: "Analyze a token", desc: "Paste any contract: launchpad, creator, wallet age, funder, holders, risks", s: { label: "", fill: "analyze paste-contract-address.near", select: "paste-contract-address.near" } },
  { icon: "🥩", title: "Stake NEAR", desc: "Liquid (LiNEAR, rNEAR, stNEAR) or with a validator", s: { label: "", fill: "stake 5 near with linear", select: "5" } },
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
        "Hi, I'm Pip, your AI co-pilot! 🤖✈️ Tell me what you want to do in plain words. I can swap on NEAR Intents (like near.com), bridge to other chains, buy memecoins on JustHoot, nearly.trade and Ref, pay anyone on any chain, make payment links, launch your own memecoin (📎 to add its picture), add liquidity on Ref, lend & borrow, stake your NEAR, show your portfolio and PnL, and analyze any token you paste. I only suggest — your wallet signs.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"near-ai" | "offline">();
  const policy = useSyncExternalStore(subscribePolicy, getPolicy, getServerPolicy);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const [trending, setTrending] = useState<Trending>();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const voice = useVoice((text) => setInput(text));

  // ?q=… prefills the chat (links from Agent Market deliverables / shared prompts); the user still presses send
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      const t = setTimeout(() => {
        setInput(q.slice(0, 500));
        inputRef.current?.focus();
      }, 0);
      return () => clearTimeout(t);
    }
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [icon, setIcon] = useState<string>();
  const [iconError, setIconError] = useState<string>();

  async function onPickImage(file?: File) {
    setIconError(undefined);
    if (!file) return;
    try {
      setIcon(await fileToIcon(file));
    } catch (e) {
      setIconError(e instanceof Error ? e.message : String(e));
    }
  }

  function applySuggestion(s: Suggestion) {
    if (s.text) return send(s.text);
    if (!s.fill) return;
    setInput(s.fill);
    // focus the box and highlight the part to replace (e.g. the recipient)
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const i = s.select ? s.fill!.indexOf(s.select) : -1;
      if (i >= 0) el.setSelectionRange(i, i + s.select!.length);
    });
  }

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
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), accountId: wallet.accountId, icon }),
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
      <header className="flex items-center gap-2 sm:gap-3">
        <Pip size={46} className="bob shrink-0" />
        <div className="mr-auto min-w-0">
          <h1 className="text-2xl font-bold leading-none tracking-tight">
            All<span className="text-pink">pilot</span>
          </h1>
          <p className="hidden sm:block text-xs text-ink-soft mt-1">your cute AI co-pilot for NEAR</p>
        </div>
        {wallet.accountId ? (
          <button className="btn bg-lav-soft border-2 border-line px-3 py-2 text-sm max-w-[150px] sm:max-w-[240px] truncate shrink" onClick={wallet.disconnect} title={`Connected as ${wallet.accountId} — click to disconnect`}>
            👛 {wallet.accountId}
          </button>
        ) : (
          <button className="btn bg-pink text-white px-3 sm:px-4 py-2 text-sm whitespace-nowrap shrink-0" onClick={wallet.connect} disabled={!wallet.ready}>
            Connect wallet
          </button>
        )}
        <button
          className="btn relative z-50 shrink-0 bg-surface border-2 border-line w-11 h-11 grid place-items-center"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-controls="pip-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </header>


      <div className="mt-4 flex-1 min-h-0 flex">
        {/* chat */}
        <main className="card w-full min-w-0 flex flex-col min-h-[70dvh] lg:min-h-0 lg:h-[calc(100dvh-140px)]">
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
                    {i === 0 && <QuickActions onPick={applySuggestion} disabled={busy} />}
                    {m.cards?.map((c) => (
                      <ActionCardView key={c.id} card={c} accountId={wallet.accountId} policy={policy} onConnect={wallet.connect} signAndSend={wallet.signAndSend} onAsk={send} />
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
            <div className={`flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 ${msgs.length > 1 ? "" : "hidden"}`}>
              {SUGGESTIONS.map((s) => (
                <button key={s.label} className="btn shrink-0 bg-surface-2 border-2 border-line px-3 py-1.5 text-xs" onClick={() => applySuggestion(s)} disabled={busy}>
                  {s.label}
                </button>
              ))}
            </div>
            {voice.error && <p className="mb-2 text-xs text-danger">{voice.error}</p>}
            {voice.listening && <p className="mb-2 text-xs text-ink-soft">🎤 Listening… speak in any language, then check the text and press send.</p>}
            {(icon || iconError) && (
              <div className="flex items-center gap-2 mb-2 text-xs">
                {icon && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
                    <img src={icon} alt="Token picture" className="w-8 h-8 rounded-full border-2 border-line object-cover" />
                    <span className="text-ink-soft">Token picture ready — it&apos;ll be used for your next launch</span>
                    <button type="button" className="underline text-ink-soft hover:text-ink" onClick={() => setIcon(undefined)}>remove</button>
                  </>
                )}
                {iconError && <span className="text-danger">{iconError}</span>}
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  onPickImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button type="button" className="btn bg-surface-2 border-2 border-line px-3" onClick={() => fileRef.current?.click()} aria-label="Upload token picture" title="Upload a token picture">
                📎
              </button>
              {voice.supported && (
                <button
                  type="button"
                  className={`btn border-2 border-line px-3 ${voice.listening ? "bg-pink text-white animate-pulse" : "bg-surface-2"}`}
                  onClick={() => (voice.listening ? voice.stop() : voice.start())}
                  aria-label={voice.listening ? "Stop voice input" : "Speak your message"}
                  aria-pressed={voice.listening}
                  title="Talk to Pip (any language)"
                >
                  🎤
                </button>
              )}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder='Type or 🎤 talk — any language. Try "buy 0.2 near of hoot"'
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

      </div>

      {/* ☰ menu: Guard, skills, meme garden, how it works */}
      {menuOpen && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/30 backdrop-blur-[2px] cursor-default" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
        <aside id="pip-menu" className="pop absolute right-0 top-0 h-full w-full max-w-[380px] overflow-y-auto bg-bg border-l-2 border-line p-4 pt-20 space-y-4 shadow-2xl">
          <section className="card p-4 text-sm">
            <h2 className="font-semibold mb-1">🛡️ Pilot Guard</h2>
            <p className="text-ink-soft mb-3">Hard limits checked in your browser before any wallet prompt. Pip can&apos;t change these.</p>
            <div className="flex flex-col gap-3">
              <label className="flex items-center justify-between gap-2">
                Max NEAR per action
                <input type="number" min={0.01} step={0.5} value={policy.maxNearPerAction} onChange={(e) => updatePolicy({ ...policy, maxNearPerAction: Number(e.target.value) || 0 })} className="w-24 rounded-xl border-2 border-line bg-surface-2 px-2 py-1" />
              </label>
              <label className="flex items-center justify-between gap-2">
                Max USD per action
                <input type="number" min={1} step={5} value={policy.maxUsdPerAction} onChange={(e) => updatePolicy({ ...policy, maxUsdPerAction: Number(e.target.value) || 0 })} className="w-24 rounded-xl border-2 border-line bg-surface-2 px-2 py-1" />
              </label>
            </div>
          </section>
          <section className="card p-4">
            <h2 className="font-semibold mb-2">✨ What Pip can do</h2>
            <ul className="space-y-1">
              {SKILLS.map((k) => (
                <li key={k.title}>
                  <button className="w-full text-left rounded-2xl px-2 py-1.5 hover:bg-surface-2 transition-colors disabled:opacity-50" onClick={() => { setMenuOpen(false); applySuggestion(k.s); }} disabled={busy}>
                    <span className="text-sm font-semibold">{k.icon} {k.title}</span>
                    <span className="block text-xs text-ink-soft">{k.desc}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="card p-4">
            <h2 className="font-semibold mb-2">🐸 Meme garden</h2>
            {!trending && <p className="text-sm text-ink-soft">Picking fresh memes…</p>}
            {trending && (
              <>
                <p className="text-xs text-ink-soft mb-1.5">Verified</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {trending.verified.map((v) => (
                    <button key={v.token} className="btn bg-butter-soft border-2 border-line px-2.5 py-1 text-xs" onClick={() => { setMenuOpen(false); send(`buy 0.1 near of ${v.token}`); }} title={v.token}>
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
                      <button className="btn bg-surface-2 border-2 border-line px-2 py-0.5 text-[11px]" onClick={() => { setMenuOpen(false); send(`buy 0.1 near of ${f.token}`); }}>
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
      )}
    </div>
  );
}
