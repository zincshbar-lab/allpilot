import { marketConfigured, pollAssignments } from "@/lib/agentMarket";

export const maxDuration = 300;

// Safety net for hires the webhook missed. Protected by the webhook secret:
//   POST /api/agent-market/poll   with header  x-poll-key: <AGENT_MARKET_WEBHOOK_SECRET>
export async function POST(req: Request) {
  if (!marketConfigured()) return Response.json({ error: "Agent Market isn't configured on this deployment." }, { status: 503 });
  if (req.headers.get("x-poll-key") !== process.env.AGENT_MARKET_WEBHOOK_SECRET) return Response.json({ error: "unauthorized" }, { status: 401 });
  const handled = await pollAssignments(process.env.PUBLIC_SITE_URL ?? new URL(req.url).origin);
  return Response.json({ ok: true, handled });
}
