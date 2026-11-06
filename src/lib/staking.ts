// Stake NEAR — liquid staking (keep a tradable token) or native staking with a validator.
//
//  • Liquid:  LiNEAR (linear-protocol.near), Rhea rNEAR (lst.rhealab.near), Meta Pool stNEAR (meta-pool.near)
//             deposit_and_stake() with NEAR attached → you receive the liquid token at the current share price.
//             Unstake instantly by swapping it back to NEAR on Rhea (small spread), no waiting.
//  • Native:  any *.poolv1.near / *.pool.near validator · deposit_and_stake() · unstake(amount) or unstake_all()
//             → withdrawable with withdraw_all() after ~4 epochs (≈2–3 days).

import type { ActionCard } from "./cards";
import { fromBase, ftBalance, getNativeBalance, storageNeeded, toBase, view } from "./near";
import { planRheaSwap } from "./rhea";
import { fc, storageDeposit, totalAttachedNear, type PlannedTx } from "./tx";

const uid = () => Math.random().toString(36).slice(2, 10);
const GAS_RESERVE = 50_000_000_000_000_000_000_000n; // keep 0.05 NEAR for gas

export const LIQUID = {
  linear: { contract: "linear-protocol.near", symbol: "LiNEAR", name: "LiNEAR Protocol", priceMethod: "ft_price" },
  rnear: { contract: "lst.rhealab.near", symbol: "rNEAR", name: "Rhea rNEAR", priceMethod: "ft_price" },
  stnear: { contract: "meta-pool.near", symbol: "stNEAR", name: "Meta Pool", priceMethod: "get_st_near_price" },
} as const;
export type LiquidId = keyof typeof LIQUID;
export const STAKING_CONTRACTS = new Set<string>(Object.values(LIQUID).map((l) => l.contract));
export const isValidatorPool = (id: string) => /^[a-z0-9_-]+\.(poolv1|pool)\.near$/.test(id);
export const POPULAR_VALIDATORS = ["astro-stakers.poolv1.near", "epic.poolv1.near", "zavodil.poolv1.near", "binancenode1.poolv1.near"];

export function normalizeProvider(s?: string): { liquid?: LiquidId; validator?: string } | null {
  const v = (s ?? "").toLowerCase().trim();
  if (!v) return null;
  if (isValidatorPool(v)) return { validator: v };
  if (/linear/.test(v)) return { liquid: "linear" };
  if (/rnear|rhea/.test(v)) return { liquid: "rnear" };
  if (/stnear|meta/.test(v)) return { liquid: "stnear" };
  return null;
}

async function lstPrice(id: LiquidId): Promise<bigint> {
  return BigInt(await view<string>(LIQUID[id].contract, LIQUID[id].priceMethod)); // NEAR (yocto) per 1 token
}

async function validatorInfo(pool: string) {
  const fee = await view<{ numerator: number; denominator: number }>(pool, "get_reward_fee_fraction").catch(() => null);
  if (!fee) throw new Error(`${pool} doesn't look like a staking pool.`);
  const staked = await view<string>(pool, "get_total_staked_balance").catch(() => "0");
  return { feePct: (fee.numerator / fee.denominator) * 100, staked: BigInt(staked) };
}

function card(title: string, rest: Omit<ActionCard, "id" | "kind" | "title" | "nearSpend"> & { transactions: PlannedTx[] }): ActionCard {
  return { id: uid(), kind: "stake", title, ...rest, nearSpend: totalAttachedNear(rest.transactions).toString(), expiresAt: Date.now() + 5 * 60_000 };
}

// ---------------------------------------------------------------- stake

export async function stake(p: { amount: string; provider: string; accountId?: string }): Promise<ActionCard> {
  const prov = normalizeProvider(p.provider);
  if (!prov) throw new Error("Stake where? Liquid: LiNEAR, rNEAR or stNEAR. Native: a validator like astro-stakers.poolv1.near.");
  const amount = BigInt(toBase(p.amount, 24));
  const warnings: string[] = [];
  const transactions: PlannedTx[] = [];
  if (p.accountId) {
    const have = BigInt(await getNativeBalance(p.accountId));
    if (have < amount + GAS_RESERVE) warnings.push(`You have ${fromBase(have, 24, 4)} NEAR available; keep a little for gas.`);
  }

  if (prov.liquid) {
    const l = LIQUID[prov.liquid];
    const price = await lstPrice(prov.liquid);
    const out = (amount * 10n ** 24n) / price;
    if (p.accountId) {
      const need = await storageNeeded(l.contract, p.accountId);
      if (need) transactions.push({ receiverId: l.contract, actions: [storageDeposit(p.accountId, need)] });
      const stakeAction = fc("deposit_and_stake", {}, 200, amount.toString());
      if (transactions[0]) transactions[0].actions.push(stakeAction);
      else transactions.push({ receiverId: l.contract, actions: [stakeAction] });
    }
    return card(`Stake ${p.amount} NEAR → ${l.symbol}`, {
      venue: "staking",
      lines: [
        { label: "Provider", value: `${l.name} (liquid staking)` },
        { label: "You stake", value: `${p.amount} NEAR` },
        { label: "You get (est.)", value: `${fromBase(out, 24)} ${l.symbol}` },
        { label: "Rate", value: `1 ${l.symbol} = ${fromBase(price, 24, 4)} NEAR (rises as rewards accrue)` },
        { label: "Unstake", value: `any time — swap ${l.symbol} back to NEAR instantly` },
      ],
      warnings: [...warnings, `${l.symbol} is a token you can trade, lend on Rhea Lending, or swap back any time.`],
      transactions,
      usdIn: undefined,
      needsWallet: !p.accountId,
      links: [{ label: `${l.symbol} token`, href: `https://nearblocks.io/token/${l.contract}` }],
    });
  }

  const pool = prov.validator!;
  const info = await validatorInfo(pool);
  if (info.feePct > 20) warnings.push(`This validator keeps ${info.feePct.toFixed(0)}% of your rewards — that's very high. Most charge 1–10%.`);
  if (p.accountId) transactions.push({ receiverId: pool, actions: [fc("deposit_and_stake", {}, 125, amount.toString())] });
  return card(`Stake ${p.amount} NEAR with ${pool.split(".")[0]}`, {
    venue: "staking",
    lines: [
      { label: "Validator", value: pool },
      { label: "Validator fee", value: `${info.feePct.toFixed(2)}% of rewards` },
      { label: "Total staked there", value: `${fromBase(info.staked, 24, 0)} NEAR` },
      { label: "You stake", value: `${p.amount} NEAR` },
      { label: "Unstake", value: "takes ~2–3 days (4 epochs), then withdraw" },
    ],
    warnings: [...warnings, "Native staking locks your NEAR: unstaking takes about 2–3 days before you can withdraw."],
    transactions,
    needsWallet: !p.accountId,
    links: [{ label: "Validator", href: `https://nearblocks.io/address/${pool}` }],
  });
}

// ---------------------------------------------------------------- unstake

export async function unstake(p: { provider: string; amount?: string; all?: boolean; accountId?: string }): Promise<ActionCard> {
  const prov = normalizeProvider(p.provider);
  if (!prov) throw new Error("Unstake from where? LiNEAR, rNEAR, stNEAR or a validator pool id.");
  if (!p.accountId) throw new Error("Connect your wallet so I can see your staked balance.");

  if (prov.liquid) {
    const l = LIQUID[prov.liquid];
    const bal = BigInt(await ftBalance(l.contract, p.accountId));
    if (bal === 0n) throw new Error(`You don't hold any ${l.symbol}.`);
    const amount = p.all || !p.amount ? bal : BigInt(toBase(p.amount, 24));
    if (amount > bal) throw new Error(`You only have ${fromBase(bal, 24, 4)} ${l.symbol}.`);
    const plan = await planRheaSwap({ tokenIn: l.contract, tokenOut: "near", amountIn: amount.toString(), slippageBps: 50, accountId: p.accountId });
    if (!plan) throw new Error(`No Rhea route to swap ${l.symbol} back to NEAR right now.`);
    const fair = (amount * (await lstPrice(prov.liquid))) / 10n ** 24n;
    const spread = fair > 0n ? Number(((fair - BigInt(plan.amountOut)) * 10000n) / fair) / 100 : 0;
    return card(`Unstake ${fromBase(amount, 24, 4)} ${l.symbol} → NEAR (instant)`, {
      venue: "rhea",
      lines: [
        { label: "You swap", value: `${fromBase(amount, 24, 4)} ${l.symbol}` },
        { label: "You get (est.)", value: `${fromBase(plan.amountOut, 24)} NEAR` },
        { label: "Minimum", value: `${fromBase(plan.minAmountOut, 24)} NEAR` },
        { label: "Vs. staked value", value: `${spread.toFixed(2)}% below the ${fromBase(fair, 24, 4)} NEAR it's worth` },
        { label: "Route", value: "Rhea swap — no waiting" },
      ],
      warnings: spread > 1 ? [`The instant route costs ${spread.toFixed(2)}%. Native/delayed unstaking avoids that but takes days.`] : [],
      transactions: plan.transactions,
    });
  }

  const pool = prov.validator!;
  const staked = BigInt(await view<string>(pool, "get_account_staked_balance", { account_id: p.accountId }));
  if (staked === 0n) throw new Error(`You have no NEAR staked with ${pool}.`);
  const amount = p.all || !p.amount ? staked : BigInt(toBase(p.amount, 24));
  if (amount > staked) throw new Error(`You only have ${fromBase(staked, 24, 4)} NEAR staked with ${pool}.`);
  const action = amount === staked ? fc("unstake_all", {}, 125) : fc("unstake", { amount: amount.toString() }, 125);
  return card(`Unstake ${fromBase(amount, 24, 4)} NEAR from ${pool.split(".")[0]}`, {
    venue: "staking",
    lines: [
      { label: "Validator", value: pool },
      { label: "Staked now", value: `${fromBase(staked, 24, 4)} NEAR` },
      { label: "You unstake", value: `${fromBase(amount, 24, 4)} NEAR` },
      { label: "Withdrawable", value: "in ~2–3 days — then ask me to “withdraw my unstaked NEAR”" },
    ],
    warnings: ["Unstaked NEAR stops earning rewards right away and unlocks after ~4 epochs."],
    transactions: [{ receiverId: pool, actions: [action] }],
  });
}

export async function withdrawUnstaked(p: { validator: string; accountId?: string }): Promise<ActionCard> {
  const pool = p.validator.toLowerCase();
  if (!isValidatorPool(pool)) throw new Error("Which validator pool? e.g. astro-stakers.poolv1.near");
  if (!p.accountId) throw new Error("Connect your wallet first.");
  const [unstaked, ready] = await Promise.all([
    view<string>(pool, "get_account_unstaked_balance", { account_id: p.accountId }),
    view<boolean>(pool, "is_account_unstaked_balance_available", { account_id: p.accountId }),
  ]);
  if (BigInt(unstaked) === 0n) throw new Error(`Nothing unstaked to withdraw from ${pool}.`);
  if (!ready) throw new Error(`Your ${fromBase(unstaked, 24, 4)} NEAR at ${pool} is still unlocking — try again in a day or two.`);
  return card(`Withdraw ${fromBase(unstaked, 24, 4)} NEAR from ${pool.split(".")[0]}`, {
    venue: "staking",
    lines: [
      { label: "Validator", value: pool },
      { label: "You get", value: `${fromBase(unstaked, 24, 4)} NEAR back in your wallet` },
    ],
    warnings: [],
    transactions: [{ receiverId: pool, actions: [fc("withdraw_all", {}, 125)] }],
  });
}

// ---------------------------------------------------------------- overview

export async function stakingOverview(accountId?: string, extraPools: string[] = []) {
  const liquid = await Promise.all(
    (Object.keys(LIQUID) as LiquidId[]).map(async (id) => {
      const price = await lstPrice(id).catch(() => 0n);
      const bal = accountId ? BigInt(await ftBalance(LIQUID[id].contract, accountId)) : 0n;
      return {
        provider: LIQUID[id].name,
        token: LIQUID[id].symbol,
        rate: price ? `1 ${LIQUID[id].symbol} = ${fromBase(price, 24, 4)} NEAR` : "n/a",
        ...(accountId ? { yourBalance: `${fromBase(bal, 24, 4)} ${LIQUID[id].symbol} (≈ ${fromBase((bal * price) / 10n ** 24n, 24, 4)} NEAR)` } : {}),
      };
    }),
  );
  const pools = [...new Set([...POPULAR_VALIDATORS, ...extraPools.filter(isValidatorPool)])];
  const validators = await Promise.all(
    pools.map(async (pool) => {
      const info = await validatorInfo(pool).catch(() => null);
      if (!info) return null;
      let mine: string | undefined;
      if (accountId) {
        const [s, u] = await Promise.all([
          view<string>(pool, "get_account_staked_balance", { account_id: accountId }).catch(() => "0"),
          view<string>(pool, "get_account_unstaked_balance", { account_id: accountId }).catch(() => "0"),
        ]);
        if (BigInt(s) > 0n || BigInt(u) > 0n) mine = `${fromBase(s, 24, 4)} staked, ${fromBase(u, 24, 4)} unstaking/unstaked`;
      }
      return { pool, feePct: info.feePct, ...(mine ? { yours: mine } : {}) };
    }),
  );
  return { liquid, validators: validators.filter(Boolean) };
}
