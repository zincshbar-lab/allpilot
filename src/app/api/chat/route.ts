import { chat } from "@/lib/agent";
import type { ChatMessage } from "@/lib/cards";
import { isNearAccountId } from "@/lib/near";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { messages?: ChatMessage[]; accountId?: string; icon?: string };
    const messages = (body.messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    if (!messages.length) return Response.json({ error: "No messages" }, { status: 400 });
    const accountId = body.accountId && isNearAccountId(body.accountId) ? body.accountId : undefined;
    const baseUrl = process.env.PUBLIC_SITE_URL ?? new URL(req.url).origin; // for payment links
    // Token picture for launches: a small data URL resized in the browser (see lib/image.ts).
    const icon =
      typeof body.icon === "string" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(body.icon) && body.icon.length <= 20_000
        ? body.icon
        : undefined;
    return Response.json(await chat(messages, accountId, baseUrl, icon));
  } catch (e) {
    return Response.json({ reply: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, cards: [], mode: "offline" }, { status: 200 });
  }
}

// First request on a cold server builds the pool/price indexes; give it room on Vercel.
export const maxDuration = 60;
