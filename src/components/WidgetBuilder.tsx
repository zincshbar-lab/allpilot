"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { useSearchParams } from "next/navigation";
import { Pip } from "./Pip";
import { useWallet } from "./useWallet";

const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const isNearAccount = (a: string) => a.length >= 2 && a.length <= 64 && NEAR_ACCOUNT.test(a) && (a.includes(".") || /^[0-9a-f]{64}$/.test(a));
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function Code({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-xs font-semibold text-ink-soft">{label}</p>
        <button
          className="btn shrink-0 bg-surface border-2 border-line px-3 py-1 text-xs"
          onClick={() => {
            navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="rounded-2xl bg-surface-2 border-2 border-line p-3 text-[11px] leading-relaxed overflow-x-auto whitespace-pre"><code>{code}</code></pre>
    </div>
  );
}

/** Store setup for the universal checkout: the merchant sets a NEAR account; each order passes its cart total. */
export default function WidgetBuilder() {
  const sp = useSearchParams();
  const wallet = useWallet();
  const [merchant, setMerchant] = useState((sp.get("merchant") ?? sp.get("to") ?? "").toLowerCase());
  const [currency, setCurrency] = useState<"USD" | "NEAR">(sp.get("currency") === "NEAR" ? "NEAR" : "USD");
  const [cart, setCart] = useState("49.50");
  const [origin, setOrigin] = useState("https://allpilot.vercel.app");
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setOrigin(window.location.origin), 0);
    const onEv = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      const bits = [e.type.replace("allpilot:", ""), d.status, d.amountNear && `${d.amountNear} NEAR`, d.depositAddress && `deposit ${String(d.depositAddress).slice(0, 10)}…`, d.txHash && `tx ${String(d.txHash).slice(0, 8)}…`, d.error];
      setLog((l) => [bits.filter(Boolean).join(" · "), ...l].slice(0, 8));
    };
    document.addEventListener("allpilot:status", onEv);
    document.addEventListener("allpilot:paid", onEv);
    return () => {
      clearTimeout(t);
      document.removeEventListener("allpilot:status", onEv);
      document.removeEventListener("allpilot:paid", onEv);
    };
  }, []);

  const okMerchant = isNearAccount(merchant);
  const looksForeign = /^0x|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchant) && !okMerchant;
  const unit = currency === "USD" ? "USD" : "NEAR";
  const m = esc(merchant || "yourshop.near");

  const snippet = useMemo(
    () =>
      `<!-- 1. once, anywhere on your site -->\n<script src="${origin}/checkout.js" data-merchant="${m}"${currency === "NEAR" ? ' data-currency="NEAR"' : ""} defer></script>\n\n` +
      `<!-- 2. on your cart / checkout page: your store fills in the total (${unit}) and order id -->\n<button data-allpilot-checkout data-amount="49.50" data-ref="ORDER-1042"></button>`,
    [origin, m, currency, unit],
  );
  const platforms = `<!-- Shopify (cart template / custom liquid) -->
<button data-allpilot-checkout data-amount="{{ cart.total_price | money_without_currency | remove: ',' }}" data-ref="{{ cart.token }}"></button>

<!-- WooCommerce / PHP -->
<button data-allpilot-checkout data-amount="<?php echo WC()->cart->get_total('edit'); ?>" data-ref="<?php echo esc_attr( WC()->session->get_customer_id() ); ?>"></button>

<!-- No template access? Read the total straight from the page -->
<button data-allpilot-checkout data-amount-from="#cart-total"></button>   <!-- "$49.50" works -->

<!-- React / Vue / your own JS -->
<script>
  const r = await Allpilot.checkout({ amount: cart.total, ref: order.id, memo: "Order " + order.id });
  if (r.status === "paid") showThankYou();
</script>`;
  const events = `<script>
  // fires when NEAR Intents settles the payment (or a direct NEAR transfer lands)
  document.addEventListener("allpilot:paid", async (e) => {
    const { ref, amountNear, usd, depositAddress, txHash, sender } = e.detail;
    // tell your server; it confirms with /api/pay/verify before fulfilling order "ref"
    await fetch("/your-api/order-paid", { method: "POST", body: JSON.stringify({ ref, amountNear, usd, depositAddress, txHash, sender }) });
  });
</script>`;
  const verify = `# Paid with any crypto through NEAR Intents:
curl "${origin}/api/pay/verify?deposit=<depositAddress>"
# Paid in NEAR straight from a NEAR wallet:
curl "${origin}/api/pay/verify?tx=<txHash>&sender=<customer.near>"

# → { "paid": true, "recipient": "${m}", "amountFormatted": "14.2301", "token": "nep141:wrap.near" | "near", … }
# Ship only if paid is true, recipient is you, and the NEAR received ≥ the order's amountNear.`;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 flex-1 space-y-5">
      <Script src="/checkout.js" strategy="afterInteractive" />
      <header className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2">
          <Pip size={40} />
          <span className="text-xl font-bold">
            All<span className="text-pink">pilot</span>
          </span>
        </Link>
        <span className="text-ink-soft text-sm">· universal checkout</span>
      </header>

      <section className="card p-5">
        <h1 className="text-2xl font-bold">🛒 Accept crypto on your store</h1>
        <p className="text-ink-soft mt-2 text-sm">
          Set your <b>NEAR account</b> once and paste the code into your site. Each customer pays <b>their cart total</b> with any crypto NEAR Intents supports: a NEAR wallet, MetaMask and
          other EVM wallets, Phantom on Solana, BTC and more through a deposit address. NEAR Intents converts it and <b>NEAR lands in your wallet</b>. No sign-up, no API key, no custody.
        </p>
      </section>

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="card p-5 space-y-3 text-sm">
          <h2 className="font-semibold">1. Where the money lands</h2>
          <label className="block space-y-1">
            <span className="text-xs text-ink-soft">Your NEAR account</span>
            <div className="flex gap-2">
              <input
                value={merchant}
                onChange={(e) => setMerchant(e.target.value.trim().toLowerCase())}
                placeholder="yourshop.near"
                className="flex-1 min-w-0 rounded-xl border-2 border-line bg-surface-2 px-3 py-2 font-mono text-xs"
              />
              {wallet.accountId ? (
                <button className="btn shrink-0 bg-lav-soft border-2 border-line px-3 text-xs" onClick={() => setMerchant(wallet.accountId!)}>
                  Use {wallet.accountId.length > 16 ? "my wallet" : wallet.accountId}
                </button>
              ) : (
                <button className="btn shrink-0 bg-pink text-white px-3 text-xs" onClick={wallet.connect} disabled={!wallet.ready}>
                  Connect wallet
                </button>
              )}
            </div>
          </label>
          {looksForeign && <p className="text-xs text-danger">Merchants receive in NEAR, so use a NEAR account (like yourshop.near). Your customers can still pay from Ethereum, Solana and any other chain.</p>}
          <p className="text-[11px] text-ink-soft">
            You receive NEAR: as wNEAR (wrapped NEAR, always 1:1) when customers pay with other crypto, or plain NEAR when they pay in NEAR.
          </p>
          <label className="block space-y-1">
            <span className="text-xs text-ink-soft">Your store prices in</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value === "NEAR" ? "NEAR" : "USD")} className="w-full rounded-xl border-2 border-line bg-surface-2 px-2 py-2">
              <option value="USD">US dollars, converted to NEAR at checkout</option>
              <option value="NEAR">NEAR</option>
            </select>
          </label>

          <h2 className="font-semibold pt-2">2. Try it like a customer</h2>
          <label className="block space-y-1">
            <span className="text-xs text-ink-soft">A sample cart total ({unit})</span>
            <input value={cart} onChange={(e) => setCart(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="w-40 rounded-xl border-2 border-line bg-surface-2 px-3 py-2" />
          </label>
          {okMerchant ? (
            <div className="flex flex-col items-start gap-2">
              {/* keyed so checkout.js mounts a fresh button when the details change */}
              <button key={`${merchant}|${currency}|${cart}`} data-allpilot-checkout data-to={merchant} data-amount={cart} data-currency={currency} data-ref="preview" data-memo="Sample order" />
              <p className="text-[11px] text-ink-soft">This is the real button. Opening it costs nothing; only paying moves funds, to {merchant}.</p>
            </div>
          ) : (
            <p className="text-xs text-ink-soft">Enter your NEAR account (or connect your wallet) to see the live button.</p>
          )}
          {log.length > 0 && (
            <div className="rounded-2xl bg-surface-2 border-2 border-line p-3">
              <p className="text-xs font-semibold mb-1">Events your site receives</p>
              <ul className="font-mono text-[11px] space-y-0.5">
                {log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card p-5 space-y-4">
          <h2 className="font-semibold text-sm">3. Paste into your site</h2>
          <Code label="Your checkout code" code={snippet} />
          <p className="text-[11px] text-ink-soft">
            The button reads the cart total when it&apos;s clicked, so the same code works for every order. Leave the button empty for the ✨ styled button, or put your own text inside it.
          </p>
        </section>
      </div>

      <section className="card p-5 space-y-4">
        <h2 className="font-semibold">4. Fill in the cart total on your platform</h2>
        <Code label="Shopify, WooCommerce, no-code or your own JS" code={platforms} />
      </section>

      <section className="card p-5 space-y-4">
        <h2 className="font-semibold">5. Know when it&apos;s paid</h2>
        <Code label="Listen in the browser" code={events} />
        <Code label="Confirm on your server before you ship (the total comes from your web page, so check what actually arrived)" code={verify} />
      </section>

      <section className="card p-5 text-sm text-ink-soft space-y-1.5">
        <h2 className="font-semibold text-ink">How it works</h2>
        <p>1. Your site passes the cart total. {currency === "USD" ? "The checkout converts it to NEAR at the live price (rounded up, so you never get less)." : ""}</p>
        <p>2. The customer picks any chain and token they hold. NEAR Intents (1Click) quotes an exact-output payment: you get exactly that NEAR, and the customer&apos;s unused buffer is refunded.</p>
        <p>3. They pay from their own wallet: NEAR wallet, MetaMask, Phantom, or a deposit address from any other wallet.</p>
        <p>4. Solvers deliver NEAR to {okMerchant ? merchant : "your account"}. Your page gets <code>allpilot:paid</code>, and your server confirms with <code>/api/pay/verify</code>. No funds ever pass through Allpilot.</p>
      </section>
    </div>
  );
}
