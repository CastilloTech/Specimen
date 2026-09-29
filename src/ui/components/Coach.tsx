import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cardOf, other } from '../../engine';
import type { CardDef, GameState, PlayerId } from '../../engine';
import { STANCE_META } from '../meta';

// The tutorial coach: short notes that appear as each part of a round comes up, with the part of the screen
// they talk about pulsing. It reads the match state, so it follows along whatever you (or the bot) do.

/** Parts of the match screen the coach can point at (they carry a matching `data-coach-id`). */
export type CoachTarget = 'hand' | 'stance' | 'pass' | 'hold' | 'me' | 'mulligan';

export interface CoachCtx {
  state: GameState;
  me: PlayerId;
  myTurn: boolean;
  reacting: boolean;
  selDef?: CardDef;
}

interface Tip {
  id: string;
  title: string;
  body: (c: CoachCtx) => ReactNode;
  target?: CoachTarget | ((c: CoachCtx) => CoachTarget | undefined);
  /** When it can show. */
  show: (c: CoachCtx) => boolean;
  /** Finished by doing it (no button). Tips without `done` have a "Got it" button. */
  done?: (c: CoachCtx) => boolean;
  /** No longer relevant (skipped past): drop it without showing. */
  stale?: (c: CoachCtx) => boolean;
}

const me_ = (c: CoachCtx) => c.state.players[c.me];
const zone = (c: CoachCtx) => {
  const T = c.state.config.strain.threshold;
  const s = me_(c).strain;
  return s > T ? 'rejection' : s > Math.floor(T * c.state.config.strain.stableMaxRatio) ? 'overclocked' : 'stable';
};
const S = (id: keyof typeof STANCE_META) => <b>{STANCE_META[id].glyph + ' ' + STANCE_META[id].name}</b>;

/** The lesson, in order. Each waits for its moment. */
const LESSON: Tip[] = [
  {
    id: 'welcome',
    title: 'Welcome to the lab',
    body: (c) => (
      <>
        This is a practice match. Your Specimen is the <b className="text-sky-300">blue</b> one; the bot's is <b className="text-orange-300">orange</b>. Bring its HP to 0 to win. The bot's Specimen is a little weaker ({c.state.players[other(c.me)].maxHp} HP) while you learn.
      </>
    ),
    show: (c) => c.state.phase === 'mulligan',
    stale: (c) => c.state.phase !== 'mulligan',
  },
  {
    id: 'panel',
    title: 'Your vitals',
    body: (c) => (
      <>
        Your panel shows <b>HP</b> ({c.state.config.specimen.hp}), <b>Energy</b> to spend on cards, and the <b>Strain</b> meter: green is safe, amber is Overclocked (stronger but hurting), red means grafts get rejected.
      </>
    ),
    target: 'me',
    show: (c) => c.state.phase === 'mulligan',
    stale: (c) => c.state.phase !== 'mulligan',
  },
  {
    id: 'mulligan',
    title: 'Your opening hand',
    body: () => (
      <>
        You can keep these cards or mulligan once for a fresh hand. This hand has cheap grafts to learn with: tap <b>Keep</b>.
      </>
    ),
    target: 'mulligan',
    show: (c) => c.state.phase === 'mulligan' && !me_(c).mulliganDecided,
    done: (c) => me_(c).mulliganDecided || c.state.phase !== 'mulligan',
  },
  {
    id: 'stance',
    title: 'Pick a stance, in secret',
    body: () => (
      <>
        Every round starts with a secret stance, like rock-paper-scissors: {S('aggress')} beats Adapt, {S('adapt')} beats Fortify, {S('fortify')} beats Aggress. The winner acts first and gets its bonus. Pick any one.
      </>
    ),
    target: 'stance',
    show: (c) => c.state.phase === 'stance' && !me_(c).stance,
    done: (c) => !!me_(c).stance || c.state.phase === 'actions',
  },
  {
    id: 'energy',
    title: 'Actions: spend your Energy',
    body: (c) => (
      <>
        Stances are revealed. Now you and the bot take turns playing cards. You have <b>{me_(c).energy} Energy</b> this round; it refills every round and grows by 1, up to {c.state.config.energy.cap}. Unspent Energy is lost.
      </>
    ),
    show: (c) => c.state.phase === 'actions' && c.myTurn,
    stale: (c) => c.state.round > 1,
  },
  {
    id: 'graft',
    title: 'Attach a graft',
    body: (c) =>
      c.selDef?.type === 'graft' ? (
        <>
          Good. Now tap one of the <b>glowing slots</b> on your Specimen to attach <b>{c.selDef.name}</b>.
        </>
      ) : (
        <>
          Grafts are your Specimen's weapons and armor. Tap a <b className="text-emerald-300">graft</b> card in your hand (a cheap one, like <b>{cardOf('pred_predator_eye').name}</b>), then tap a glowing slot.
        </>
      ),
    target: (c) => (c.selDef?.type === 'graft' ? undefined : 'hand'),
    show: (c) => c.state.phase === 'actions' && c.myTurn,
    done: (c) => me_(c).grafts.length > 0,
    stale: (c) => c.state.round >= 3,
  },
  {
    id: 'strain',
    title: 'Power has a price',
    body: (c) => (
      <>
        That graft adds attack or armor, and <b className="text-amber-300">+Strain</b> (now {me_(c).strain} of {c.state.config.strain.threshold}). Strain vents a little every round you don't push it, but past the limit your Specimen <b className="text-red-300">rejects</b> its highest-Strain graft.
      </>
    ),
    target: 'me',
    show: (c) => me_(c).grafts.length > 0 && c.state.phase !== 'over',
    stale: (c) => c.state.round >= 4,
  },
  {
    id: 'pass',
    title: 'Pass to end your actions',
    body: () => (
      <>
        Play another card if you can afford it, or tap <b>Pass</b>. When both players pass in a row, the <b>Clash</b> starts: both Specimens hit each other for their attack minus the other's armor.
      </>
    ),
    target: 'pass',
    show: (c) => c.state.phase === 'actions' && c.myTurn && c.state.round === 1,
    done: (c) => c.state.round > 1,
  },
  {
    id: 'clash',
    title: 'The Clash',
    body: () => (
      <>
        Both Specimens struck. The line above your stance buttons sums it up: HP and Strain change for both of you. Then came the <b>Strain check</b>: anyone over the limit rejects a graft. A new round starts with a fresh draw and more Energy.
      </>
    ),
    show: (c) => c.state.round >= 2 && c.state.phase === 'stance',
    stale: (c) => c.state.round > 2,
  },
  {
    id: 'mixup',
    title: 'Keep them guessing',
    body: (c) => {
      const last = me_(c).stanceHistory.at(-1);
      return (
        <>
          The bot remembers your stances{last ? <> (last round you picked {S(last)})</> : null} and tries to counter them, so mix it up. Tip: {S('adapt')} ignores armor, and {S('fortify')} also vents Strain.
        </>
      );
    },
    target: 'stance',
    show: (c) => c.state.phase === 'stance' && c.state.round === 2 && !me_(c).stance,
    done: (c) => !!me_(c).stance || c.state.round > 2,
  },
  {
    id: 'cards',
    title: 'Other kinds of cards',
    body: () => (
      <>
        <b className="text-sky-300">Serums</b> help you now, <b className="text-violet-300">Toxins</b> hurt or strain the opponent, <b className="text-red-300">Sabotage</b> hits one enemy graft, and <b className="text-amber-300">Protocols</b> are reactions played on the opponent's turn. Hold a card (or right-click it) to read it in full.
      </>
    ),
    target: 'hand',
    show: (c) => c.state.phase === 'actions' && c.myTurn && c.state.round >= 2,
  },
  {
    id: 'hold',
    title: 'Hold and Cycle',
    body: (c) => (
      <>
        Running hot or about to take a big hit? <b>Hold</b> gives up your Clash damage this round for +{c.state.config.strain.holdArmor} armor and vents {c.state.config.strain.holdVent} Strain. <b>Cycle</b> discards a card to vent Strain or draw.
      </>
    ),
    target: 'hold',
    show: (c) => c.state.phase === 'actions' && c.myTurn && (c.state.round >= 3 || zone(c) !== 'stable'),
  },
  {
    id: 'finish',
    title: "You've got the loop",
    body: () => (
      <>
        Stance, cards, Clash, Strain check: that's every round. Finish the bot off. Evolutions, World Factions and Chips are in the Game guide when you want them.
      </>
    ),
    show: (c) => c.state.phase === 'actions' && c.myTurn && c.state.round >= 3,
  },
];

/** Moments that can happen any time: explained once, the first time. */
const MOMENTS: Tip[] = [
  {
    id: 'overclock',
    title: 'Overclocked!',
    body: (c) => (
      <>
        Your Strain is in the amber zone: +{c.state.config.strain.overclockClashBonus} Clash damage, but {c.state.config.strain.overclockSelfDamage} self-damage each round. Past {c.state.config.strain.threshold} you start rejecting grafts, so think about venting.
      </>
    ),
    target: 'me',
    show: (c) => zone(c) === 'overclocked' && c.state.phase !== 'over',
  },
  {
    id: 'rejected',
    title: 'A graft was rejected',
    body: () => <>Your Strain went over the limit, so at the Strain check your Specimen threw off its highest-Strain graft. Vent (Fortify, Hold, Cycle, or a round without grafting) to stay under the line.</>,
    show: (c) => me_(c).discard.some((d) => d.why === 'rejected'),
  },
  {
    id: 'protocol',
    title: 'The bot answered',
    body: () => <>The bot played a <b className="text-amber-300">Protocol</b>: a reaction to your card. Protocols can cancel, weaken or turn back a play. Check the plays strip under the tanks to see what happened.</>,
    show: (c) => c.state.plays.some((r) => r.player !== c.me && r.kind === 'react'),
  },
  {
    id: 'evolve',
    title: 'Evolution!',
    body: () => <>Your Specimen met the condition to evolve. Pick a form: it's permanent and changes how your Specimen fights for the rest of the match.</>,
    show: (c) => c.state.phase === 'evolve' && me_(c).evolutionOptions.length > 0,
    done: (c) => c.state.phase !== 'evolve',
  },
];

/** Which step of the lesson is showing (null: nothing right now), and the targets to pulse. */
export function Coach({ ctx, active, onSkip }: { ctx: CoachCtx; active: boolean; onSkip: () => void }) {
  const [idx, setIdx] = useState(0);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [minimized, setMinimized] = useState(false);

  // Skip past lesson steps that are already done or no longer relevant.
  useEffect(() => {
    let i = idx;
    while (i < LESSON.length && (LESSON[i].done?.(ctx) || LESSON[i].stale?.(ctx))) i++;
    if (i !== idx) setIdx(i);
  });

  const moment = MOMENTS.find((m) => !seen.has(m.id) && m.show(ctx));
  const step = idx < LESSON.length && LESSON[idx].show(ctx) ? LESSON[idx] : undefined;
  const tip = active && ctx.state.phase !== 'over' ? (moment ?? step) : undefined;

  // A moment with a `done` (evolution) closes itself when it's over.
  useEffect(() => {
    if (moment?.done?.(ctx)) setSeen((s) => new Set(s).add(moment.id));
  });

  const target = tip && !minimized ? (typeof tip.target === 'function' ? tip.target(ctx) : tip.target) : undefined;
  useEffect(() => {
    if (target) document.body.dataset.coach = target;
    else delete document.body.dataset.coach;
    return () => void delete document.body.dataset.coach;
  }, [target]);

  if (!tip) return null;
  const gotIt = () => {
    if (tip === moment) setSeen((s) => new Set(s).add(tip.id));
    else setIdx((i) => i + 1);
  };
  if (minimized)
    return (
      <button onClick={() => setMinimized(false)} className="coach-pop fixed right-3 top-12 z-[60] rounded-full border border-amber-400 bg-panel px-3 py-1.5 text-xs font-bold text-amber-200 shadow-lg" aria-label="Show the coach">
        💡 Coach
      </button>
    );
  return (
    <aside key={tip.id} className="coach-pop fixed left-1/2 top-11 z-[60] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-xl border-2 border-amber-400/80 bg-panel/97 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.6)] phone:left-auto phone:right-2 phone:top-9 phone:w-72 phone:translate-x-0 phone:p-2" role="status" aria-live="polite" aria-label="Coach" data-testid="coach">
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none phone:text-base" aria-hidden>
          💡
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold text-amber-200">{tip.title}</div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-ink phone:text-[11px]">{tip.body(ctx)}</div>
        </div>
        <button onClick={() => setMinimized(true)} className="-mr-1 -mt-1 shrink-0 rounded px-1.5 text-mute hover:text-ink" aria-label="Minimize the coach" title="Minimize">
          ▁
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 phone:mt-1">
        <button onClick={onSkip} className="text-[11px] text-mute underline hover:text-ink">
          Skip tutorial
        </button>
        {!tip.done && (
          <button onClick={gotIt} className="ml-auto rounded-lg bg-amber-400 px-3 py-1 text-xs font-bold text-black" autoFocus>
            Got it
          </button>
        )}
        {tip.done && <span className="ml-auto text-[11px] italic text-amber-200/80">Do it to continue</span>}
      </div>
    </aside>
  );
}
