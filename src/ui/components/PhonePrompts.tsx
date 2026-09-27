import type { ReactNode } from 'react';
import { cardCost, cardOf, evolutionBoosts, findNode, other, reactionOptions, STANCES } from '../../engine';
import type { Action, GameState, PlayerId, Stance } from '../../engine';
import { STANCE_META } from '../meta';
import { CardView } from './CardView';
import { incomingInfo, protocolVerdict, VERDICT_CLASS } from './Reaction';

// Phone landscape prompts: each is one row that fits the fixed-height strip under the board,
// with the explanation and primary buttons on the left and the choices on the right.

function Strip({ info, children }: { info: ReactNode; children: ReactNode }) {
  return (
    <section className="pop lab-panel flex h-full min-h-0 gap-1.5 rounded-lg border border-accent/60 p-1.5">
      <div className="flex w-[118px] shrink-0 flex-col justify-between gap-1 text-[10px] leading-tight text-ink2">{info}</div>
      <div className="flex min-w-0 flex-1 items-stretch gap-1.5">{children}</div>
    </section>
  );
}

const btn = 'rounded-md px-2 py-1 font-display text-[11px] font-bold';

function StanceRow({ onPick }: { onPick: (s: Stance) => void }) {
  return (
    <>
      {STANCES.map((st) => {
        const m = STANCE_META[st];
        return (
          <button key={st} onClick={() => onPick(st)} className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg border border-line bg-panel2 px-1 text-center active:border-accent active:bg-accent/15">
            <span className="text-xl leading-none">{m.glyph}</span>
            <span className="font-display text-[12px] font-bold">{m.name}</span>
            <span className="text-[8.5px] leading-tight text-ink2">{m.text}</span>
          </button>
        );
      })}
    </>
  );
}

export function PhoneStance({ state, me, onPick }: { state: GameState; me: PlayerId; onPick: (s: Stance) => void }) {
  const last = state.players[other(me)].stanceHistory.at(-1);
  return (
    <Strip
      info={
        <>
          <span className="font-display text-[12px] font-bold text-ink">Pick your stance</span>
          <span>Secret until both have picked.</span>
          {last && <span className="text-mute">Their last: {STANCE_META[last].name}</span>}
        </>
      }
    >
      <StanceRow onPick={onPick} />
    </Strip>
  );
}

export function PhoneFeint({ state, me, onPick }: { state: GameState; me: PlayerId; onPick: (s: Stance | null) => void }) {
  const st = state.players[me].stance!;
  const params = findNode('feint')?.params ?? {};
  const price = [params.strain ? `+${params.strain} Strain` : '', params.damage ? `${params.damage} damage` : ''].filter(Boolean).join(', ');
  return (
    <Strip
      info={
        <>
          <span className="font-display text-[12px] font-bold text-ink">Tied on {STANCE_META[st].name}. Feint?</span>
          <span>Re-pick once per match{price ? ` (costs ${price})` : ''}.</span>
          <button onClick={() => onPick(null)} className={`${btn} bg-panel2`}>
            Keep {STANCE_META[st].name}
          </button>
        </>
      }
    >
      <StanceRow onPick={onPick} />
    </Strip>
  );
}

export function PhoneMulligan({ state, me, onKeep, onMull, onInspect }: { state: GameState; me: PlayerId; onKeep: () => void; onMull: () => void; onInspect: (cardId: string) => void }) {
  const p = state.players[me];
  // Touch has no hover tooltip: tapping a card opens it in full so you can judge the hand.
  return (
    <Strip
      info={
        <>
          <span className="font-display text-[12px] font-bold text-ink">
            Opening hand <span className="block font-sans text-[10px] font-normal text-mute">Tap a card to read it</span>
          </span>
          <div className="flex flex-col gap-1">
            <button onClick={onKeep} className={`${btn} bg-accent text-black`}>
              Keep
            </button>
            <button onClick={onMull} className={`${btn} bg-panel2`}>
              Mulligan (redraw)
            </button>
          </div>
        </>
      }
    >
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 pt-1.5">
        {p.hand.map((c) => {
          const d = cardOf(c.cardId);
          return <CardView key={c.uid} def={d} cost={cardCost(state, p, d)} size="xs" onClick={() => onInspect(c.cardId)} onInspect={() => onInspect(c.cardId)} />;
        })}
      </div>
    </Strip>
  );
}

export function PhoneEvolve({ state, me, onPick, onDecline }: { state: GameState; me: PlayerId; onPick: (id: string) => void; onDecline: () => void }) {
  const p = state.players[me];
  const defs = (state.config.evolutions as Record<string, { id: string; name: string }[]>)[p.faction].filter((d) => p.evolutionOptions.includes(d.id));
  return (
    <Strip
      info={
        <>
          <span className="font-display text-[12px] font-bold text-ink">{defs.length > 1 ? 'Choose a form' : 'Evolve now?'}</span>
          <span>Permanent, one per match.</span>
          <button onClick={onDecline} className={`${btn} bg-panel2`}>
            Hold off
          </button>
        </>
      }
    >
      {defs.map((d) => (
        <button key={d.id} onClick={() => onPick(d.id)} className="flex min-w-0 flex-1 flex-col justify-center rounded-lg border border-accent/50 bg-panel2 px-2 text-left active:bg-accent/15">
          <span className="font-display text-[13px] font-bold text-accent">{d.name}</span>
          {evolutionBoosts(state, p, d.id).map((b) => (
            <span key={b} className="truncate text-[9.5px] leading-snug text-ink2">
              ▲ {b}
            </span>
          ))}
        </button>
      ))}
    </Strip>
  );
}

export function PhoneReaction({ state, me, onAct, onInspect }: { state: GameState; me: PlayerId; onAct: (a: Action) => void; onInspect: (cardId: string) => void }) {
  const w = state.window!;
  const options = reactionOptions(state, me, w.play);
  const inc = incomingInfo(state, me, w.play);
  return (
    <Strip
      info={
        <>
          <span className="font-display text-[12px] font-bold text-amber-300">Respond?</span>
          <span className="line-clamp-3">
            <b className="text-ink">{state.players[w.play.player].name}</b> → <b className="text-ink">{inc.name}</b> <span className="text-amber-200">{inc.aim}</span>
          </span>
          <button onClick={() => onAct({ type: 'DECLINE_REACTION', player: me })} className={`${btn} bg-panel2`}>
            No response
          </button>
        </>
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 pt-1.5">
        {/* What you would be answering. */}
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          {inc.def ? (
            <CardView def={inc.def} size="xs" onClick={() => onInspect(inc.def!.id)} />
          ) : (
            <div className="grid h-[84px] w-[58px] place-items-center rounded-lg border border-line bg-[repeating-linear-gradient(45deg,#1b2521_0_4px,#111916_4px_8px)] text-center text-[8px] text-mute">face-down</div>
          )}
          <span className="rounded bg-red-700 px-1 font-display text-[8px] font-bold tracking-wider text-white">INCOMING</span>
        </div>
        <span className="shrink-0 font-display text-[10px] font-bold text-mute">VS</span>
        {options.map((a) => {
          if (a.type !== 'REACT') return null;
          if (a.ability === 'pressureValve') {
            return (
              <button key="valve" onClick={() => onAct(a)} className="h-[84px] w-[70px] shrink-0 rounded-lg border border-accent bg-panel2 p-1 text-left">
                <span className="block text-[8px] font-bold uppercase text-accent">Skill</span>
                <span className="block font-display text-[10px] font-bold leading-tight">Pressure Valve</span>
                <span className="mt-0.5 block text-[8px] leading-tight text-ink2">Vent Strain; doesn't stop it</span>
              </button>
            );
          }
          const c = state.players[me].hand.find((x) => x.uid === a.uid)!;
          const d = cardOf(c.cardId);
          const v = protocolVerdict(d, inc.def ? inc.name : 'it');
          return (
            <div key={c.uid} className="relative shrink-0" title={v.long}>
              <CardView def={d} cost={cardCost(state, state.players[me], d)} size="xs" onClick={() => onAct(a)} onInspect={() => onInspect(c.cardId)} />
              {/* Whether it stops the incoming play, right on the card (hold the card for its full text). */}
              <span className={`pointer-events-none absolute inset-x-0 -bottom-1 mx-auto w-fit whitespace-nowrap rounded px-1 font-display text-[7.5px] font-bold tracking-wide shadow ${VERDICT_CLASS[v.kind]}`}>{v.short}</span>
            </div>
          );
        })}
      </div>
    </Strip>
  );
}
