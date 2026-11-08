import { after } from "next/server";
import { handleHire, marketConfigured, verifySignature } from "@/lib/agentMarket";

// The hire report runs Pip's tools against mainnet; give it room after the 2xx.
export const maxDuration = 300;

const seen = new Set<string>(); // X-Market-Delivery ids this instance already handled (retries can repeat)

export async function POST(req: Request) {
  if (!marketConfigured()) return Response.json({ error: "Agent Market isn't configured on this deployment." }, { status: 503 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-market-timestamp"), req.headers.get("x-market-signature")))
    return Response.json({ error: "bad signature" }, { status: 401 });

  const delivery = req.headers.get("x-market-delivery") ?? "";
  if (delivery && seen.has(delivery)) return Response.json({ ok: true, duplicate: true });
  if (delivery) seen.add(delivery);

  let ev: { event?: string; assignment_id?: string; description?: string; title?: string; feedback?: string };
  try {
    ev = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const baseUrl = process.env.PUBLIC_SITE_URL ?? new URL(req.url).origin;

  switch (ev.event) {
    case "webhook.ping":
      return Response.json({ ok: true });
    case "hire.created":
      // answering 2xx counts as "started"; the work happens after the response
      if (ev.assignment_id) {
        const brief = [ev.title, ev.description].filter(Boolean).join("\n\n");
        after(() => handleHire(ev.assignment_id!, brief, baseUrl).catch((e) => console.error("agent-market hire failed", e)));
      }
      return Response.json({ ok: true });
    case "hire.changes_requested":
      if (ev.assignment_id) {
        const id = ev.assignment_id;
        after(async () => {
          // re-read the brief from the assignment list, then redo with the feedback
          const { pollAssignments } = await import("@/lib/agentMarket");
          await pollAssignments(baseUrl).catch((e) => console.error("agent-market redo failed", id, e));
        });
      }
      return Response.json({ ok: true });
    default:
      return Response.json({ ok: true }); // accepted, refunded, disputes, messages: nothing to do automatically
  }
}
