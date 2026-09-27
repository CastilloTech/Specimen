import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CARD_MAP, publicDiscard } from '../../engine';
import type { DiscardReason, GameState, PlayerId } from '../../engine';
import { PLAYER_COLORS, TYPE_META } from '../meta';
import { CardDetail } from './CardDetail';

// A player's discard pile, newest first, with how each card got there. Cards lost from the board (rejected,
// destroyed, severed, necrosed, replaced) are listed first; the opponent sees everything except cycled cards.

export const DISCARD_META: Record<DiscardReason, { label: string; color: string; lost: boolean }> = {
  rejected: { label: 'Rejected', color: '#f87171', lost: true },
  destroyed: { label: 'Destroyed · Integrity 0', color: '#fb923c', lost: true },
  severed: { label: 'Severed', color: '#f43f5e', lost: true },
  necrosed: { label: 'Necrosed', color: '#e879f9', lost: true },
  replaced: { label: 'Replaced', color: '#a8a29e', lost: true },
  played: { label: 'Played', color: '#7be0b0', lost: false },
  negated: { label: 'Negated', color: '#fbbf24', lost: false },
  noRoom: { label: 'No room', color: '#a8a29e', lost: false },
  cycled: { label: 'Cycled', color: '#38bdf8', lost: false },
  burned: { label: 'Burned (hand full)', color: '#f59e0b', lost: false },
  discarded: { label: 'Discarded', color: '#c084fc', lost: false },
};

export function TrashIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={className} aria-hidden>
      <path d="M2 3.2h8M4.6 3.2V2h2.8v1.2M3 3.2l.6 7h4.8l.6-7" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

export function DiscardSheet({ state, owner, viewer, onClose }: { state: GameState; owner: PlayerId; viewer: PlayerId; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const p = state.players[owner];
  const pile = publicDiscard(state, owner, viewer).slice().reverse();
  const lost = pile.filter((d) => DISCARD_META[d.why].lost);
  const spent = pile.filter((d) => !DISCARD_META[d.why].lost);
  const row = (d: (typeof pile)[number]) => {
    const def = d.cardId ? CARD_MAP[d.cardId] : null;
    const m = DISCARD_META[d.why];
    return (
      <li key={`${d.uid}:${d.round}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
        <span className="w-7 shrink-0 text-[10px] text-mute">R{d.round}</span>
        {def ? (
          <button onClick={() => setOpen(def.id)} className="min-w-0 flex-1 truncate text-left font-semibold hover:underline" title="Show the full card">
            {def.signature && <span className="text-amber-300">★</span>}
            {def.name}
            <span className="ml-1 text-[10px] font-normal" style={{ color: TYPE_META[def.type].color }}>
              {TYPE_META[def.type].label}
            </span>
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate italic text-mute">A cycled card (kept private)</span>
        )}
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${m.color}26`, color: m.color }} title={d.by ? `${m.label}: ${d.by}` : m.label}>
          {m.label}
          {d.by && d.why !== 'played' && <span className="font-normal opacity-80"> · {d.by}</span>}
        </span>
      </li>
    );
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="pop flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl border border-line bg-bg sm:rounded-2xl" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${p.name}'s discard pile`}>
        <div className="flex items-center gap-2 border-b border-line p-3">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLAYER_COLORS[owner] }} />
          <span className="font-display text-base font-bold">
            {owner === viewer ? 'Your' : `${p.name}'s`} discard pile · {pile.length}
          </span>
          <button onClick={onClose} className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs text-ink2">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {pile.length === 0 && <p className="text-sm text-mute">Empty so far.</p>}
          {lost.length > 0 && (
            <>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red-300">Lost from the board · {lost.length}</div>
              <ul className="mb-3 divide-y divide-line/60 rounded-lg border border-red-500/30">{lost.map(row)}</ul>
            </>
          )}
          {spent.length > 0 && (
            <>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mute">Spent and discarded · {spent.length}</div>
              <ul className="divide-y divide-line/60 rounded-lg border border-line">{spent.map(row)}</ul>
            </>
          )}
        </div>
      </div>
      {open && CARD_MAP[open] && <CardDetail def={CARD_MAP[open]} onClose={() => setOpen(null)} />}
    </div>,
    document.body,
  );
}
