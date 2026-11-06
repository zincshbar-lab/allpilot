import { trendingMemes } from "@/lib/actions";

export async function POST() {
  try {
    return Response.json(await trendingMemes());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
