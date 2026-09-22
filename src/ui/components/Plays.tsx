import { CARD_MAP, publicGraft, publicPlay, SLOT_LABEL } from '../../engine';
import type { CardDef, GameState, PlayerId, PlayRecord } from '../../engine';
import { PLAYER_COLORS, TYPE_META } from '../meta';
import { CardView } from './CardView';

// Everything here goes through publicPlay(), so a face-down graft played by the opponent is never named.

export interface PlayView {
  rec: PlayRecord;
  def?: CardDef;
  hiddenGraft: boolean;
  title: string;
  where: string;
  who: string;
}

export function viewPlay(state: GameState, raw: PlayRecord, viewer: PlayerId): PlayView {
  const rec = publicPlay(raw, viewer);
  const def = rec.cardId ? CARD_MAP[rec.cardId] : undefined;
  const hiddenGraft = !!rec.faceDown && !rec.cardId;
  const mine = rec.player === viewer;
  let title: string;
  if (rec.kind === 'cycle') title = 'Cycled a card';
  else if (rec.kind === 'valve') title = 'Pressure Valve';
  else if (hiddenGraft) title = 'Face-down graft';
  else title = def?.name ?? 'A card';
  let where = '';
  if (rec.slot) where = `→ ${SLOT_LABEL[rec.slot]}${rec.faceDown && rec.cardId ? ' (face-down)' : ''}`;
  else if (rec.target) where = `→ ${mine ? 'their' : 'your'} ${SLOT_LABEL[rec.target]}`;
  else if (rec.kind === 'react') where = 'response';
  if (rec.negated) where = where ? `${where} · negated` : 'negated';
  return { rec, def, hiddenGraft, title, where, who: mine ? 'You' : state.players[rec.player].name };
}

export function PlayChip({ v, glow, onOpen }: { v: PlayView; glow?: boolean; onOpen: (r: PlayRecord) => void }) {
  const color = PLAYER_COLORS[v.rec.player];
  const typeColor = v.def ? TYPE_META[v.def.type].color : '#8a948f';
  return (
    <button
      type="button"
      onClick={() => onOpen(v.rec)}
      title={v.def ? `${v.def.name}: ${v.def.text}` : v.title}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg border bg-panel2 px-2 py-1 text-left ${glow ? 'chip-glow' : ''} ${v.rec.negated ? 'opacity-60' : ''}`}
      style={{ borderColor: color, borderLeftWidth: 4 }}
    >
      <span className="h-6 w-1 shrink-0 rounded" style={{ background: typeColor }} />
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-[11px] font-semibold leading-tight">
          <span className="mr-1 text-[9px] font-bold uppercase" style={{ color }}>
            {v.who}
          </span>
          <span className={v.rec.negated ? 'line-through' : ''}>{v.title}</span>
        </span>
        {v.where && <span className="block whitespace-nowrap text-[9px] leading-tight text-mute">{v.where}</span>}
      </span>
    </button>
  );
}

/** The cards played this round, in order, newest highlighted. */
export function PlaysStrip({ state, viewer, onOpen }: { state: GameState; viewer: PlayerId; onOpen: (r: PlayRecord) => void }) {
  const recs = state.plays.filter((r) => r.round === state.round);
  return (
    <div className="mx-1 mt-1">
      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-mute">Played this round</div>
      {recs.length === 0 ? (
        <div className="text-[11px] text-mute">Nothing played yet.</div>
      ) : (
        <div className="scroll-thin flex gap-1.5 overflow-x-auto pb-1">
          {recs.map((r, i) => (
            <PlayChip key={r.n} v={viewPlay(state, r, viewer)} glow={i === recs.length - 1} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The opponent's newest unseen plays: a compact, card-sized-or-smaller stack anchored on the side of
 * the arena where that player's Specimen sits (mine on the left, the opponent's on the right), so it
 * reads as "theirs" at a glance instead of a big banner spanning the board. Each row states the card's
 * own effect text directly, so what it did is obvious without opening it. */
export function PlayToast({ state, viewer, recs, onDismiss, onOpen }: { state: GameState; viewer: PlayerId; recs: PlayRecord[]; onDismiss: () => void; onOpen: (r: PlayRecord) => void }) {
  if (!recs.length) return null;
  const who = state.players[recs[0].player];
  const color = PLAYER_COLORS[recs[0].player];
  const mine = recs[0].player === viewer;
  const side = mine ? 'left-1' : 'right-1';
  return (
    // The panel itself lets clicks through (so enemy slots underneath stay targetable); only the header and the rows catch them.
    <div className={`pop pointer-events-none absolute top-1 z-20 w-[172px] ${side}`} role="status" aria-live="polite">
      <div
        className="pointer-events-auto mb-1 flex cursor-pointer items-center justify-between gap-1 rounded-lg border-2 bg-bg/90 px-1.5 py-1 text-[10px] font-bold shadow-xl"
        style={{ borderColor: color }}
        onClick={onDismiss}
        title="Dismiss"
      >
        <span className="truncate" style={{ color }}>
          {who.name} played
        </span>
        <span className="shrink-0 text-mute" aria-hidden>
          ✕
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {recs.map((r) => {
          const v = viewPlay(state, r, viewer);
          const typeColor = v.def ? TYPE_META[v.def.type].color : '#8a948f';
          const effect = v.def ? v.def.text : v.rec.kind === 'cycle' ? 'A card was cycled (kept private).' : v.hiddenGraft ? 'Hidden until it wakes or is revealed.' : v.rec.kind === 'valve' ? 'Vented Strain as a reaction.' : '';
          return (
            <button
              type="button"
              key={r.n}
              onClick={() => onOpen(r)}
              className={`pointer-events-auto rounded-lg border bg-panel/95 p-1.5 text-left shadow-xl ${r.negated ? 'opacity-60' : ''}`}
              style={{ borderColor: color, borderLeftWidth: 3 }}
            >
              <div className="flex min-w-0 items-center gap-1">
                {v.def && (
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-sky-600 text-[9px] font-bold text-white" title="Energy cost">
                    {v.def.cost}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" style={{ color: typeColor }} title={v.title}>
                  {v.title}
                </span>
              </div>
              {v.where && <div className={`text-[9px] ${r.negated ? 'text-amber-300 line-through' : 'text-amber-300'}`}>{v.where}</div>}
              {effect && <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-ink2">{effect}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Full card view for a tapped chip, with what the viewer is allowed to know about it. */
export function PlaySheet({ state, viewer, rec, onClose }: { state: GameState; viewer: PlayerId; rec: PlayRecord; onClose: () => void }) {
  const v = viewPlay(state, rec, viewer);
  const owner = state.players[rec.player];
  const g = rec.slot ? owner.grafts.find((x) => x.slot === rec.slot) : undefined;
  const pg = g ? publicGraft(g, viewer === rec.player) : undefined;
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/60 p-2 sm:place-items-center" onClick={onClose}>
      <div className="pop w-full max-w-sm rounded-2xl border border-line bg-panel p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-[11px] uppercase tracking-wide text-mute">
          Round {rec.round} · {v.who} {rec.kind === 'react' ? 'responded with' : rec.kind === 'cycle' ? 'cycled' : 'played'}
        </div>
        {v.def ? (
          <div className="mt-2 flex gap-3">
            <CardView def={v.def} />
            <div className="text-sm leading-snug">
              <div className="font-bold">{v.def.name}</div>
              <div className="mt-1 text-ink2">{v.def.text}</div>
              {v.where && <div className="mt-2 text-[11px] text-amber-300">{v.where}</div>}
              {pg && <div className="mt-1 text-[11px] text-mute">Still on the board: Strain {pg.strain}</div>}
            </div>
          </div>
        ) : rec.kind === 'cycle' ? (
          <div className="mt-2 text-sm text-ink2">A card was cycled. The discarded card stays private.</div>
        ) : rec.kind === 'valve' ? (
          <div className="mt-2 text-sm text-ink2">Pressure Valve: vented Strain as a reaction.</div>
        ) : (
          <div className="mt-2 text-sm text-ink2">
            A face-down graft {v.where}. Its identity stays hidden until it is revealed{pg ? ` (Strain ${pg.strain})` : ''}.
          </div>
        )}
        <button onClick={onClose} className="mt-3 w-full rounded-lg bg-panel2 px-3 py-2 text-sm font-semibold">
          Close
        </button>
      </div>
    </div>
  );
}

/** Every card played in the match, grouped by round. */
export function PlayHistory({ state, viewer, onClose, onOpen }: { state: GameState; viewer: PlayerId; onClose: () => void; onOpen: (r: PlayRecord) => void }) {
  const rounds = Array.from(new Set(state.plays.map((r) => r.round)));
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-2" onClick={onClose}>
      <div className="pop flex max-h-[88dvh] w-full max-w-lg flex-col rounded-2xl border border-line bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line p-3">
          <div className="text-sm font-bold">Cards played this match</div>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-ink2">
            {state.players.map((p) => (
              <span key={p.id} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: PLAYER_COLORS[p.id] }} />
                {p.id === viewer ? 'You' : p.name}
              </span>
            ))}
          </div>
          <button onClick={onClose} className="rounded-md border border-line px-2 py-1 text-xs text-ink2" aria-label="Close history">
            ✕
          </button>
        </div>
        <div className="scroll-thin overflow-y-auto p-3">
          {rounds.length === 0 && <div className="text-sm text-mute">No cards have been played yet.</div>}
          {rounds.map((round) => (
            <div key={round} className="mb-3">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-accent">Round {round}</div>
              <div className="flex flex-wrap gap-1.5">
                {state.plays
                  .filter((r) => r.round === round)
                  .map((r) => (
                    <PlayChip key={r.n} v={viewPlay(state, r, viewer)} onOpen={onOpen} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
