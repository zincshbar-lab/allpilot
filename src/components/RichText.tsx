// Renders the tiny bit of markdown Pip uses (**bold** and `code`) as React elements — no innerHTML.
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <b key={i}>{p.slice(2, -2)}</b>
        ) : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code key={i} className="rounded-md bg-surface px-1 py-0.5 text-[0.85em] font-mono break-all">{p.slice(1, -1)}</code>
        ) : (
          p
        ),
      )}
    </>
  );
}
