import type { ReactNode } from 'react';

/** Record text with the only markup the lore uses: ~~struck-out~~ words (edits left visible in a record). */
export function LoreText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  text.split(/(~~[^~]+~~)/).forEach((s, i) => parts.push(s.startsWith('~~') ? <s key={i} className="text-mute decoration-red-400/70">{s.slice(2, -2)}</s> : s));
  return <>{parts}</>;
}

/** A line of flavour text: italic, quiet, with any attribution ("… — Source") set apart. */
export function Flavor({ text, className = '' }: { text?: string; className?: string }) {
  if (!text) return null;
  const k = text.lastIndexOf(' — ');
  const [body, by] = k > 0 ? [text.slice(0, k), text.slice(k + 3)] : [text, null];
  return (
    <p className={`border-l-2 border-line pl-2 font-serif text-[12px] italic leading-snug text-ink2/90 ${className}`}>
      <LoreText text={body} />
      {by && <span className="mt-0.5 block text-right text-[10.5px] not-italic text-mute">— {by}</span>}
    </p>
  );
}
