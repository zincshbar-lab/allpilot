// Serves a launch's off-chain metadata (description + links) for JustHoot's `reference` field.
// The JSON lives entirely in the URL (?d=base64url), so the bytes — and the sha256 the token commits to
// on-chain as `reference_hash` — never change and need no database.

export async function GET(req: Request) {
  const d = new URL(req.url).searchParams.get("d");
  if (!d || d.length > 4000) return new Response("missing or too long", { status: 400 });
  let bytes: Buffer;
  try {
    bytes = Buffer.from(d, "base64url");
    JSON.parse(bytes.toString("utf8")); // must be JSON
  } catch {
    return new Response("bad metadata", { status: 400 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" },
  });
}
