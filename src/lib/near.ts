// Minimal NEAR JSON-RPC helpers (mainnet, read-only). No keys ever live here.

const RPC_URLS = (process.env.NEAR_RPC_URLS ?? "https://free.rpc.fastnear.com,https://rpc.shitzuapes.xyz,https://near.drpc.org")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const WRAP_NEAR = "wrap.near";
export const RHEA_V2 = "v2.ref-finance.near";
export const RHEA_DCL = "dclv2.ref-labs.near";
export const NEARLY_LAUNCHPAD = "nearlytrade.near";

export const TGAS = 1_000_000_000_000n;
export const ONE_YOCTO = "1";

async function rpc<T>(method: string, params: unknown): Promise<T> {
  let lastErr: unknown;
  for (const url of [...RPC_URLS, ...RPC_URLS]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "allpilot", method, params }),
        cache: "no-store",
      });
      const json = await res.json();
      if (json.error) {
        const err = JSON.stringify(json.error).slice(0, 300);
        // Contract-level errors are real answers; rate limits and node errors mean "try the next RPC".
        if (/MethodNotFound|GuestPanic|does not exist|UNKNOWN_ACCOUNT|CodeDoesNotExist/i.test(err)) throw Object.assign(new Error(err), { final: true });
        throw new Error(err);
      }
      return json.result as T;
    } catch (e) {
      if ((e as { final?: boolean }).final) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("NEAR RPC failed");
}

export async function view<T = unknown>(accountId: string, method: string, args: object = {}): Promise<T> {
  const result = await rpc<{ result?: number[]; error?: string }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  if (!result.result) throw new Error(result.error ?? `view ${accountId}.${method} failed`);
  return JSON.parse(Buffer.from(result.result).toString()) as T;
}

export async function getNativeBalance(accountId: string): Promise<string> {
  const r = await rpc<{ amount: string; locked: string; storage_usage: number }>("query", {
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  });
  // Keep ~0.05 NEAR for storage/gas; report available (spendable) amount.
  const storage = BigInt(r.storage_usage) * 10n ** 19n;
  const available = BigInt(r.amount) - storage;
  return (available > 0n ? available : 0n).toString();
}

export type FtMetadata = { symbol: string; name: string; decimals: number; icon?: string | null };
const metaCache = new Map<string, FtMetadata>();

export async function ftMetadata(tokenId: string): Promise<FtMetadata> {
  if (tokenId === "near") return { symbol: "NEAR", name: "NEAR", decimals: 24 };
  const hit = metaCache.get(tokenId);
  if (hit) return hit;
  const m = await view<FtMetadata>(tokenId, "ft_metadata");
  const meta = { symbol: m.symbol, name: m.name, decimals: m.decimals, icon: m.icon ?? null };
  metaCache.set(tokenId, meta);
  return meta;
}

export async function ftBalance(tokenId: string, accountId: string): Promise<string> {
  try {
    return await view<string>(tokenId, "ft_balance_of", { account_id: accountId });
  } catch {
    return "0";
  }
}

/** Returns the storage deposit (yocto) the account still needs on a token contract, or null if registered. */
export async function storageNeeded(tokenId: string, accountId: string): Promise<string | null> {
  try {
    const bal = await view<unknown>(tokenId, "storage_balance_of", { account_id: accountId });
    if (bal) return null;
  } catch {
    // Some tokens do not implement storage management; assume registered.
    return null;
  }
  try {
    const bounds = await view<{ min: string }>(tokenId, "storage_balance_bounds");
    return bounds.min;
  } catch {
    return "1250000000000000000000"; // 0.00125 NEAR, the common NEP-145 minimum
  }
}

// ---------- unit helpers ----------

export function toBase(amount: string | number, decimals: number): string {
  const s = String(amount).trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") throw new Error(`Invalid amount: ${amount}`);
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const v = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  return v.toString();
}

export function fromBase(amount: string | bigint, decimals: number, maxFrac = 6): string {
  const v = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  if (whole === 0n && frac === "" && v > 0n) {
    // tiny amounts: show significant digits instead of 0
    const full = (v % base).toString().padStart(decimals, "0");
    const firstNz = full.search(/[1-9]/);
    frac = full.slice(0, firstNz + 3).replace(/0+$/, "");
  }
  return frac ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
}

export function isNearAccountId(s: string): boolean {
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s) && s.length >= 2 && s.length <= 64;
}
