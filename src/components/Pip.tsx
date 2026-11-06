// Pip — Allpilot's mascot: a round little owl-cloud with pilot goggles.
export function Pip({ size = 48, mood = "happy", className = "" }: { size?: number; mood?: "happy" | "think" | "wow"; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} aria-hidden="true">
      {/* ear tufts */}
      <path d="M30 34 L24 12 L46 26 Z" fill="var(--pip-body-dark)" />
      <path d="M90 34 L96 12 L74 26 Z" fill="var(--pip-body-dark)" />
      {/* body */}
      <ellipse cx="60" cy="66" rx="44" ry="42" fill="var(--pip-body)" />
      <ellipse cx="60" cy="82" rx="26" ry="20" fill="var(--pip-belly)" />
      {/* belly feathers */}
      <path d="M48 80 q4 4 8 0 M58 86 q4 4 8 0 M52 92 q4 4 8 0" stroke="var(--pip-body-dark)" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".5" />
      {/* goggle strap */}
      <rect x="16" y="38" width="88" height="8" rx="4" fill="var(--pip-strap)" />
      {/* goggles */}
      <circle cx="42" cy="52" r="17" fill="var(--pip-goggle-rim)" />
      <circle cx="78" cy="52" r="17" fill="var(--pip-goggle-rim)" />
      <circle cx="42" cy="52" r="12.5" fill="var(--pip-eye-bg)" />
      <circle cx="78" cy="52" r="12.5" fill="var(--pip-eye-bg)" />
      {mood === "think" ? (
        <>
          <path d="M35 53 q7 -6 14 0" stroke="var(--ink)" strokeWidth="3.2" fill="none" strokeLinecap="round" />
          <path d="M71 53 q7 -6 14 0" stroke="var(--ink)" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="43" cy="53" r={mood === "wow" ? 7 : 6} fill="var(--ink)" />
          <circle cx="79" cy="53" r={mood === "wow" ? 7 : 6} fill="var(--ink)" />
          <circle cx="45.5" cy="50.5" r="2.2" fill="#fff" />
          <circle cx="81.5" cy="50.5" r="2.2" fill="#fff" />
        </>
      )}
      {/* beak */}
      <path d="M55 66 L65 66 L60 74 Z" fill="var(--pip-beak)" />
      {/* cheeks */}
      <ellipse cx="30" cy="72" rx="7" ry="4.5" fill="var(--pip-cheek)" opacity=".85" />
      <ellipse cx="90" cy="72" rx="7" ry="4.5" fill="var(--pip-cheek)" opacity=".85" />
      {mood === "wow" && <ellipse cx="60" cy="80" rx="4" ry="3" fill="var(--ink)" opacity=".7" />}
      {/* wings */}
      <path d="M17 70 q-8 14 6 24 q2 -14 -6 -24Z" fill="var(--pip-body-dark)" />
      <path d="M103 70 q8 14 -6 24 q-2 -14 6 -24Z" fill="var(--pip-body-dark)" />
    </svg>
  );
}
