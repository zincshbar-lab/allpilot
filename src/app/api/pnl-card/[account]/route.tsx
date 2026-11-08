import { ImageResponse } from "next/og";
import { fmtSigned, pnlSummary } from "@/lib/pnlShare";

export const maxDuration = 60;

// Pip, the robot pilot (same art as app/icon.svg)
const PIP = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M24 74 C10 72 3 64 2 56 C10 60 16 60 22 58 C14 56 9 51 8 45 C15 49 21 50 26 49 Z" fill="#ffd772"/><path d="M96 74 C110 72 117 64 118 56 C110 60 104 60 98 58 C106 56 111 51 112 45 C105 49 99 50 94 49 Z" fill="#ffd772"/><path d="M60 22 V12" stroke="#a68cf5" stroke-width="3.5" stroke-linecap="round"/><path d="M60 2 L62.6 8.2 L69 9.5 L62.6 10.8 L60 17 L57.4 10.8 L51 9.5 L57.4 8.2 Z" fill="#ffb24d"/><rect x="20" y="26" width="80" height="78" rx="34" fill="#c9b6ff"/><path d="M20 62 C20 38 38 24 60 24 C82 24 100 38 100 62 L100 66 C88 58 74 55 60 55 C46 55 32 58 20 66 Z" fill="#ff8fb1"/><rect x="15" y="58" width="12" height="24" rx="6" fill="#ff8fb1"/><rect x="93" y="58" width="12" height="24" rx="6" fill="#ff8fb1"/><rect x="28" y="38" width="64" height="7" rx="3.5" fill="#a68cf5"/><circle cx="46" cy="41" r="10" fill="#ffd772"/><circle cx="74" cy="41" r="10" fill="#ffd772"/><circle cx="46" cy="41" r="6.5" fill="#8fd3ff"/><circle cx="74" cy="41" r="6.5" fill="#8fd3ff"/><rect x="33" y="62" width="54" height="32" rx="14" fill="#2b2240"/><path d="M41 79 q6 -8 12 0" stroke="#7fdcb5" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M67 79 q6 -8 12 0" stroke="#7fdcb5" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M54 85 q6 5 12 0" stroke="#7fdcb5" stroke-width="3" stroke-linecap="round" fill="none"/><ellipse cx="29" cy="92" rx="5" ry="3.2" fill="#ff9fbf"/><ellipse cx="91" cy="92" rx="5" ry="3.2" fill="#ff9fbf"/></svg>`,
).toString("base64")}`;

export async function GET(_req: Request, ctx: { params: Promise<{ account: string }> }) {
  const { account } = await ctx.params;
  let s;
  try {
    s = await pnlSummary(decodeURIComponent(account));
  } catch {
    return new Response("Unknown account", { status: 404 });
  }
  const up = s.totalNear >= 0;
  const accent = up ? "#2f9e6e" : "#e2557a";
  const short = s.account.length > 26 ? `${s.account.slice(0, 10)}…${s.account.slice(-8)}` : s.account;
  const stat = (label: string, value: string, color = "#3b2f4a") => (
    <div style={{ display: "flex", flexDirection: "column", background: "#fff", borderRadius: 24, padding: "14px 22px", border: "3px solid #f3dfe7", minWidth: 220 }}>
      <div style={{ fontSize: 22, color: "#7a6c8a" }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 700, color }}>{value}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "linear-gradient(135deg, #fff7f0 0%, #ffe3ea 55%, #ece6ff 100%)", padding: 48, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ fontSize: 40, fontWeight: 800, color: "#3b2f4a" }}>All</div>
            <div style={{ fontSize: 40, fontWeight: 800, color: "#ff8fb1" }}>pilot</div>
            <div style={{ fontSize: 24, color: "#7a6c8a", marginLeft: 14 }}>· meme PnL</div>
          </div>
          <div style={{ fontSize: 26, color: "#7a6c8a", marginTop: 6 }}>{short}</div>

          <div style={{ display: "flex", alignItems: "baseline", marginTop: 34 }}>
            <div style={{ fontSize: 104, fontWeight: 800, color: accent, lineHeight: 1 }}>{fmtSigned(s.totalNear)}</div>
            <div style={{ fontSize: 44, fontWeight: 700, color: accent, marginLeft: 16 }}>NEAR</div>
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "#3b2f4a", marginTop: 6 }}>
            {`${s.totalUsd >= 0 ? "+" : "−"}$${Math.abs(s.totalUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
            {s.roiPct !== undefined ? `  ·  ${fmtSigned(s.roiPct, 1)}% ROI` : ""}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 34 }}>
            {s.best ? stat("🏆 Best trade", `$${s.best.symbol} ${fmtSigned(s.best.totalNear)}`, "#2f9e6e") : stat("🏆 Best trade", "—")}
            {stat("Realized", `${fmtSigned(s.realizedNear)} N`, s.realizedNear >= 0 ? "#2f9e6e" : "#e2557a")}
            {stat("Open", `${fmtSigned(s.unrealizedNear)} N`, s.unrealizedNear >= 0 ? "#2f9e6e" : "#e2557a")}
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#7a6c8a", marginTop: "auto" }}>
            {`${s.tokens} tokens · ${s.trades} trades${s.sinceMs ? ` · since ${new Date(s.sinceMs).toISOString().slice(0, 10)}` : ""} · from on-chain swaps · #NEARHackathon`}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 300 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PIP} width={280} height={280} alt="" />
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#3b2f4a", marginTop: 10 }}>{up ? "Pip says: nice flying! ✈️" : "Pip says: hold steady 🛫"}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=600" } },
  );
}
