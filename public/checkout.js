/*!
 * Allpilot universal checkout · "Pay with Intents" · MIT
 * A crypto checkout button for any store. The merchant sets only a NEAR account; each customer
 * pays their cart total with any crypto NEAR Intents supports (NEAR wallet, MetaMask & other EVM
 * wallets, Phantom/Solana, BTC and more via a deposit address). The merchant receives NEAR.
 *
 *   <script src="https://allpilot.vercel.app/checkout.js" data-merchant="yourshop.near" defer></script>
 *   <!-- your store fills in the cart total (USD by default) and order id -->
 *   <button data-allpilot-checkout data-amount="49.50" data-ref="1042"></button>
 *
 * Amount options on the button: data-amount="49.50" · data-currency="USD" (default) or "NEAR"
 *   · data-amount-from="#cart-total" reads the total from an element on the page ("$49.50" works).
 * Events (on the button and on document):
 *   allpilot:status  detail = { status, ref, amountNear?, usd?, depositAddress?, txHash?, ... }
 *   allpilot:paid    detail = { status: "paid", ref, amountNear, usd?, depositAddress?, txHash?, sender? }
 * JS: Allpilot.checkout({ amount, currency?, ref?, memo? }) → Promise<{ status: "paid" | "closed", ... }>
 * Always confirm on your server: GET <origin>/api/pay/verify?deposit=… or ?tx=…&sender=…
 */
(function () {
  "use strict";
  if (window.Allpilot && window.Allpilot.checkout) return;

  var me = document.currentScript;
  var NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
  var MERCHANT = me && me.dataset ? (me.dataset.merchant || "").trim().toLowerCase() : "";
  var CURRENCY = me && me.dataset && me.dataset.currency ? me.dataset.currency.toUpperCase() : "USD";
  function isNearAccount(a) { return !!a && a.length >= 2 && a.length <= 64 && NEAR_ACCOUNT.test(a) && (/\./.test(a) || /^[0-9a-f]{64}$/.test(a)); }
  var ORIGIN = (function () {
    try { return new URL(me && me.src ? me.src : "https://allpilot.vercel.app/checkout.js").origin; } catch (_) { return "https://allpilot.vercel.app"; }
  })();

  var CSS =
    ".apc-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:12px 22px;border-radius:999px;" +
    "background:linear-gradient(135deg,#ff8fb1,#a98bff);color:#fff;font:600 15px/1.2 ui-rounded,'SF Pro Rounded',system-ui,-apple-system,sans-serif;" +
    "box-shadow:0 6px 18px rgba(169,139,255,.35);transition:transform .15s,box-shadow .15s}" +
    ".apc-btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(169,139,255,.45)}.apc-btn:focus-visible{outline:3px solid #3b2f4a;outline-offset:2px}" +
    ".apc-btn small{opacity:.85;font-weight:500;font-size:12px}" +
    ".apc-ov{position:fixed;inset:0;z-index:2147483600;background:rgba(30,20,45,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;animation:apc-in .2s ease-out}" +
    ".apc-box{position:relative;width:min(420px,100%);height:min(680px,100%);background:#fff7f0;border-radius:28px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.35);display:flex;flex-direction:column;animation:apc-pop .3s cubic-bezier(.34,1.56,.64,1)}" +
    ".apc-bar{display:flex;align-items:center;gap:8px;padding:10px 12px 10px 18px;font:600 13px system-ui,sans-serif;color:#3b2f4a;border-bottom:2px solid #f3dce6}" +
    ".apc-bar span{margin-right:auto}.apc-bar a{color:#7a6c8a;font-weight:500;text-decoration:underline}" +
    ".apc-x{all:unset;cursor:pointer;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:18px;color:#3b2f4a;background:#fff}" +
    ".apc-x:focus-visible{outline:3px solid #a98bff}" +
    ".apc-box iframe{flex:1;width:100%;border:0;background:#fff7f0}" +
    "@media (max-width:480px){.apc-ov{padding:0}.apc-box{width:100%;height:100%;border-radius:0}}" +
    // the checkout follows the customer's light/dark setting, so the frame does too
    "@media (prefers-color-scheme:dark){.apc-box,.apc-box iframe{background:#1f1a2e}.apc-bar{color:#f6eefe;border-color:#3d3358}" +
    ".apc-bar a{color:#c9bde0}.apc-x{background:#2a2340;color:#f6eefe}}" +
    "@keyframes apc-in{from{opacity:0}}@keyframes apc-pop{from{transform:scale(.92);opacity:0}}";

  function injectCss() {
    if (document.getElementById("apc-style")) return;
    var s = document.createElement("style");
    s.id = "apc-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function emit(target, name, detail) {
    var ev = function () { return new CustomEvent(name, { detail: detail, bubbles: true }); };
    if (target && target !== document) target.dispatchEvent(ev());
    else document.dispatchEvent(ev());
  }

  var open = null; // one checkout at a time

  function checkout(opts, sourceEl) {
    opts = opts || {};
    var to = String(opts.to || MERCHANT).trim().toLowerCase();
    var currency = String(opts.currency || CURRENCY).toUpperCase() === "NEAR" ? "NEAR" : "USD";
    var amount = parseAmount(opts.amount);
    if (!isNearAccount(to)) return fail(sourceEl, "Allpilot checkout: set your NEAR account with data-merchant=\"yourshop.near\" on the script tag.");
    if (!(amount > 0)) return fail(sourceEl, "Allpilot checkout: no cart total. Set data-amount (or data-amount-from) on the button.");
    if (open) open.close("replaced");
    injectCss();

    var qs = new URLSearchParams({ to: to, token: "NEAR", chain: "near", embed: "1", widget: "1" });
    if (currency === "USD") qs.set("usd", String(amount)); else qs.set("amount", String(amount));
    if (opts.memo) qs.set("memo", String(opts.memo).slice(0, 120));
    if (opts.ref) qs.set("ref", String(opts.ref).slice(0, 80));
    var url = ORIGIN + "/pay?" + qs.toString();
    var full = url.replace("&embed=1&widget=1", "");

    var ov = document.createElement("div");
    ov.className = "apc-ov";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Pay with Intents");
    ov.innerHTML =
      '<div class="apc-box"><div class="apc-bar"><span>💌 Pay with Intents</span>' +
      '<a target="_blank" rel="noopener">Open in new tab ↗</a><button class="apc-x" aria-label="Close checkout">✕</button></div>' +
      '<iframe title="Pay with Intents checkout" allow="clipboard-write"></iframe></div>';
    var frame = ov.querySelector("iframe");
    ov.querySelector("a").href = full;
    frame.src = url;
    var lastFocus = document.activeElement;
    document.body.appendChild(ov);
    var prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    ov.querySelector(".apc-x").focus();

    return new Promise(function (resolve) {
      var state = { status: "open", ref: opts.ref };
      function onMsg(e) {
        if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
        var d = e.data;
        if (!d || d.source !== "allpilot-checkout") return;
        for (var k in d) if (k !== "source" && k !== "type") state[k] = d[k];
        state.ref = opts.ref;
        emit(sourceEl, "allpilot:status", Object.assign({}, state));
        if (typeof opts.onStatus === "function") opts.onStatus(Object.assign({}, state));
        if (d.type === "paid") {
          state.status = "paid";
          emit(sourceEl, "allpilot:paid", Object.assign({}, state));
          if (typeof opts.onSuccess === "function") opts.onSuccess(Object.assign({}, state));
        }
      }
      function onKey(e) { if (e.key === "Escape") close("closed"); }
      function close(why) {
        window.removeEventListener("message", onMsg);
        document.removeEventListener("keydown", onKey);
        ov.remove();
        document.documentElement.style.overflow = prevOverflow;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        open = null;
        var result = Object.assign({}, state, { status: state.status === "paid" ? "paid" : why });
        if (result.status !== "paid" && typeof opts.onClose === "function") opts.onClose(result);
        resolve(result);
      }
      window.addEventListener("message", onMsg);
      document.addEventListener("keydown", onKey);
      ov.addEventListener("click", function (e) { if (e.target === ov) close("closed"); });
      ov.querySelector(".apc-x").addEventListener("click", function () { close("closed"); });
      open = { close: close };
    });
  }

  function parseAmount(v) {
    if (typeof v === "number") return v;
    var m = String(v == null ? "" : v).replace(/,/g, "").match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  }
  function fail(el, msg) {
    if (window.console) console.warn(msg);
    emit(el, "allpilot:status", { status: "error", error: msg });
    return Promise.reject(new Error(msg));
  }
  // the amount is read at click time, so it always matches the cart right now
  function optsFrom(el) {
    var d = el.dataset;
    var amount = d.amount;
    if (d.amountFrom) {
      var src = document.querySelector(d.amountFrom);
      if (src) amount = "value" in src && src.value !== undefined && src.tagName !== "BUTTON" ? src.value : src.textContent;
    }
    return { to: d.to, amount: amount, currency: d.currency, memo: d.memo, ref: d.ref };
  }
  function labelFor(el) {
    var o = optsFrom(el);
    var a = parseAmount(o.amount);
    var cur = String(o.currency || CURRENCY).toUpperCase() === "NEAR" ? "NEAR" : "USD";
    if (!(a > 0)) return "Pay with crypto";
    return cur === "USD" ? "Pay $" + a.toFixed(2) + " with crypto" : "Pay " + a + " NEAR";
  }

  function mount(el) {
    if (el.__apc) return;
    el.__apc = true;
    if (!el.textContent.trim() && !el.children.length && el.dataset.style !== "none") {
      injectCss();
      el.classList.add("apc-btn");
      el.innerHTML = "<span aria-hidden=\"true\">✨</span><span></span><small></small>";
      el.children[1].textContent = el.dataset.label || labelFor(el);
      el.children[2].textContent = "any wallet · any chain";
      // keep the label in step with the cart (data-amount changes, or the watched total changes)
      var refresh = function () { if (!el.dataset.label) el.children[1].textContent = labelFor(el); };
      new MutationObserver(refresh).observe(el, { attributes: true, attributeFilter: ["data-amount", "data-currency"] });
      if (el.dataset.amountFrom) {
        var src = document.querySelector(el.dataset.amountFrom);
        if (src) { new MutationObserver(refresh).observe(src, { characterData: true, childList: true, subtree: true }); src.addEventListener("input", refresh); }
      }
      if (el.tagName !== "BUTTON") { el.setAttribute("role", "button"); el.tabIndex = 0; }
    }
    if (el.tagName === "BUTTON" && !el.getAttribute("type")) el.setAttribute("type", "button");
    var go = function (e) { e.preventDefault(); checkout(optsFrom(el), el); };
    el.addEventListener("click", go);
    el.addEventListener("keydown", function (e) { if (el.tagName !== "BUTTON" && (e.key === "Enter" || e.key === " ")) go(e); });
  }

  function scan(root) {
    if (!root.querySelectorAll) return;
    if (root.matches && root.matches("[data-allpilot-checkout]")) mount(root);
    root.querySelectorAll("[data-allpilot-checkout]").forEach(mount);
  }

  function start() {
    scan(document);
    new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); }); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.Allpilot = Object.assign(window.Allpilot || {}, { checkout: function (o) { return checkout(o, null); }, origin: ORIGIN, merchant: MERCHANT, version: "2" });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
