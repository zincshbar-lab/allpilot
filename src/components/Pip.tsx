// Pip — Allpilot's AI co-pilot: a round little robot in an aviator cap and goggles, with a glowing
// screen face and pilot wings. Colors come from CSS tokens so it follows light/dark mode.
export function Pip({ size = 48, mood = "happy", className = "" }: { size?: number; mood?: "happy" | "think" | "wow"; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} aria-hidden="true">
      {/* pilot wings */}
      <path d="M24 74 C10 72 3 64 2 56 C10 60 16 60 22 58 C14 56 9 51 8 45 C15 49 21 50 26 49 Z" fill="var(--pip-goggle-rim)" />
      <path d="M96 74 C110 72 117 64 118 56 C110 60 104 60 98 58 C106 56 111 51 112 45 C105 49 99 50 94 49 Z" fill="var(--pip-goggle-rim)" />

      {/* antenna with AI spark */}
      <path d="M60 22 V12" stroke="var(--pip-body-dark)" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M60 2 L62.6 8.2 L69 9.5 L62.6 10.8 L60 17 L57.4 10.8 L51 9.5 L57.4 8.2 Z" fill="var(--pip-beak)" />

      {/* head */}
      <rect x="20" y="26" width="80" height="78" rx="34" fill="var(--pip-body)" />
      {/* aviator cap + ear flaps */}
      <path d="M20 62 C20 38 38 24 60 24 C82 24 100 38 100 62 L100 66 C88 58 74 55 60 55 C46 55 32 58 20 66 Z" fill="var(--pip-strap)" />
      <rect x="15" y="58" width="12" height="24" rx="6" fill="var(--pip-strap)" />
      <rect x="93" y="58" width="12" height="24" rx="6" fill="var(--pip-strap)" />
      <path d="M36 30 C44 26 52 25 60 25" stroke="#fff" strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" fill="none" />

      {/* goggles pushed up on the cap */}
      <rect x="28" y="38" width="64" height="7" rx="3.5" fill="var(--pip-body-dark)" />
      <circle cx="46" cy="41" r="10" fill="var(--pip-goggle-rim)" />
      <circle cx="74" cy="41" r="10" fill="var(--pip-goggle-rim)" />
      <circle cx="46" cy="41" r="6.5" fill="var(--sky)" opacity=".9" />
      <circle cx="74" cy="41" r="6.5" fill="var(--sky)" opacity=".9" />
      <circle cx="43.5" cy="38.5" r="2" fill="#fff" />
      <circle cx="71.5" cy="38.5" r="2" fill="#fff" />

      {/* screen face */}
      <rect x="33" y="62" width="54" height="32" rx="14" fill="#2b2240" />
      {mood === "think" ? (
        <>
          <path d="M42 77 h10" stroke="var(--mint)" strokeWidth="4" strokeLinecap="round" />
          <path d="M68 77 h10" stroke="var(--mint)" strokeWidth="4" strokeLinecap="round" />
          <circle cx="56" cy="87" r="1.6" fill="var(--mint)" />
          <circle cx="60" cy="87" r="1.6" fill="var(--mint)" opacity=".7" />
          <circle cx="64" cy="87" r="1.6" fill="var(--mint)" opacity=".4" />
        </>
      ) : mood === "wow" ? (
        <>
          <circle cx="47" cy="76" r="6" fill="none" stroke="var(--mint)" strokeWidth="3.5" />
          <circle cx="73" cy="76" r="6" fill="none" stroke="var(--mint)" strokeWidth="3.5" />
          <ellipse cx="60" cy="87.5" rx="3.5" ry="2.8" fill="var(--mint)" />
        </>
      ) : (
        <>
          <path d="M41 79 q6 -8 12 0" stroke="var(--mint)" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M67 79 q6 -8 12 0" stroke="var(--mint)" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M54 85 q6 5 12 0" stroke="var(--mint)" strokeWidth="3" strokeLinecap="round" fill="none" />
        </>
      )}

      {/* cheeks */}
      <ellipse cx="29" cy="92" rx="5" ry="3.2" fill="var(--pip-cheek)" opacity=".85" />
      <ellipse cx="91" cy="92" rx="5" ry="3.2" fill="var(--pip-cheek)" opacity=".85" />
    </svg>
  );
}
