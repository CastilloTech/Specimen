import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { defaultConfig } from '../../engine';
import type { CardDef } from '../../engine';
import { TYPE_META } from '../meta';
import { CardArt } from './CardArt';
import { accentFor, factionName } from './CardView';
import { Emblem } from './Emblem';

const S = defaultConfig.status;
/** One-line reminders for the rules words a card's text can use, shown under the text when they appear. */
const KEYWORDS: [RegExp, string, string][] = [
  [/\bbleed/i, 'Bleed', `${S.bleedDamage} damage per stack at each Strain check for ${S.bleedRounds} rounds. Bleeding again adds a stack (max ${S.bleedMaxStacks}) and refreshes it.`],
  [/\bnumb/i, 'Numb', `Can't play Protocols for ${S.numbRounds} rounds.`],
  [/\bfever/i, 'Fever', `Grafts cost ${S.feverCostIncrease} more Energy for ${S.feverRounds} rounds.`],
  [/\bnecros/i, 'Necrosis', 'The slot is emptied and cannot be refilled for a while.'],
  [/\bpurge/i, 'Purge', 'Clears Bleed, Numb, Fever and Necrosis at once.'],
  [/\bintegrity/i, 'Integrity', "A graft's own HP. Clash damage and some cards wear it down; at 0 the graft is destroyed."],
  [/\bovercloc/i, 'Overclocked', `Strain above half the threshold (${Math.floor(defaultConfig.strain.threshold * defaultConfig.strain.stableMaxRatio) + 1}–${defaultConfig.strain.threshold}): more damage, some self-damage.`],
  [/\bstable\b/i, 'Stable', `Strain at ${Math.floor(defaultConfig.strain.threshold * defaultConfig.strain.stableMaxRatio)} or less.`],
  [/\bstrain check/i, 'Strain check', 'End of each round: over the threshold, your Specimen rejects (ejects) a graft.'],
  [/\breject/i, 'Rejection', `Ending a round above ${defaultConfig.strain.threshold} Strain ejects your highest-Strain graft.`],
  [/\bsever/i, 'Sever', 'Destroys the target graft.'],
  [/\bpoison/i, 'Poison', 'The graft gives 0 attack and armor for a while.'],
  [/\bdisable/i, 'Disable', "The graft's text is switched off for a while."],
  [/\bvent/i, 'Vent', 'Remove Strain from your Specimen.'],
  [/\brespond to/i, 'Protocol', "Played in response to the opponent's play, outside your turn."],
];

/**
 * A card at full size with its whole text, labelled stats and keyword reminders. `children` holds the caller's
 * actions (e.g. the deck builder's − / + count). ‹ › browse a list when given.
 */
export function CardDetail({ def, onClose, onPrev, onNext, children }: { def: CardDef; onClose: () => void; onPrev?: () => void; onNext?: () => void; children?: ReactNode }) {
  const accent = accentFor(def.faction);
  const t = TYPE_META[def.type];
  const keywords = KEYWORDS.filter(([re]) => re.test(def.text));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev?.();
      else if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);
  const stat = (label: string, value: number | string, cls: string) => (
    <div className={`flex flex-col items-center rounded-lg px-2 py-1 ${cls}`}>
      <span className="font-display text-base font-bold leading-none">{value}</span>
      <span className="mt-0.5 text-[9px] uppercase tracking-wider opacity-80">{label}</span>
    </div>
  );
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      {onPrev && (
        <button onClick={(e) => (e.stopPropagation(), onPrev())} className="absolute left-2 top-1/2 z-10 hidden h-12 w-10 -translate-y-1/2 rounded-xl bg-panel/90 text-2xl text-ink2 sm:block" aria-label="Previous card">
          ‹
        </button>
      )}
      {onNext && (
        <button onClick={(e) => (e.stopPropagation(), onNext())} className="absolute right-2 top-1/2 z-10 hidden h-12 w-10 -translate-y-1/2 rounded-xl bg-panel/90 text-2xl text-ink2 sm:block" aria-label="Next card">
          ›
        </button>
      )}
      <div
        key={def.id}
        className="pop flex max-h-[92dvh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl border bg-panel sm:rounded-2xl phone:max-w-2xl phone:flex-row"
        style={{ borderColor: `${accent}88`, boxShadow: `0 0 40px -10px ${accent}88`, paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={def.name}
      >
        <div className="relative aspect-[4/3] shrink-0 phone:aspect-auto phone:w-[42%]">
          <CardArt def={def} accent={accent} className="h-full w-full" />
          <span className="absolute left-2 top-2 grid h-9 w-9 place-items-center rounded-full border-2 border-bg bg-sky-600 font-display text-lg font-bold text-white shadow" title="Energy cost">
            {def.cost}
          </span>
          <button onClick={onClose} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-ink" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          <div>
            <div className="font-display text-xl font-bold leading-tight">
              {def.signature && <span className="mr-1 text-amber-300">★</span>}
              {def.name}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold uppercase tracking-wider">
              <span style={{ color: t.color }}>{t.label}</span>
              {def.slot && <span className="text-ink2">· {def.slot} slot</span>}
              <span className="flex items-center gap-1 normal-case tracking-normal" style={{ color: accent }}>
                · <Emblem id={def.faction} size={16} />
                {factionName(def.faction)}
              </span>
            </div>
          </div>
          {(def.type === 'graft' || def.strain > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {def.type === 'graft' && stat('Attack', def.attack, 'bg-red-900/60 text-red-100')}
              {def.type === 'graft' && stat('Armor', def.armor, 'bg-sky-900/60 text-sky-100')}
              {def.type === 'graft' && stat('Integrity', def.integrity ?? defaultConfig.integrity.default, 'bg-emerald-900/60 text-emerald-100')}
              {def.strain > 0 && stat('Strain', def.strain, 'bg-amber-900/60 text-amber-100')}
            </div>
          )}
          <p className="text-[15px] leading-snug text-ink">{def.text}</p>
          {def.signature && <p className="text-[11px] text-amber-200">Signature: one copy per deck. Surviving {defaultConfig.veterancy.signatureThreshold} Strain checks makes it a Veteran (+{defaultConfig.veterancy.signatureAttackBonus} attack).</p>}
          {keywords.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-black/30 p-2 text-[11px] leading-snug text-ink2">
              {keywords.map(([, name, text]) => (
                <li key={name}>
                  <span className="font-semibold text-ink">{name}:</span> {text}
                </li>
              ))}
            </ul>
          )}
          {children && <div className="mt-auto pt-1">{children}</div>}
          {(onPrev || onNext) && (
            <div className="flex gap-2 sm:hidden">
              <button onClick={onPrev} disabled={!onPrev} className="flex-1 rounded-lg border border-line py-2 text-sm text-ink2 disabled:opacity-30" aria-label="Previous card">
                ‹ Prev
              </button>
              <button onClick={onNext} disabled={!onNext} className="flex-1 rounded-lg border border-line py-2 text-sm text-ink2 disabled:opacity-30" aria-label="Next card">
                Next ›
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
