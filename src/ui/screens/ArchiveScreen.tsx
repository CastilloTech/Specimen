import { useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { LoreText } from '../components/Flavor';
import { currentRecruiter, FRAGMENTS, fragmentText, loadSeenLore, markLoreSeen, SOURCE_META, unlockedFragments } from '../lore';
import type { Fragment, LoreSource } from '../lore';
import { loadProgress } from '../modes';
import { activeSave, loadMatches } from '../storage';
import { useScrollMemory, useSessionState } from '../session';

/** Redacted bars standing in for a record not yet recovered: roughly the shape of its text, none of its words. */
function Redacted({ f }: { f: Fragment }) {
  const widths = useMemo(() => {
    const n = Math.min(4, Math.max(2, Math.round(f.text.length / 160)));
    return Array.from({ length: n }, (_, i) => 55 + ((f.id.charCodeAt(i % f.id.length) * 37) % 40));
  }, [f]);
  return (
    <div className="space-y-1.5" aria-hidden>
      {widths.map((w, i) => (
        <div key={i} className="h-2 rounded-sm bg-ink/10" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/**
 * The Archive: records recovered by playing, read in any order. Nothing is summarised; missing records show
 * as redacted bars with a vague hint of where they turn up.
 */
export function ArchiveScreen({ onBack }: { onBack: () => void }) {
  const save = activeSave();
  const unlocked = useMemo(() => unlockedFragments(loadMatches(), loadProgress()), []);
  const [seen, setSeen] = useState(loadSeenLore);
  const [source, setSource] = useSessionState<LoreSource | 'all'>('archive.source', 'all');
  useScrollMemory('archive');
  const [open, setOpen] = useState<Fragment | null>(null);
  const recruiter = useMemo(currentRecruiter, []);
  // Only sources you have recovered something from: an empty tab would name what is still to come.
  const sources = (Object.keys(SOURCE_META) as LoreSource[]).filter((s) => FRAGMENTS.some((f) => f.source === s && unlocked.has(f.id)));
  // Dispatches arrive one per daily win: show the ones recovered and only the next one still to come.
  const nextDispatch = FRAGMENTS.find((f) => f.source === 'dispatch' && !unlocked.has(f.id))?.id;
  const list = FRAGMENTS.filter((f) => (source === 'all' || f.source === source) && (f.source !== 'dispatch' || unlocked.has(f.id) || f.id === nextDispatch));
  const read = (f: Fragment) => {
    setOpen(f);
    if (!seen.has(f.id)) {
      markLoreSeen([f.id]);
      setSeen(new Set(seen).add(f.id));
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-3 p-3">
      <ScreenHeader title="The Archive" sub={`Recovered records · ${unlocked.size} of ${FRAGMENTS.length}`} onBack={onBack} />
      {!save && <p className="rounded-lg border border-amber-500/40 bg-amber-950/25 p-2 text-xs text-amber-200">Load a save to keep what you recover. Without one, only the first record is on file.</p>}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Source">
        {(['all', ...sources] as const).map((s) => {
          const on = source === s;
          const color = s === 'all' ? 'var(--color-accent)' : SOURCE_META[s].color;
          const have = FRAGMENTS.filter((f) => (s === 'all' || f.source === s) && unlocked.has(f.id)).length;
          return (
            <button key={s} role="tab" aria-selected={on} onClick={() => setSource(s)} className="rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={on ? { borderColor: color, color, background: 'rgba(0,0,0,0.35)' } : { borderColor: 'var(--color-line)', color: 'var(--color-ink2)' }}>
              {s === 'all' ? 'All' : SOURCE_META[s].name} <span className="text-mute">{have}</span>
            </button>
          );
        })}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {list.map((f) => {
          const has = unlocked.has(f.id);
          const fresh = has && !seen.has(f.id);
          const meta = SOURCE_META[f.source];
          return (
            <li key={f.id}>
              <button
                onClick={() => has && read(f)}
                disabled={!has}
                className={`lab-panel flex h-full w-full flex-col gap-1.5 rounded-xl border p-3 text-left transition ${has ? 'border-line hover:border-accent' : 'cursor-default border-line/50 opacity-70'} ${fresh ? 'shimmer' : ''}`}
                aria-label={has ? f.title : `Missing record. ${f.where}`}
              >
                <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: has ? meta.color : 'var(--color-mute)' }}>
                  {has ? meta.name : 'Missing'}
                  {fresh && <span className="rounded-full bg-amber-400 px-1.5 text-[9px] text-black">new</span>}
                </span>
                {has ? (
                  <>
                    <span className="font-display text-sm font-bold text-ink">{f.title}</span>
                    <span className="line-clamp-2 font-serif text-[12px] italic text-ink2">
                      <LoreText text={fragmentText(f, recruiter).split('\n')[0]} />
                    </span>
                  </>
                ) : (
                  <>
                    <Redacted f={f} />
                    <span className="text-[10.5px] text-mute">{f.where}</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={() => setOpen(null)}>
          <article
            className="pop max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-bg p-4 sm:rounded-2xl"
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))', borderTop: `3px solid ${SOURCE_META[open.source].color}` }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={open.title}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: SOURCE_META[open.source].color }}>
              {SOURCE_META[open.source].name}
            </div>
            <h2 className="font-display text-lg font-bold">{open.title}</h2>
            <div className="mt-3 space-y-3 font-serif text-[15px] leading-relaxed text-ink">
              {/* The redaction peels off each paragraph in turn as the record opens. */}
              {fragmentText(open, recruiter).split('\n\n').map((para, i) => (
                <p key={`${open.id}-${i}`} className="relative whitespace-pre-line">
                  <LoreText text={para} />
                  <span aria-hidden className="redact-peel pointer-events-none absolute inset-0 rounded-sm bg-[#0b0f0d]" style={{ ['--i' as string]: i } as React.CSSProperties} />
                </p>
              ))}
            </div>
            <button onClick={() => setOpen(null)} autoFocus className="mt-4 w-full rounded-lg bg-panel2 px-3 py-2 text-sm font-semibold">
              Close
            </button>
          </article>
        </div>
      )}
    </div>
  );
}
