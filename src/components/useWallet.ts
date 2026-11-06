"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NearConnector, WalletManifest } from "@hot-labs/near-connect";
import bundledManifest from "@/lib/wallet-manifest.json";
import type { PlannedTx } from "@/lib/tx";

type Manifest = { version: string; wallets: WalletManifest[] };

const MANIFEST_URLS = [
  "https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/manifest.json",
  "https://cdn.jsdelivr.net/gh/hot-dao/near-selector@main/repository/manifest.json",
];

/**
 * The wallet list (HOT, Meteor, Intear, Ledger, MyNearWallet, OKX, Nightly, Hana, Trezu, NEAR Mobile, EVM wallets…).
 * Try the live list briefly; if it's slow or blocked, use the copy bundled with the app. Without this, a failed
 * download leaves the picker with only browser-injected wallets (often just HOT).
 */
async function loadWalletManifest(): Promise<Manifest> {
  for (const url of MANIFEST_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3500), cache: "no-store" });
      if (!res.ok) continue;
      const live = (await res.json()) as Manifest;
      if (Array.isArray(live.wallets) && live.wallets.length >= bundledManifest.wallets.length - 2) return live;
    } catch {
      /* try next */
    }
  }
  return bundledManifest as unknown as Manifest; // JSON platform field is an object; the library only reads it
}

// Wallet connection via HOT's NEAR Connect (HOT, Meteor, Intear, MyNearWallet, OKX, ...).
export function useWallet() {
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const c = new NearConnector({ network: "mainnet", autoConnect: true, manifest: await loadWalletManifest() });
      connector.current = c;
      c.on("wallet:signIn", (e) => alive && setAccountId(e.accounts[0]?.accountId));
      c.on("wallet:signOut", () => alive && setAccountId(undefined));
      try {
        const existing = await c.getConnectedWallet();
        if (alive && existing?.accounts?.[0]) setAccountId(existing.accounts[0].accountId);
      } catch {
        /* not connected */
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async () => {
    await connector.current?.connect();
  }, []);

  const disconnect = useCallback(async () => {
    await connector.current?.disconnect();
    setAccountId(undefined);
  }, []);

  const signAndSend = useCallback(async (transactions: PlannedTx[]) => {
    const c = connector.current;
    if (!c) throw new Error("Wallet not ready");
    const wallet = await c.wallet();
    const outcomes = await wallet.signAndSendTransactions({ network: "mainnet", transactions });
    return (outcomes ?? []).map((o) => (o as { transaction?: { hash?: string } })?.transaction?.hash).filter(Boolean) as string[];
  }, []);

  return { accountId, ready, connect, disconnect, signAndSend };
}
