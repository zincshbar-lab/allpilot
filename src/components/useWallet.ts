"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import type { PlannedTx } from "@/lib/tx";

// Wallet connection via HOT's NEAR Connect (HOT, Meteor, Intear, MyNearWallet, OKX, ...).
export function useWallet() {
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const c = new NearConnector({ network: "mainnet", autoConnect: true });
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
