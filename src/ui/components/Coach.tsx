import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cardCost, cardOf, other } from '../../engine';
import type { CardDef, EngineId, GameState, PlayerId } from '../../engine';
import { comboEngine, STANCE_META } from '../meta';
import { EngineIcon } from './EngineIcon';

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
const BASICS: Tip[] = [
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

const forms = (c: CoachCtx) => (c.state.config.evolutions as Record<string, { id: string; name: string; text: string }[]>)[me_(c).faction] ?? [];
const statusOn = (c: CoachCtx, p: PlayerId) => {
  const x = c.state.players[p];
  return x.bleed > 0 || x.numb > 0 || x.fever > 0 || Object.values(x.necrosis).some((n) => (n ?? 0) > 0);
};

/** Part 2, advanced training: Chips, evolution, status effects, face-down grafts and Protocols. */
const ADVANCED: Tip[] = [
  {
    id: 'adv-welcome',
    title: 'Advanced training',
    body: (c) => (
      <>
        This time you play a <b>Bastion / Miasma</b> Specimen. You'll try the tools the first match skipped: your <b>Chip</b>, <b>evolution</b>, <b>status effects</b>, <b>face-down grafts</b> and <b>Protocols</b>. The bot again has {c.state.players[other(c.me)].maxHp} HP.
      </>
    ),
    show: (c) => c.state.phase === 'mulligan',
    stale: (c) => c.state.phase !== 'mulligan',
  },
  {
    id: 'adv-chip',
    title: 'Your Chip',
    body: (c) => (
      <>
        The small tags at the bottom of your panel are your <b>Chip nodes</b>: passive bonuses from your World Faction's Chip, one per row. You chose them before a match in <b>Decks &amp; Chips</b>. This loan Chip gives you {me_(c).loadout.length} of them. Their full text is in Decks &amp; Chips.
      </>
    ),
    target: 'me',
    show: (c) => c.state.phase === 'mulligan',
    stale: (c) => c.state.phase !== 'mulligan',
  },
  {
    id: 'adv-evo',
    title: 'Evolution',
    body: (c) => {
      const [a, b] = forms(c);
      return (
        <>
          The two bars on your panel are your <b>evolutions</b>. Fill one and you may evolve, for good: {a && <b>{a.name}</b>} ({a?.text.replace(/\.$/, '')}){b && <>, or <b>{b.name}</b> ({b.text.replace(/\.$/, '')})</>}. Venting Strain fills Carapace fast: Fortify, Hold, or the Pressure Release serum in your hand.
        </>
      );
    },
    target: 'me',
    show: (c) => c.state.phase === 'mulligan' && !me_(c).mulliganDecided,
    done: (c) => me_(c).mulliganDecided || c.state.phase !== 'mulligan',
  },
  {
    id: 'adv-status',
    title: 'Status effects',
    body: () => (
      <>
        Miasma inflicts <b className="text-violet-300">Numb</b> (no Protocols) and <b className="text-orange-300">Fever</b> (their grafts cost 1 more). Play <b>{cardOf('mia_wasting_cloud').name}</b> from your hand: it gives the bot Fever. Statuses show as an aura and a badge with the rounds left.
      </>
    ),
    target: 'hand',
    show: (c) => c.state.phase === 'actions' && c.myTurn && me_(c).hand.some((h) => h.cardId === 'mia_wasting_cloud'),
    done: (c) => statusOn(c, other(c.me)) || !me_(c).hand.some((h) => h.cardId === 'mia_wasting_cloud'),
    stale: (c) => c.state.round >= 4,
  },
  {
    id: 'adv-facedown',
    title: 'Play a graft face-down',
    body: (c) =>
      c.selDef?.type === 'graft' ? (
        <>
          Now tick <b>Face-down</b> before you tap the slot. It sleeps: no stats yet, less Strain, and the bot sees only its slot.
        </>
      ) : (
        <>
          Pick a graft, like <b>{cardOf('mia_creeping_rot').name}</b>, and tick <b>Face-down</b> before you tap a slot. It sleeps: no stats yet, less Strain now, and the bot can't see what it is. Wake it after a round for an <b>Ambush</b>.
        </>
      ),
    target: (c) => (c.selDef?.type === 'graft' ? undefined : 'hand'),
    show: (c) => c.state.phase === 'actions' && c.myTurn && me_(c).hand.some((h) => cardOf(h.cardId).type === 'graft'),
    done: (c) => me_(c).grafts.some((g) => g.faceDown),
    stale: (c) => c.state.round >= 5,
  },
  {
    id: 'adv-wake',
    title: 'Wake it for an Ambush',
    body: (c) => (
      <>
        Your sleeping graft has rested a round. Tap it on your Specimen and choose <b>Wake</b> (or press W): it switches on and adds the Strain it saved, plus an <b>Ambush</b> burst this round ({c.state.config.dormant.quietStrain} less Strain was the price of hiding it).
      </>
    ),
    show: (c) => c.state.phase === 'actions' && c.myTurn && me_(c).grafts.some((g) => g.faceDown && (g.sleptSince ?? c.state.round) < c.state.round),
    done: (c) => !me_(c).grafts.some((g) => g.faceDown),
    stale: (c) => c.state.round >= 6,
  },
  {
    id: 'adv-finish',
    title: 'The full toolkit',
    body: () => <>Chips, evolutions, statuses, face-down grafts and Protocols: that's everything. Finish the bot off. Each Build and World Faction plays these differently; the Game guide has a page for each.</>,
    show: (c) => c.state.phase === 'actions' && c.myTurn && c.state.round >= 4,
  },
];

const onBoard = (c: CoachCtx, id: string) => me_(c).grafts.some((g) => g.cardId === id && !g.faceDown);
const inHand = (c: CoachCtx, id: string) => me_(c).hand.some((h) => h.cardId === id);
const fires = (c: CoachCtx, e: EngineId) => me_(c).stats.engineFiresBy[e] ?? 0;
const name = (id: string) => <b>{cardOf(id).name}</b>;

/** Part 3, combos and engines: a payoff, the enablers that set it off, a Tech bridge and Amplify. */
const ENGINES: Tip[] = [
  {
    id: 'eng-welcome',
    title: 'Combos & engines',
    body: () => (
      <>
        An <b>engine</b> is a pair of jobs. <b>Enablers</b> make something happen (here: venting Strain). <b>Payoffs</b> cash in every time it does. This <b>Bastion / Aegis</b> deck runs Bastion's <b>Pressure</b> engine and Aegis's <b>Renewal</b> engine, with a card that links the two.
      </>
    ),
    show: (c) => c.state.phase === 'mulligan',
    stale: (c) => c.state.phase !== 'mulligan',
  },
  {
    id: 'eng-tags',
    title: 'Read the engine tags',
    body: () => (
      <>
        Look over the art of your cards: the <EngineIcon /> tag names the engine. A <b>filled</b> tag is a <b>payoff</b> ({name('bast_exhaust_bladder')}: each vent deals 1 damage). An <b>outlined</b> tag is an <b>enabler</b> ({name('bast_venting_sigh')}, {name('bast_relief_spiracle')}). Keep this hand.
      </>
    ),
    target: 'hand',
    show: (c) => c.state.phase === 'mulligan' && !me_(c).mulliganDecided,
    done: (c) => me_(c).mulliganDecided || c.state.phase !== 'mulligan',
  },
  {
    id: 'eng-payoff',
    title: 'Payoff first',
    body: () => (
      <>
        A payoff only counts what happens <b>after</b> it is on your Specimen, so it goes down first. Play {name('bast_exhaust_bladder')} into a Limb slot now; save the enablers for when it is in place.
      </>
    ),
    target: 'hand',
    show: (c) => c.state.phase === 'actions' && c.myTurn && inHand(c, 'bast_exhaust_bladder'),
    done: (c) => onBoard(c, 'bast_exhaust_bladder'),
    stale: (c) => c.state.round >= 4 || (!inHand(c, 'bast_exhaust_bladder') && !onBoard(c, 'bast_exhaust_bladder')),
  },
  {
    id: 'eng-glow',
    title: 'Set it off',
    body: (c) => {
      const combos = [...new Set(me_(c).hand.map((h) => cardOf(h.cardId)).filter((d) => comboEngine(d, me_(c)) === 'pressure'))];
      const glowing = combos.filter((d) => cardCost(c.state, me_(c), d) <= me_(c).energy);
      if (!glowing.length)
        return (
          <>
            The Bladder is in place. You're out of Energy for its enablers this round, so <b>Pass</b>. Next round, cards that would fire it will <b>glow</b> in your hand{combos.length ? <> ({combos.map((d) => d.name).join(', ')})</> : null}.
          </>
        );
      return (
        <>
          Cards that would fire a payoff on your board now <b>glow</b> in its colour ({glowing.map((d) => d.name).join(', ')}). Play one: every vent makes the Bladder hit. {name('bast_relief_spiracle')} vents whenever you gain Strain, so attaching grafts after it sets the Bladder off too.
        </>
      );
    },
    target: (c) => (me_(c).hand.some((h) => comboEngine(cardOf(h.cardId), me_(c)) === 'pressure' && cardCost(c.state, me_(c), cardOf(h.cardId)) <= me_(c).energy) ? 'hand' : 'pass'),
    show: (c) => c.state.phase === 'actions' && c.myTurn && onBoard(c, 'bast_exhaust_bladder'),
    done: (c) => fires(c, 'pressure') > 0,
    stale: (c) => c.state.round >= 6 || !onBoard(c, 'bast_exhaust_bladder'),
  },
  {
    id: 'eng-fired',
    title: 'It fired!',
    body: () => (
      <>
        The graft flashed its engine emblem: that is a payoff firing. Most payoffs have a <b>cap</b>, like the Bladder's "4 times a round". It resets every round, so spread your enablers out instead of dumping them all at once.
      </>
    ),
    target: 'me',
    show: (c) => fires(c, 'pressure') > 0,
    stale: (c) => c.state.round >= 7,
  },
  {
    id: 'eng-bridge',
    title: 'A bridge between two engines',
    body: () => (
      <>
        {name('tech_steam_mender')} is a <b>Tech bridge</b>: a <b>payoff</b> for Pressure and an <b>enabler</b> for Renewal. Each vent repairs your grafts, and every repair fires your Renewal payoffs, like {name('aeg_mending_carapace')} (+2 armor). One vent, two engines. Get both on your Specimen.
      </>
    ),
    target: 'hand',
    show: (c) => c.state.phase === 'actions' && c.myTurn && (inHand(c, 'tech_steam_mender') || onBoard(c, 'tech_steam_mender')) && (inHand(c, 'aeg_mending_carapace') || onBoard(c, 'aeg_mending_carapace')),
    done: (c) => onBoard(c, 'tech_steam_mender') && onBoard(c, 'aeg_mending_carapace'),
    stale: (c) => c.state.round >= 7 || (!inHand(c, 'tech_steam_mender') && !onBoard(c, 'tech_steam_mender')),
  },
  {
    id: 'eng-amplify',
    title: 'Amplify',
    body: (c) => (
      <>
        Your Chip, <b>Mending Coil</b>, backs Renewal: its <b>Renewing Core</b> node gives every Renewal payoff +1. Evolutions amplify too: Bastion's <b>Carapace</b> form adds +1 to Pressure payoffs, <b>Juggernaut</b> to Fortress. {fires(c, 'renewal') > 0 ? <>Your Renewal engine has fired {fires(c, 'renewal')} time(s) already.</> : null}
      </>
    ),
    target: 'me',
    show: (c) => c.state.phase === 'actions' && c.myTurn && c.state.round >= 3,
  },
  {
    id: 'eng-finish',
    title: 'Build your own',
    body: () => (
      <>
        Every Build and World Faction has three engines. In <b>Decks &amp; Chips</b>, the <EngineIcon /> <b>Engines</b> row filters the pool to one engine, and <b>Build around it</b> makes a deck for it. After each match, the report shows how often each engine fired. Now finish the bot off.
      </>
    ),
    show: (c) => c.state.phase === 'actions' && c.myTurn && c.state.round >= 4,
  },
];

/** Advanced-only moments (added to the shared ones in that lesson). */
const ADVANCED_MOMENTS: Tip[] = [
  {
    id: 'adv-protocol',
    title: 'Answer with a Protocol',
    body: (c) => {
      const protocols = [...new Set(me_(c).hand.map((h) => cardOf(h.cardId)).filter((d) => d.type === 'protocol'))];
      return (
        <>
          The bot just played a card, and you hold a <b className="text-amber-300">Protocol</b> that can answer it{protocols.length ? <> ({protocols.map((d) => d.name).join(', ')})</> : null}. Read it, then play it now or let the card through and keep your Energy.
        </>
      );
    },
    show: (c) => c.reacting,
    done: (c) => !c.reacting,
  },
  {
    id: 'adv-afflicted',
    title: "You've got a status",
    body: () => <>The bot's Corrosion cards made you <b className="text-red-300">Bleed</b>: damage at every Strain check for a few rounds, more per stack. Aegis cards can Purge statuses; otherwise it wears off.</>,
    show: (c) => statusOn(c, c.me),
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
export function Coach({ ctx, active, onSkip, lesson = 'basics' }: { ctx: CoachCtx; active: boolean; onSkip: () => void; lesson?: 'basics' | 'advanced' | 'engines' }) {
  const LESSON = lesson === 'advanced' ? ADVANCED : lesson === 'engines' ? ENGINES : BASICS;
  const moments = lesson === 'advanced' ? [...ADVANCED_MOMENTS, ...MOMENTS] : MOMENTS;
  const [idx, setIdx] = useState(0);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [minimized, setMinimized] = useState(false);

  // Skip past lesson steps that are already done or no longer relevant.
  useEffect(() => {
    let i = idx;
    while (i < LESSON.length && (LESSON[i].done?.(ctx) || LESSON[i].stale?.(ctx))) i++;
    if (i !== idx) setIdx(i);
  });

  const moment = moments.find((m) => !seen.has(m.id) && m.show(ctx));
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
