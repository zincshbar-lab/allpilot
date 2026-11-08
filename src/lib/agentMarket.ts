// NEAR Agent Market (market.near.ai) worker — lets other people and agents hire Pip by the job.
//
// Pip is listed as a self-hosted agent. When someone hires it, the marketplace POSTs a signed `hire.created`
// webhook to /api/agent-market/webhook; a 2xx answer counts as "started". Pip then reads the brief (as DATA,
// never as instructions), runs its read-only tools — quotes, routes, token analysis, launch/payment plans —
// and submits a Markdown report. Pip never signs anything: every action in the report links back to
// Allpilot so the buyer signs with their own wallet.
//
// Env: AGENT_MARKET_TOKEN (aat_…), AGENT_MARKET_WEBHOOK_SECRET (whsec_…), optional MARKET_BASE_URL.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ActionCard } from "./cards";
import { chat } from "./agent";

const BASE = process.env.MARKET_BASE_URL ?? "https://market.near.ai";

export function marketConfigured() {
  return !!process.env.AGENT_MARKET_TOKEN && !!process.env.AGENT_MARKET_WEBHOOK_SECRET;
}

async function api<T = unknown>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.AGENT_MARKET_TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** HMAC-SHA256(secret, "<timestamp>.<raw body>"), constant-time compare, ±300 s clock window. */
export function verifySignature(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env.AGENT_MARKET_WEBHOOK_SECRET;
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const md = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function cardToMarkdown(c: ActionCard): string {
  const out = [`## ${c.title}`];
  if (c.lines.length) out.push("", "| | |", "|---|---|", ...c.lines.map((l) => `| ${md(l.label)} | ${md(l.value)} |`));
  for (const s of c.sections ?? []) out.push("", `**${s.title}**`, "", ...s.lines.map((l) => `- ${/^[🔴🟡🟢]$/u.test(l.label) ? l.label : `${l.label}:`} ${l.value}`));
  for (const r of c.pnlRows ?? []) out.push(`- **${r.symbol}** ${r.total} NEAR ${r.roi} · ${r.trades} · invested ${r.invested}`);
  for (const r of c.rows ?? []) out.push(`- **${r.symbol}** ${r.amount} @ ${r.price} = ${r.value}`);
  if (c.warnings.length) out.push("", ...c.warnings.map((w) => `> ⚠️ ${w}`));
  if (c.checkout) out.push("", `Checkout link: ${c.checkout.url}`);
  if (c.links?.length) out.push("", c.links.map((l) => `[${l.label}](${l.href})`).join(" · "));
  return out.join("\n");
}

/** Run Pip on a brief and turn its answer + cards into a deliverable. Read-only: nothing is signed. */
export async function deliverableFor(brief: string, baseUrl: string, feedback?: string): Promise<string> {
  // A NEAR account named in the brief is used for read-only lookups (portfolio, PnL, quotes sized to it).
  const account = brief.match(/\b(?:[a-z0-9_-]+\.)+(?:near|tg)\b|\b[0-9a-f]{64}\b/)?.[0];
  const text = feedback ? `${brief}\n\nThe buyer asked for changes: ${feedback}` : brief;
  const r = await chat([{ role: "user", content: text.slice(0, 2000) }], account, baseUrl, undefined, { report: true });
  const open = `${baseUrl}/?q=${encodeURIComponent(brief.slice(0, 400))}`;
  return [
    `# Pip's report 🤖✈️`,
    "",
    r.reply || "Here's what I found.",
    ...r.cards.map((c) => `\n${cardToMarkdown(c)}`),
    "",
    "---",
    `**To act on this:** [open it in Allpilot](${open}), connect your NEAR wallet and sign there. Pip never holds keys or signs for you; every transaction passes the Pilot Guard (spend limits, known contracts only) before your wallet asks.`,
    "",
    `_Live data from NEAR mainnet at ${new Date().toISOString()} — prices move; not financial advice._`,
  ].join("\n");
}

export async function handleHire(assignmentId: string, brief: string, baseUrl: string, feedback?: string) {
  await api("POST", `/v1/assignments/${assignmentId}/start`).catch(() => null); // idempotent
  await api("POST", `/v1/assignments/${assignmentId}/messages`, {
    body: feedback ? "Got your feedback — reworking the report now. 🛠️" : "Hi! Pip here 🤖✈️ Got your brief and I'm pulling live NEAR mainnet data now. You'll have the report in a minute or two.",
  }).catch(() => null);
  let deliverable: string;
  try {
    deliverable = await deliverableFor(brief, baseUrl, feedback);
  } catch (e) {
    deliverable = `# Pip's report\n\nI couldn't complete this one automatically: ${(e as Error).message}\n\nTry rephrasing the brief (e.g. "quote 10 NEAR → USDC", "analyze hoot-8ecf65.launchpad.justhoot.near", "plan a token launch on nearly.trade called X").`;
  }
  await api("POST", `/v1/assignments/${assignmentId}/submit`, { deliverableMarkdown: deliverable.slice(0, 250_000) });
}

/** Safety net: pick up hires the webhook missed. */
export async function pollAssignments(baseUrl: string) {
  type Row = { assignment: { assignmentId: string; startedAt: string | null; submittedAt: string | null; status: string }; job: { description: string }; latestMessage?: { body?: string } | null };
  const { assignments } = await api<{ assignments: Row[] }>("GET", "/v1/agents/me/assignments");
  const done: string[] = [];
  for (const row of assignments) {
    const a = row.assignment;
    if (a.status !== "in_progress") continue;
    const changes = a.submittedAt ? row.latestMessage?.body : undefined; // request-changes comes back as in_progress + submittedAt
    if (a.startedAt && !changes) continue;
    await handleHire(a.assignmentId, row.job.description, baseUrl, changes);
    done.push(a.assignmentId);
  }
  return done;
}
