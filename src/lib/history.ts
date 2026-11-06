// On-chain history and holdings via FastNEAR's free public APIs (read-only).
//  • api.fastnear.com/v1/account/{id}/ft  — tokens an account holds
//  • api.fastnear.com/v1/ft/{token}/top   — top holders of a token
//  • tx.main.fastnear.com/v0/account      — every transaction touching an account (oldest-first with desc:false)
//  • tx.main.fastnear.com/v0/transactions — full transaction details by hash

const API = "https://api.fastnear.com";
const TX = "https://tx.main.fastnear.com";
const T = () => AbortSignal.timeout(12_000);

/** fetch with retries — the free APIs rate-limit bursts (429) and occasionally hiccup. */
async function fetchRetry(url: string, init: RequestInit = {}, tries = 4): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, cache: "no-store", signal: T() });
      if (res.status !== 429 && res.status < 500) return res;
      last = new Error(`${url} → ${res.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 400 * 2 ** i + Math.random() * 200));
  }
  throw last instanceof Error ? last : new Error(`${url} failed`);
}

async function post<R>(url: string, body: object): Promise<R> {
  const res = await fetchRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<R>;
}

export async function heldTokens(accountId: string): Promise<{ contract_id: string; balance: string }[]> {
  const res = await fetchRetry(`${API}/v1/account/${accountId}/ft`);
  if (!res.ok) return [];
  const d = (await res.json()) as { tokens?: { contract_id: string; balance: string }[] };
  return (d.tokens ?? []).filter((t) => t.balance && t.balance !== "0");
}

export async function topHolders(tokenId: string): Promise<{ account_id: string; balance: string }[]> {
  const res = await fetchRetry(`${API}/v1/ft/${tokenId}/top`);
  if (!res.ok) return [];
  const d = (await res.json()) as { accounts?: { account_id: string; balance: string }[] };
  return d.accounts ?? [];
}

export type AccountTx = { transaction_hash: string; tx_block_timestamp: string; is_signer: boolean; is_receiver: boolean };

export async function accountTxs(accountId: string, opts: { oldestFirst?: boolean; limit?: number; signerOnly?: boolean } = {}) {
  const d = await post<{ account_txs?: AccountTx[]; txs_count?: number }>(`${TX}/v0/account`, {
    account_id: accountId,
    desc: !opts.oldestFirst,
    limit: opts.limit ?? 1,
    ...(opts.signerOnly ? { is_signer: true } : {}),
  });
  return { txs: d.account_txs ?? [], count: d.txs_count ?? 0 };
}

export type TxAction = { kind: string; method?: string; deposit?: string };
export type TxDetail = { hash: string; signer: string; receiver: string; timestampMs: number; actions: TxAction[] };

export async function txDetails(hashes: string[]): Promise<TxDetail[]> {
  if (!hashes.length) return [];
  type Raw = {
    transaction: { hash: string; signer_id: string; receiver_id: string; actions: (string | Record<string, { method_name?: string; deposit?: string }>)[] };
    execution_outcome?: { block_timestamp?: number | string };
  };
  const out: TxDetail[] = [];
  for (let i = 0; i < hashes.length; i += 20) {
    const d = await post<{ transactions?: Raw[] }>(`${TX}/v0/transactions`, { tx_hashes: hashes.slice(i, i + 20) });
    for (const t of d.transactions ?? []) {
      out.push({
        hash: t.transaction.hash,
        signer: t.transaction.signer_id,
        receiver: t.transaction.receiver_id,
        timestampMs: Number(t.execution_outcome?.block_timestamp ?? 0) / 1e6,
        actions: t.transaction.actions.map((a) => {
          if (typeof a === "string") return { kind: a };
          const [kind, v] = Object.entries(a)[0];
          return { kind, method: v?.method_name, deposit: v?.deposit };
        }),
      });
    }
  }
  return out;
}

/** The first transaction that ever touched an account (for a token: its launch; for a wallet: its creation/funding). */
export async function firstTx(accountId: string): Promise<{ tx: TxDetail | null; timestampMs: number; totalTxs: number }> {
  const { txs, count } = await accountTxs(accountId, { oldestFirst: true, limit: 1 });
  if (!txs[0]) return { tx: null, timestampMs: 0, totalTxs: count };
  const [tx] = await txDetails([txs[0].transaction_hash]);
  return { tx: tx ?? null, timestampMs: Number(txs[0].tx_block_timestamp) / 1e6, totalTxs: count };
}

export function ago(ms: number): string {
  if (!ms) return "unknown";
  const d = (Date.now() - ms) / 86_400_000;
  if (d < 1 / 24) return `${Math.max(1, Math.round(d * 1440))} min`;
  if (d < 1) return `${Math.round(d * 24)} h`;
  if (d < 60) return `${Math.round(d)} days`;
  if (d < 730) return `${Math.round(d / 30.4)} months`;
  return `${(d / 365).toFixed(1)} years`;
}

// ---------------------------------------------------------------- logs (for PnL)

export type TxLogs = { hash: string; signer: string; timestampMs: number; logs: { receiver: string; log: string }[] };

/** Signed transactions of an account, newest first, paging with resume tokens. */
export async function signedTxHashes(accountId: string, max = 300): Promise<{ hash: string; timestampMs: number }[]> {
  const out: { hash: string; timestampMs: number }[] = [];
  let resume: string | undefined;
  while (out.length < max) {
    const d = await post<{ account_txs?: AccountTx[]; resume_token?: string }>(`${TX}/v0/account`, {
      account_id: accountId,
      is_signer: true,
      desc: true,
      limit: Math.min(200, max - out.length),
      ...(resume ? { resume_token: resume } : {}),
    });
    const txs = d.account_txs ?? [];
    out.push(...txs.map((t) => ({ hash: t.transaction_hash, timestampMs: Number(t.tx_block_timestamp) / 1e6 })));
    if (!d.resume_token || txs.length === 0) break;
    resume = d.resume_token;
  }
  return out;
}

export async function txLogs(hashes: string[]): Promise<TxLogs[]> {
  type Raw = {
    transaction: { hash: string; signer_id: string };
    execution_outcome?: { block_timestamp?: number | string };
    receipts?: { receipt?: { receiver_id?: string }; execution_outcome?: { outcome?: { logs?: string[] } } }[];
  };
  const out: TxLogs[] = [];
  const batches: string[][] = [];
  for (let i = 0; i < hashes.length; i += 20) batches.push(hashes.slice(i, i + 20));
  // a few batches at a time — the free API rate-limits bursts
  for (let i = 0; i < batches.length; i += 3) {
    const results = await Promise.all(batches.slice(i, i + 3).map((b) => post<{ transactions?: Raw[] }>(`${TX}/v0/transactions`, { tx_hashes: b }).catch(() => ({ transactions: [] }))));
    for (const d of results)
      for (const t of d.transactions ?? [])
        out.push({
          hash: t.transaction.hash,
          signer: t.transaction.signer_id,
          timestampMs: Number(t.execution_outcome?.block_timestamp ?? 0) / 1e6,
          logs: (t.receipts ?? []).flatMap((r) => (r.execution_outcome?.outcome?.logs ?? []).map((log) => ({ receiver: r.receipt?.receiver_id ?? "", log }))),
        });
  }
  return out;
}
