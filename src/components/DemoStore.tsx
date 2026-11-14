"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Script from "next/script";

const MERCHANT = "allpilot.near";
const PRODUCTS = [
  { id: "pip", name: "Pip Plushie", emoji: "🧸", price: 12.5, blurb: "Soft robot pilot, aviator cap included" },
  { id: "mug", name: "Co-pilot Mug", emoji: "☕", price: 9, blurb: "Holds 350 ml of morning fuel" },
  { id: "cap", name: "Aviator Cap", emoji: "🧢", price: 15, blurb: "Just like Pip's, one size fits all" },
];

/** A small sample store that takes payment through the Allpilot universal checkout (checkout.js). */
export default function DemoStore() {
  const [qty, setQty] = useState<Record<string, number>>({ pip: 1, mug: 0, cap: 0 });
  // order id is made in the browser (a random value on the server would differ and break hydration)
  const [order, setOrder] = useState("PLUSH-0000");
  useEffect(() => {
    const t = setTimeout(() => setOrder(`PLUSH-${Math.floor(1000 + Math.random() * 9000)}`), 0);
    return () => clearTimeout(t);
  }, []);
  const [paid, setPaid] = useState<string>();
  const total = useMemo(() => PRODUCTS.reduce((s, p) => s + p.price * (qty[p.id] ?? 0), 0), [qty]);
  const items = PRODUCTS.reduce((n, p) => n + (qty[p.id] ?? 0), 0);
  const set = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(9, (q[id] ?? 0) + d)) }));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 flex-1">
      {/* the two lines a store adds: the script (with its NEAR account) and a checkout button */}
      <Script
        src="/checkout.js"
        data-merchant={MERCHANT}
        strategy="afterInteractive"
        onLoad={() => {
          document.addEventListener("allpilot:paid", (e) => setPaid(String((e as CustomEvent).detail?.amountNear ?? "")));
        }}
      />
      <header className="flex items-center gap-3 mb-5">
        <span className="text-3xl" aria-hidden>🧸</span>
        <div className="mr-auto">
          <h1 className="text-2xl font-bold leading-none">Pip&apos;s Plushie Shop</h1>
          <p className="text-xs text-ink-soft mt-1">a demo store using the Allpilot universal checkout</p>
        </div>
        <Link href="/checkout-widget" className="text-xs underline text-ink-soft">
          Add this to your store ↗
        </Link>
      </header>

      <div className="grid md:grid-cols-[1fr_320px] gap-5 items-start">
        <section className="grid sm:grid-cols-3 gap-4" aria-label="Products">
          {PRODUCTS.map((p) => (
            <article key={p.id} className="card p-4 flex flex-col">
              <div className="aspect-square rounded-2xl bg-pink-soft grid place-items-center text-6xl" aria-hidden>
                {p.emoji}
              </div>
              <h2 className="font-semibold mt-3">{p.name}</h2>
              <p className="text-xs text-ink-soft">{p.blurb}</p>
              <p className="font-bold mt-2">${p.price.toFixed(2)}</p>
              <div className="mt-3 flex items-center gap-2">
                <button className="btn bg-surface-2 border-2 border-line w-9 h-9" onClick={() => set(p.id, -1)} aria-label={`Remove one ${p.name}`}>
                  −
                </button>
                <span className="w-6 text-center font-semibold" aria-live="polite">{qty[p.id] ?? 0}</span>
                <button className="btn bg-pink text-white w-9 h-9" onClick={() => set(p.id, 1)} aria-label={`Add one ${p.name}`}>
                  +
                </button>
              </div>
            </article>
          ))}
        </section>

        <aside className="card p-5 md:sticky md:top-4" aria-label="Cart">
          <h2 className="font-semibold mb-3">🛒 Your cart</h2>
          <ul className="space-y-1.5 text-sm">
            {PRODUCTS.filter((p) => qty[p.id]).map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  {qty[p.id]} × {p.name}
                </span>
                <span>${(p.price * qty[p.id]).toFixed(2)}</span>
              </li>
            ))}
            {items === 0 && <li className="text-ink-soft">Your cart is empty.</li>}
          </ul>
          <div className="flex justify-between font-bold text-lg border-t-2 border-line mt-3 pt-3">
            <span>Total</span>
            <span id="cart-total">${total.toFixed(2)}</span>
          </div>
          <p className="text-[11px] text-ink-soft mt-1">Order {order}</p>
          <div className="mt-4">
            {total > 0 ? (
              <button data-allpilot-checkout data-amount-from="#cart-total" data-ref={order} data-memo={`Pip's Plushie Shop · ${order}`} className="w-full justify-center" />
            ) : (
              <p className="text-xs text-ink-soft">Add something to check out.</p>
            )}
          </div>
          {paid && <p className="mt-3 rounded-2xl bg-mint-soft px-3 py-2 text-sm font-semibold">🎉 Paid! {paid} NEAR is on its way to the shop.</p>}
          <p className="text-[11px] text-ink-soft mt-4">
            Pay with any crypto: NEAR wallet, MetaMask, Phantom or any wallet via a deposit address. This is a real checkout: payments go to <span className="font-mono">{MERCHANT}</span> in NEAR.
          </p>
        </aside>
      </div>
    </div>
  );
}
