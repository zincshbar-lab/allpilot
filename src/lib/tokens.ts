// Token resolver: turns "HOOT", "usdc" or a contract id into a concrete NEAR token,
// ranks lookalikes by real wNEAR trading volume, and flags copycats.

import { dclPoolDetail, dclPools, launchpadOf } from "./dcl";
import { WRAP_NEAR, ftMetadata } from "./near";

/** Hand-checked contracts. Symbols on NEAR are not unique, so these win ties. */
export const VERIFIED: Record<string, string> = {
  NEAR: "near",
  WNEAR: WRAP_NEAR,
  USDC: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  USDT: "usdt.tether-token.near",
  REF: "token.v2.ref-finance.near",
  RHEA: "token.rhealab.near",
  HOOT: "hoot-8ecf65.launchpad.justhoot.near",
  NEARLY: "nearly-993927.nearlytrade.near",
  BLACKDRAGON: "blackdragon.tkn.near",
  SHITZU: "token.0xshitzu.near",
  HOT: "hot.tkn.near",
  AURORA: "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near",
};
const VERIFIED_IDS = new Set(Object.values(VERIFIED));

type PriceEntry = { price: string; symbol: string; decimal: number };
let priceCache: { at: number; map: Record<string, PriceEntry> } | null = null;

export async function rheaPrices(): Promise<Record<string, PriceEntry>> {
  if (priceCache && Date.now() - priceCache.at < 5 * 60_000) return priceCache.map;
  const res = await fetch("https://api.ref.finance/list-token-price", { cache: "no-store" });
  const map = (await res.json()) as Record<string, PriceEntry>;
  priceCache = { at: Date.now(), map };
  return map;
}

export type TokenInfo = {
  id: string; // contract id, or "near" for native NEAR
  symbol: string;
  name?: string;
  decimals: number;
  priceUsd?: number;
  launchpad: "justhoot" | "nearly" | null;
  verified: boolean;
  wnearVolume?: string; // lifetime wNEAR swapped in via the DCL wNEAR pool (yocto)
};

export type Resolution = { best: TokenInfo | null; candidates: TokenInfo[]; lookalikes: number };

const looksLikeContract = (q: string) => q.includes(".") || /^[0-9a-f]{64}$/.test(q);

async function info(id: string, prices: Record<string, PriceEntry>): Promise<TokenInfo | null> {
  try {
    const meta = await ftMetadata(id);
    const p = prices[id === "near" ? WRAP_NEAR : id];
    return {
      id,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
      priceUsd: p ? Number(p.price) : undefined,
      launchpad: launchpadOf(id),
      verified: VERIFIED_IDS.has(id),
    };
  } catch {
    return null;
  }
}

async function wnearVolume(tokenId: string): Promise<bigint> {
  const pools = await dclPools();
  const pool = pools.find(
    (p) => (p.token_x === tokenId && p.token_y === WRAP_NEAR) || (p.token_y === tokenId && p.token_x === WRAP_NEAR),
  );
  if (!pool) return 0n;
  const d = await dclPoolDetail(pool.pool_id);
  if (!d) return 0n;
  return BigInt(pool.token_x === WRAP_NEAR ? d.volume_x_in : d.volume_y_in);
}

export async function resolveToken(query: string, opts: { memeOnly?: boolean } = {}): Promise<Resolution> {
  const q = query.trim().replace(/^\$/, "");
  const prices = await rheaPrices();

  if (looksLikeContract(q.toLowerCase())) {
    const t = await info(q.toLowerCase(), prices);
    return { best: t, candidates: t ? [t] : [], lookalikes: 0 };
  }

  const sym = q.toUpperCase();
  if (sym === "NEAR") {
    return { best: { id: "near", symbol: "NEAR", name: "NEAR", decimals: 24, launchpad: null, verified: true, priceUsd: Number(prices[WRAP_NEAR]?.price ?? 0) || undefined }, candidates: [], lookalikes: 0 };
  }

  const ids = new Set<string>();
  if (VERIFIED[sym]) ids.add(VERIFIED[sym]);
  for (const [id, p] of Object.entries(prices)) if (p.symbol?.toUpperCase() === sym) ids.add(id);
  let list = (await Promise.all([...ids].slice(0, 30).map((id) => info(id, prices)))).filter(Boolean) as TokenInfo[];
  if (opts.memeOnly) list = list.filter((t) => t.launchpad || t.verified);
  if (!list.length) return { best: null, candidates: [], lookalikes: 0 };

  // Verified symbol: no need to rank lookalikes by volume (saves loading the pool index).
  const verified = list.find((t) => t.verified);
  if (verified) return { best: verified, candidates: [verified, ...list.filter((t) => t !== verified).slice(0, 5)], lookalikes: list.length - 1 };

  // Otherwise rank by real wNEAR volume through each token's DCL pool.
  await Promise.all(
    list.map(async (t) => {
      if (t.launchpad) t.wnearVolume = (await wnearVolume(t.id)).toString();
    }),
  );
  list.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    const va = BigInt(a.wnearVolume ?? "0");
    const vb = BigInt(b.wnearVolume ?? "0");
    if (va !== vb) return vb > va ? 1 : -1;
    return (b.priceUsd ?? 0) - (a.priceUsd ?? 0);
  });
  return { best: list[0], candidates: list.slice(0, 6), lookalikes: Math.max(0, list.length - 1) };
}
