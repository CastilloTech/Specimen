import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { play, useMatchSounds } from '../sfx';
import { SoundToggle } from '../components/AudioMenu';
import { setMusicIntensity, setMusicMood } from '../music';
import { Coach } from '../components/Coach';
import { setLessonDone } from '../tutorial';
import type { Lesson } from '../tutorial';
import { ambushText, cardCost, cardOf, chipOf, defaultConfig, evolutionBoosts, findNode, legalPlays, other, reactionOptions, SLOT_LABEL, STANCES } from '../../engine';
import type { Action, CardDef, GameState, MatchSetup, PlayerId, PlayRecord, SlotId, Stance } from '../../engine';
import { CardDetail } from '../components/CardDetail';
import { CardView } from '../components/CardView';
import { EvolutionBanners, FormList, useEvolutionEvents } from '../components/Evolution';
import { MatchEndOverlay, RoundBanner, useArrivals } from '../components/MatchFx';
import { ChipArt } from '../components/Emblem';
import { HelpSheet } from '../components/HelpSheet';
import { LogPanel } from '../components/LogPanel';
import { PlayHistory, PlaySheet, PlaysStrip, PlayToast } from '../components/Plays';
import { ClashBurst, clashClasses, ClashDamage, clashStyle, useClashEvent, useHitStop } from '../components/ClashFx';
import { PhoneEvolve, PhoneFeint, PhoneMulligan, PhoneReaction, PhoneStance } from '../components/PhonePrompts';
import { PlayerPanel, PlayerPanelCompact } from '../components/PlayerPanel';
import { incomingInfo, protocolVerdict, VERDICT_CLASS } from '../components/Reaction';
import { Specimen } from '../components/Specimen';
import { PHONE_LANDSCAPE, PHONE_PORTRAIT, tryLandscapeFullscreen, useMediaQuery } from '../useMediaQuery';
import { comboEngine, ENGINE_META, engineColor, FACTION_META, PLAYER_COLORS, STANCE_META, WORLD_FACTION_META } from '../meta';
import { matchRecord } from '../stats';
import type { KeyAction, Settings } from '../storage';
import { keyLabel, loadMatches, recordMatch, saveReplay } from '../storage';
import { encounterLines, EVOLUTION_FLAVOR, metBefore, unlockedFragments } from '../lore';
import type { EncounterLines } from '../lore';
import { loadProgress, saveProgress } from '../modes';
import { objectiveDone, objectiveFailed, OBJECTIVE_REWARD, pickObjective } from '../objectives';
import type { Objective } from '../objectives';
import { newlyUnlocked, newlyUnlockedMastery } from '../achievements';
import { LoreText } from '../components/Flavor';
import { nextGoals } from '../nextGoals';
import { turningPoints } from '../turningPoints';
import { ChainFx } from '../components/ChainFx';
import { tiltHandlers, tiltStyle, useHandDrag } from '../components/HandDrag';
import { clashPreview, playPreview } from '../preview';
import type { ClashPreview, PlayPreview } from '../preview';
import { useMatch } from '../useMatch';
import { useOnlineMatch } from '../useOnlineMatch';
import type { OnlineConn, OnlineStatus } from '../online';
import type { TimerView } from '../useMatch';
import { Flavor } from '../components/Flavor';
import { IconText } from '../components/EngineIcon';

interface Props {
  setup: MatchSetup;
  settings: Settings;
  onExit: () => void;
  onFinish: (s: GameState, setup: MatchSetup) => void;
  /** Where this match is played (named on its replay). */
  label?: string;
  /** A tutorial match: no timers, and the coach explains each step of this lesson. */
  tutorial?: Lesson;
  /** One tap from the result into the mode's next match (Quick match, the next Tower floor or Breach wave). */
  next?: { label: (s: GameState) => string | null; go: (s: GameState, setup: MatchSetup) => void };
}

interface Detail {
  cardId?: string;
  slot?: SlotId;
  owner: PlayerId;
  faceDown?: boolean;
  strain?: number;
}

const PHASE_LABEL = { mulligan: 'Mulligan', stance: 'Choose stance', feint: 'Feint', actions: 'Actions', evolve: 'Evolution', over: 'Match over' } as const;

/** What drives the board: the local engine (vs a bot) or an online room. */
interface Game {
  state: GameState;
  dispatch: (a: Action) => void;
  error: string | null;
  actor: PlayerId | undefined;
  timer: TimerView | null;
  hurry: () => void;
  botActing: boolean;
}

/** A match against the bot (or the tutorial), run here on this device. You are player 1. */
export function MatchScreen(props: Props) {
  const pausedRef = useRef(false);
  const game = useMatch(props.setup, defaultConfig.timers.enabled && !props.tutorial, pausedRef);
  return <MatchView {...props} game={game} me={0} pausedRef={pausedRef} />;
}

/** An online match: the server runs it and sends this player's view; your seat may be player 2. */
export function OnlineMatchScreen({ conn, settings, onExit, onFinish }: { conn: OnlineConn; settings: Settings; onExit: () => void; onFinish: (s: GameState, setup: MatchSetup) => void }) {
  const pausedRef = useRef(false);
  const game = useOnlineMatch(conn);
  return <MatchView setup={game.setup} settings={settings} onExit={onExit} onFinish={onFinish} label="Online match" game={game} me={game.me} pausedRef={pausedRef} online={{ status: game.status, opponentConnected: game.opponentConnected }} />;
}

function MatchView({ setup, settings, onExit, onFinish, label, tutorial, next, game, me, pausedRef, online }: Props & { game: Game; me: PlayerId; pausedRef: MutableRefObject<boolean>; online?: { status: OnlineStatus; opponentConnected: boolean } }) {
  const { state, dispatch, error, actor, timer, hurry, botActing } = game;
  const [coaching, setCoaching] = useState(!!tutorial);
  const [introSeen, setIntroSeen] = useState(() => !!tutorial); // tutorials skip the pre-match briefing
  const [selected, setSelected] = useState<string | null>(null);
  const [faceDown, setFaceDown] = useState(false);
  const [cycleMode, setCycleMode] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [playSheet, setPlaySheet] = useState<PlayRecord | null>(null);
  const [seenPlays, setSeenPlays] = useState(0); // plays before this index have been shown to the current viewer
  const [showHelp, setShowHelp] = useState(false);
  const [confirmingPass, setConfirmingPass] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [evoSheet, setEvoSheet] = useState(false);
  const [evoPick, setEvoPick] = useState(false); // the deferred evolution choice, opened from its banner
  const [viewCard, setViewCard] = useState<string | null>(null); // a card open in the full view
  const [evoEvents, dismissEvo] = useEvolutionEvents(state);
  const clash = useClashEvent(state);
  useMatchSounds(state, me, introSeen);
  // The music turns tense for the match and calms again after.
  useEffect(() => {
    setMusicMood('match');
    return () => {
      setMusicIntensity(0);
      setMusicMood('calm');
    };
  }, []);
  const arrivals = useArrivals(state.players[me].hand.map((c) => c.uid), introSeen);
  const phone = useMediaQuery(PHONE_LANDSCAPE);
  const portrait = useMediaQuery(PHONE_PORTRAIT);
  // Upright on a phone: the board works, so a dismissible tip suggests landscape instead of a wall.
  const [rotateTip, setRotateTip] = useState(() => {
    try {
      return localStorage.getItem('specimen.rotateTipOff') !== '1';
    } catch {
      return true;
    }
  });
  const hideRotateTip = () => {
    setRotateTip(false);
    try {
      localStorage.setItem('specimen.rotateTipOff', '1');
    } catch {
      /* not remembered */
    }
  };

  const over = state.phase === 'over';
  const decisionRef = useRef<HTMLDivElement | null>(null);
  pausedRef.current = !introSeen || !!detail || !!playSheet || showHistory || showHelp || confirmExit || evoSheet || evoPick || !!viewCard;

  // You are always Player 1; the bot is Player 2.
  const opp = other(me);

  // A finished match goes into the loaded save's history (once), for the stats and tips on the Save screen.
  const recorded = useRef(false);
  // A named opponent (Z, the Unregistered Handler) speaks before and after; the lines depend on how often you've met.
  const [encounter] = useState<EncounterLines | null>(() => encounterLines(state.players[other(me)].name, metBefore(loadMatches(), state.players[other(me)].name), state.players[other(me)].worldFaction));
  const [newLore, setNewLore] = useState(0);
  // A side goal for this match (none in tutorials), and what the match unlocked, shown on the result.
  const [objective] = useState<Objective | null>(() => (tutorial ? null : pickObjective(state, me, setup.seed)));
  const [objectivePaid, setObjectivePaid] = useState<number | null>(null);
  const [unlocks, setUnlocks] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [lesson, setLesson] = useState<string | null>(null);
  useEffect(() => {
    if (!over || recorded.current) return;
    recorded.current = true;
    const lore0 = unlockedFragments(loadMatches(), loadProgress());
    recordMatch(matchRecord(state, me));
    if (objective && objectiveDone(objective, state, me)) {
      const p = loadProgress();
      if (p) saveProgress({ ...p, biomass: p.biomass + OBJECTIVE_REWARD, earned: p.earned + OBJECTIVE_REWARD });
      setObjectivePaid(p ? OBJECTIVE_REWARD : 0);
      setTimeout(() => play('objective'), 1700);
    }
    const rs = loadMatches();
    setUnlocks([...newlyUnlocked(rs).map((a) => `${a.icon} ${a.name}`), ...newlyUnlockedMastery(rs).map((c) => `★ ${c.name} unlocked`)]);
    if (!tutorial) {
      // What you're closest to next, and after a loss the one moment that decided it.
      setGoals(nextGoals(rs, loadProgress(), { faction: state.players[me].faction, worldFaction: state.players[me].worldFaction }, label === 'Quick match'));
      if (state.result?.winner === other(me)) {
        const worst = turningPoints(setup, state, me, 5)
          .filter((t) => !t.good)
          .sort((a, b) => b.weight - a.weight)[0];
        if (worst) setLesson(`${/^Round \d/.test(worst.title) ? '' : `Round ${worst.round}: `}${worst.title.replace(/\.$/, '')}. ${worst.detail}`);
      }
    }
    const lore1 = unlockedFragments(loadMatches(), loadProgress());
    const recovered = [...lore1].filter((id) => !lore0.has(id)).length;
    setNewLore(recovered);
    if (recovered) setTimeout(() => play('record'), 2300);
    const w = state.result?.winner;
    saveReplay({ id: `${Date.now()}-${setup.seed}`, at: Date.now(), me, names: [state.players[0].name, state.players[1].name], result: w === me ? 'win' : w == null ? 'draw' : 'loss', rounds: state.round, label, setup, actions: state.history });
  }, [over, state, me, setup, label]);

  // The opponent's plays you have not been shown yet pop up as real cards for a few seconds.
  const unseenOpp = useMemo(() => state.plays.slice(seenPlays).filter((r) => r.player === opp), [state.plays, seenPlays, opp]);
  const toastRecs = unseenOpp.slice(-3);
  const playCount = state.plays.length;
  useEffect(() => {
    if (!introSeen || unseenOpp.length === 0) return;
    const t = setTimeout(() => setSeenPlays(playCount), 3000);
    return () => clearTimeout(t);
  }, [introSeen, unseenOpp.length, playCount]);
  const mine = state.players[me];
  const theirs = state.players[opp];
  const myDecision = actor === me;
  const myTurn = myDecision && state.phase === 'actions' && !state.window;
  const reacting = myDecision && state.phase === 'actions' && !!state.window;

  const legal = useMemo(() => (myTurn ? legalPlays(state, me) : []), [state, myTurn, me]);
  const playable = useMemo(() => new Set(legal.map((a) => (a.type === 'PLAY_CARD' ? a.uid : ''))), [legal]);
  const selCard = selected ? mine.hand.find((c) => c.uid === selected) : undefined;
  const selDef = selCard ? cardOf(selCard.cardId) : undefined;
  const mineHi = useMemo(() => new Set<SlotId>(selected && selDef?.type === 'graft' ? legal.flatMap((a) => (a.type === 'PLAY_CARD' && a.uid === selected && a.slot ? [a.slot] : [])) : []), [legal, selected, selDef]);
  const oppHi = useMemo(() => new Set<SlotId>(selected && selDef?.effect.target === 'enemySlot' ? legal.flatMap((a) => (a.type === 'PLAY_CARD' && a.uid === selected && a.target ? [a.target] : [])) : []), [legal, selected, selDef]);
  const canFaceDown = !!selected && legal.some((a) => a.type === 'PLAY_CARD' && a.uid === selected && a.faceDown);

  const clearSel = () => {
    setSelected(null);
    setFaceDown(false);
    setCycleMode(false);
  };
  const send = (a: Parameters<typeof dispatch>[0]) => {
    clearSel();
    dispatch(a);
  };

  const whyNot = (uid: string): string | null => {
    const c = mine.hand.find((x) => x.uid === uid);
    if (!c) return null;
    const d = cardOf(c.cardId);
    if (d.type === 'protocol') return 'Protocols can only be played in response to your opponent.';
    if (!myTurn) return 'Not your turn.';
    if (playable.has(uid)) return null;
    if (cardCost(state, mine, d) > mine.energy) return `Needs ${cardCost(state, mine, d)} Energy.`;
    if (d.type === 'graft') return `No free ${d.slot} slot.`;
    return 'No valid target.';
  };

  const onMySlot = (slot: SlotId) => {
    if (selected && mineHi.has(slot)) return send({ type: 'PLAY_CARD', player: me, uid: selected, slot, faceDown: faceDown && canFaceDown });
    const g = mine.grafts.find((x) => x.slot === slot);
    if (g) setDetail({ cardId: g.cardId, slot, owner: me, faceDown: g.faceDown, strain: g.strain });
  };
  const onOppSlot = (slot: SlotId) => {
    if (selected && oppHi.has(slot)) return send({ type: 'PLAY_CARD', player: me, uid: selected, target: slot });
    const g = theirs.grafts.find((x) => x.slot === slot);
    if (g) setDetail({ cardId: g.faceDown ? undefined : g.cardId, slot, owner: opp, faceDown: g.faceDown, strain: g.strain });
  };
  // Drag a card onto the board to play it: onto one of your slots (graft), an enemy graft (Sabotage), or
  // anywhere above the hand (an instant). Released anywhere else, it just stays selected.
  const dropCard = (uid: string, el: Element | null) => {
    const acts = legal.filter((a): a is Extract<Action, { type: 'PLAY_CARD' }> => a.type === 'PLAY_CARD' && a.uid === uid && !a.faceDown);
    const slotEl = el?.closest<HTMLElement>('[data-slot]');
    if (slotEl) {
      const slot = slotEl.dataset.slot;
      const mineSlot = Number(slotEl.dataset.owner) === me;
      const a = acts.find((x) => (mineSlot ? x.slot === slot : x.target === slot));
      if (a) return send(faceDown && a.slot ? { ...a, faceDown: true } : a);
    }
    if (el && !el.closest('[data-coach-id="hand"]')) {
      const plain = acts.find((x) => !x.slot && !x.target);
      if (plain) send(plain);
    }
  };
  const handDrag = useHandDrag(myTurn && !cycleMode, (uid) => {
    setSelected(uid);
    setFaceDown(false);
  }, dropCard);
  const onHandClick = (uid: string) => {
    if (selected === uid) return clearSel();
    setSelected(uid);
    setFaceDown(false);
  };
  // A double-click plays a card straight away when it needs no slot or target choice, skipping the
  // extra "select, then confirm" step for the common case of a plain instant.
  const onHandDoubleClick = (uid: string) => {
    if (cycleMode || !myTurn) return;
    // Plays straight away when there is exactly one way to play it: a plain instant, one free slot, one target.
    const matches = legal.filter((a) => a.type === 'PLAY_CARD' && a.uid === uid && !a.faceDown);
    if (matches.length === 1) send(matches[0]);
  };

  // ----- Quality of life: pass confirmation, "nothing to play" hint, keyboard shortcuts -----
  const playableNow = legal.some((a) => a.type === 'PLAY_CARD');
  const nothingToPlay = myTurn && !playableNow;
  const replaceSlots = [...mineHi].filter((sl) => mine.grafts.some((g) => g.slot === sl));
  const historyLen = state.history.length;
  useEffect(() => setConfirmingPass(false), [historyLen, state.phase]);
  const passClick = () => {
    if (playableNow && !confirmingPass) return setConfirmingPass(true);
    send({ type: 'PASS', player: me });
  };
  const binds = settings.keybinds;
  const isKey = (k: string, action: KeyAction) => binds[action].toLowerCase() === k;
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const el = e.target as HTMLElement | null;
    if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (isKey(k, 'help')) return setShowHelp((v) => !v);
    if (k === 'escape') {
      if (confirmExit) setConfirmExit(false);
      else if (showHelp) setShowHelp(false);
      else if (detail) setDetail(null);
      else if (playSheet) setPlaySheet(null);
      else if (showHistory) setShowHistory(false);
      else clearSel();
      return;
    }
    if (!introSeen || over || !myDecision || showHelp || detail || playSheet || showHistory || confirmExit || evoSheet || !!viewCard) return;
    // Stance keys (and 1 / 2 / 3, always) pick a stance; the first two also take the 1st / 2nd evolution option.
    const stanceIdx = isKey(k, 'aggress') || k === '1' ? 0 : isKey(k, 'adapt') || k === '2' ? 1 : isKey(k, 'fortify') || k === '3' ? 2 : undefined;
    if (state.phase === 'mulligan') {
      if (isKey(k, 'keep')) send({ type: 'MULLIGAN', player: me, mulligan: false });
      if (isKey(k, 'mulligan')) send({ type: 'MULLIGAN', player: me, mulligan: true });
    } else if (state.phase === 'stance') {
      if (stanceIdx !== undefined) send({ type: 'PICK_STANCE', player: me, stance: STANCES[stanceIdx] });
    } else if (state.phase === 'feint') {
      if (stanceIdx !== undefined) send({ type: 'FEINT', player: me, stance: STANCES[stanceIdx] });
      if (isKey(k, 'keep')) send({ type: 'FEINT', player: me, stance: null });
    } else if (state.phase === 'evolve') {
      if (isKey(k, 'keep')) send({ type: 'CHOOSE_EVOLUTION', player: me, id: null });
      else if (stanceIdx !== undefined) {
        const opt = mine.evolutionOptions[stanceIdx];
        if (opt) send({ type: 'CHOOSE_EVOLUTION', player: me, id: opt });
      }
    } else if (reacting) {
      if (isKey(k, 'noResponse')) send({ type: 'DECLINE_REACTION', player: me });
    } else if (myTurn) {
      if (isKey(k, 'pass')) passClick();
      else if (isKey(k, 'hold') && !mine.hold) send({ type: 'HOLD', player: me });
      else if (isKey(k, 'cycle') && state.config.features.cycling && mine.cycledThisRound < state.config.cycle.perRound && mine.hand.length) {
        setCycleMode((v) => !v);
        setSelected(null);
      } else if (isKey(k, 'wake')) {
        const g = mine.grafts.find((x) => x.faceDown);
        if (g) send({ type: 'REVEAL', player: me, slot: g.slot });
      } else if (/^[1-9]$/.test(k)) {
        const c = mine.hand[Number(k) - 1];
        if (c) onHandClick(c.uid);
      }
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);
  const kbd = (action: KeyAction) => <span className="ml-1 hidden rounded bg-black/30 px-1 text-[10px] font-normal text-mute sm:inline">{keyLabel(binds[action])}</span>;

  // What happened last round, from the per-round snapshots (shown while picking the next stance).
  const recap = (() => {
    const sn = state.snapshots;
    if (state.phase !== 'stance' || sn.length < 2) return null;
    const cur = sn[sn.length - 1];
    const prev = sn[sn.length - 2];
    const d = (i: 0 | 1) => cur.hp[i] - prev.hp[i];
    const st = (i: 0 | 1) => cur.strain[i] - prev.strain[i];
    const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    return `Round ${cur.round}: you ${fmt(d(me))} HP, ${state.players[opp].name} ${fmt(d(opp))} HP · Strain you ${fmt(st(me))}, them ${fmt(st(opp))}`;
  })();

  const lastStanceLine = [...state.log].reverse().find((l) => l.kind === 'stance' && l.round === state.round)?.text;
  // The Clash as things stand, and what the selected card would change.
  useHitStop(state);
  // Upright, the hand and prompts sit below the Specimens: bring them into view when it's your decision.
  useEffect(() => {
    if (!portrait || !introSeen || !myDecision) return;
    const el = decisionRef.current?.nextElementSibling as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight - 140) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [portrait, introSeen, myDecision, state.phase, state.round]);
  const clashNow = useMemo(() => clashPreview(state, me), [state, me]);
  // The music follows the match: Strain near the line, Meltdown, and low HP on either side raise the tension;
  // the result releases it.
  useEffect(() => {
    if (state.phase === 'over') return setMusicIntensity(0);
    const T = state.config.strain.threshold;
    const strainT = Math.max(0, (mine.strain - T * 0.5) / (T * 0.5)) * 0.4;
    const meltdown = state.round >= state.config.match.meltdownFromRound ? 0.25 : 0;
    const low = Math.min(...state.players.map((p) => p.hp / p.maxHp));
    const hpT = low < 0.35 ? 0.35 * (1 - low / 0.35) + 0.15 : 0;
    setMusicIntensity(strainT + meltdown + hpT);
  }, [state.phase, state.round, mine.strain, state.players, state.config]);
  const selActions = useMemo(() => (selected && !cycleMode ? legal.filter((a): a is Extract<Action, { type: 'PLAY_CARD' }> => a.type === 'PLAY_CARD' && a.uid === selected && !a.faceDown) : []), [legal, selected, cycleMode]);
  // A card with exactly one place to go (one free slot, one target) plays with one more tap, no board hunt.
  const sole = selActions.length === 1 ? selActions[0] : null;
  const previewAction = sole ?? selActions.find((a) => !a.slot || !mine.grafts.some((g) => g.slot === a.slot)) ?? null;
  const selPreview = useMemo(() => (previewAction && myTurn ? playPreview(state, me, previewAction, clashNow) : null), [previewAction, myTurn, state, me, clashNow]);
  const stancesRevealed = state.phase === 'actions' || state.phase === 'feint' || state.phase === 'evolve' || over;

  // ----- Pieces shared by the desktop board and the phone board -----
  /** What you can do with the selected card: cycle it, a reason it can't be played, a targeting hint, or Play. */
  const selectedActions = (compact: boolean) => {
    if (!selected || !selDef) return null;
    const b = compact ? 'rounded-md px-2 py-1 text-[11px] font-bold' : 'rounded-md px-3 py-1.5 font-semibold';
    if (cycleMode) {
      return (
        <>
          <button className={`${b} bg-sky-700`} onClick={() => send({ type: 'CYCLE', player: me, uid: selected, mode: 'vent' })}>
            {compact ? `Vent ${state.config.cycle.ventAmount}` : `Discard → vent ${state.config.cycle.ventAmount}`}
          </button>
          <button className={`${b} bg-sky-700`} onClick={() => send({ type: 'CYCLE', player: me, uid: selected, mode: 'draw' })}>
            {compact ? `Draw ${state.config.cycle.drawAmount}` : `Discard → draw ${state.config.cycle.drawAmount}`}
          </button>
        </>
      );
    }
    const why = whyNot(selected);
    if (why) return <span className="text-amber-300">{why}</span>;
    const previewLine = selPreview && <PreviewLine p={selPreview} compact={compact} />;
    const soleButton = sole && (sole.slot || sole.target) && (
      <button className={`${b} bg-accent text-black`} onClick={() => send(faceDown && sole.slot ? { ...sole, faceDown: true } : sole)}>
        {sole.slot ? `Play to ${SLOT_LABEL[sole.slot]}` : `Play on their ${SLOT_LABEL[sole.target!]}`}
      </button>
    );
    if (selDef.type === 'graft') {
      return (
        <>
          {soleButton}
          {previewLine}
          {!sole && <span className="text-accent">{compact ? 'Tap a glowing slot.' : 'Tap a glowing slot on your Specimen.'}</span>}
          {replaceSlots.length > 0 && <span className="text-amber-300">{compact ? `Filled slot: replace (+${state.config.replace.extraCost}).` : `Occupied glowing slots replace that graft (+${state.config.replace.extraCost} Energy).`}</span>}
          {canFaceDown && (
            <label
              className="flex items-center gap-1 rounded bg-black/40 px-2 py-1 text-ink"
              title={`Asleep: no attack, armor or text until you wake it, and ${state.config.dormant.quietStrain} less Strain now (it comes back when it wakes). Wake it after it has slept through a round for an Ambush: ${ambushText(state.config, mine.faction)} that round. The opponent sees only its slot and Strain.`}
            >
              <input type="checkbox" checked={faceDown} onChange={(e) => setFaceDown(e.target.checked)} /> {compact ? 'Face-down (Ambush)' : `Face-down: asleep, wake later for Ambush (${ambushText(state.config, mine.faction)})`}
            </label>
          )}
        </>
      );
    }
    if (selDef.effect.target === 'enemySlot')
      return (
        <>
          {soleButton ?? <span className="text-accent">Tap a glowing enemy graft.</span>}
          {previewLine}
        </>
      );
    return (
      <>
        <button className={`${b} bg-accent text-black`} onClick={() => send({ type: 'PLAY_CARD', player: me, uid: selected })}>
          Play {selDef.name}
        </button>
        {previewLine}
      </>
    );
  };

  /** Pass (with its "you can still play" confirmation), Hold and Cycle. */
  const actionButtons = (compact: boolean) => {
    const b = compact ? 'rounded-md px-1 py-1.5 font-display text-[12px] font-bold' : 'flex-1 rounded-lg px-3 py-2 text-sm font-semibold';
    return (
      <>
        {confirmingPass ? (
          <div className={`flex flex-wrap items-center gap-1 rounded-lg bg-amber-900/40 text-xs ${compact ? 'flex-col p-1' : 'flex-2 gap-2 px-2 py-1'}`}>
            {!compact && <span className="min-w-0 flex-1">You can still play a card.</span>}
            <button onClick={() => send({ type: 'PASS', player: me })} className={`rounded-md bg-amber-500 px-2 py-1 font-bold text-black ${compact ? 'w-full text-[11px]' : ''}`}>
              Pass anyway
            </button>
            <button onClick={() => setConfirmingPass(false)} className={`rounded-md bg-panel2 px-2 py-1 font-semibold ${compact ? 'w-full text-[11px]' : ''}`}>
              Keep playing
            </button>
          </div>
        ) : (
          <button disabled={!myTurn} onClick={passClick} data-coach-id="pass" className={`${b} disabled:opacity-40 ${nothingToPlay ? 'animate-pulse bg-accent text-black' : 'bg-panel2'}`}>
            Pass{!compact && kbd('pass')}
          </button>
        )}
        {!(compact && confirmingPass) && (
          <button
            disabled={!myTurn || mine.hold}
            onClick={() => send({ type: 'HOLD', player: me })}
            data-coach-id="hold"
            title={`Deal no Clash damage this round, in exchange for +${state.config.strain.holdArmor} armor (reduces what you take) and venting ${state.config.strain.holdVent} Strain now.`}
            className={`${b} bg-panel2 disabled:opacity-40`}
          >
            Hold{!compact && kbd('hold')}
          </button>
        )}
        {state.config.features.cycling && !(compact && confirmingPass) && (
          <button
            disabled={!myTurn || mine.cycledThisRound >= state.config.cycle.perRound || mine.hand.length === 0}
            onClick={() => {
              setCycleMode((v) => !v);
              setSelected(null);
            }}
            className={`${b} disabled:opacity-40 ${cycleMode ? 'bg-sky-700' : 'bg-panel2'}`}
          >
            Cycle{!compact && kbd('cycle')}
          </button>
        )}
      </>
    );
  };

  const overBox = (compact: boolean) => (
    <div className={`pop lab-panel rounded-xl border border-accent text-center ${compact ? 'flex h-full items-center justify-center gap-4 p-2' : 'p-3'}`}>
      <div>
        <div className={`font-display font-bold text-accent ${compact ? 'text-base' : 'text-lg'}`}>{state.result?.winner === null ? 'Draw' : `${state.players[state.result!.winner].name} wins`}</div>
        <div className="text-xs text-ink2">{state.result?.reason}</div>
        {encounter && !compact && (
          <p className="mx-auto mt-2 max-w-md font-serif text-[13px] italic leading-snug text-ink2">
            <LoreText text={state.result?.winner === me ? encounter.win : encounter.loss} />
          </p>
        )}
        {!compact && objective && (
          <div className={`mt-1.5 text-[11px] font-semibold ${objectivePaid !== null ? 'text-emerald-300' : 'text-mute'}`}>
            ◎ {objective.text}: {objectivePaid !== null ? `done${objectivePaid ? ` (+${objectivePaid} biomass)` : ''}` : 'missed'}
          </div>
        )}
        {!compact && unlocks.length > 0 && (
          <div className="mt-1 text-[11px] font-semibold text-amber-200">
            Unlocked: <IconText text={unlocks.join(' · ')} />
          </div>
        )}
        {!compact && lesson && (
          <div className="mx-auto mt-1.5 max-w-lg text-[11.5px] text-ink2">
            <span className="font-semibold text-red-300">What decided it</span> · {lesson}
          </div>
        )}
        {goals.length > 0 && (
          <div className={`mx-auto mt-1 max-w-lg text-[11px] text-sky-200 ${compact ? 'hidden min-[700px]:block' : ''}`}>
            <span className="font-semibold">Next:</span> {goals.join(' · ')}
          </div>
        )}
        {newLore > 0 && <div className="mt-1 text-[11px] font-semibold text-amber-200">◆ {newLore === 1 ? 'A record was' : `${newLore} records were`} recovered. Read {newLore === 1 ? 'it' : 'them'} in the Archive.</div>}
      </div>
      <div className={`flex items-center justify-center gap-2 ${compact ? '' : 'mt-2'}`}>
        {nextLabel ? (
          <>
            <button onClick={() => onFinish(state, setup)} className="rounded-lg border border-accent/60 px-3 py-2 text-sm font-semibold text-accent">
              Results
            </button>
            <button onClick={() => next!.go(state, setup)} autoFocus className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-black">
              {nextLabel} ▶
            </button>
          </>
        ) : (
          <button onClick={() => onFinish(state, setup)} autoFocus className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-black">
            See results
          </button>
        )}
      </div>
    </div>
  );
  const waitingText =
    actor === undefined ? (
      <span className="flex items-center justify-center gap-2">
        {(botOf(state) ?? theirs).name} is thinking…
        {botActing && (
          <button onClick={hurry} className="rounded-md border border-line px-2 py-0.5 text-[11px] font-semibold text-ink2 hover:border-mute" title="Skip the bot's pauses until it's your decision again">
            Hurry ›
          </button>
        )}
      </span>
    ) : (
      'Waiting…'
    );
  const nextLabel = over && next ? next.label(state) : null;
  // Evolution offered without pausing the match: a banner you answer when it suits you.
  const evoOffer = !over && state.phase !== 'mulligan' && state.config.evolution.deferredChoice && mine.evolutionOptions.length > 0;
  const evoForms = (state.config.evolutions as Record<string, { id: string; name: string }[]>)[mine.faction].filter((d) => mine.evolutionOptions.includes(d.id));
  const chooseEvo = (id: string | null) => {
    setEvoPick(false);
    send({ type: 'CHOOSE_EVOLUTION', player: me, id });
  };
  const objectiveChip = objective && !over ? <ObjectiveChip objective={objective} state={state} me={me} /> : null;

  /** Shared overlays: evolution banners, rules help, play history and card sheets, graft detail. */
  const overlays = () => (
    <>
      <EvolutionBanners state={state} events={evoEvents} me={me} onDismiss={dismissEvo} />
      <RoundBanner state={state} />
      <MatchEndOverlay state={state} me={me} />
      <ChainFx state={state} me={me} />
      {online && !over && (online.status === 'reconnecting' || !online.opponentConnected) && (
        <div className="pointer-events-none fixed inset-x-0 top-12 z-[55] flex justify-center" role="status">
          <span className="rounded-full border border-amber-400/60 bg-black/85 px-3 py-1 text-xs font-semibold text-amber-200 shadow-lg">
            {online.status === 'reconnecting' ? 'Connection lost: reconnecting…' : 'Your opponent disconnected. They have 3 minutes to come back, or they forfeit.'}
          </span>
        </div>
      )}
      {handDrag.ghost}
      {evoPick && evoOffer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-2 sm:items-center" onClick={() => setEvoPick(false)}>
          <div className="pop w-full max-w-xl phone:max-h-[94dvh] phone:overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose your evolution">
            <EvolvePrompt state={state} me={me} onPick={(id) => chooseEvo(id)} onDecline={() => chooseEvo(null)} />
            <button onClick={() => setEvoPick(false)} className="mt-2 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink2">
              Decide later (the offer stands until the next Strain check)
            </button>
          </div>
        </div>
      )}
      {coaching && (
        <Coach
          lesson={tutorial}
          ctx={{ state, me, myTurn, reacting, selDef }}
          active={!detail && !playSheet && !showHelp && !viewCard && !evoSheet && !confirmExit && !showHistory}
          onSkip={() => {
            setCoaching(false);
            setLessonDone(tutorial!);
          }}
        />
      )}
      {showHelp && <HelpSheet state={state} keybinds={binds} onClose={() => setShowHelp(false)} />}
      {viewCard && <CardDetail def={cardOf(viewCard)} onClose={() => setViewCard(null)} />}
      {showHistory && <PlayHistory state={state} viewer={me} onClose={() => setShowHistory(false)} onOpen={(r) => setPlaySheet(r)} />}
      {playSheet && <PlaySheet state={state} viewer={me} rec={playSheet} onClose={() => setPlaySheet(null)} />}
      {detail && (
        <DetailSheet
          detail={detail}
          state={state}
          me={me}
          myTurn={myTurn}
          onClose={() => setDetail(null)}
          onReveal={(slot) => {
            setDetail(null);
            send({ type: 'REVEAL', player: me, slot });
          }}
        />
      )}
    </>
  );

  /** Phone held sideways: everything on one screen, no scrolling. Header / panels + tanks / hand-or-prompt strip. */
  const phoneBoard = () => {
    const fan = mine.hand.length >= 8; // overlap cards a little so a full hand still fits the width
    const strip = over ? (
      overBox(true)
    ) : !myDecision ? (
      <div className="lab-panel grid h-full place-items-center rounded-lg border border-line text-sm text-ink2">{waitingText}</div>
    ) : state.phase === 'mulligan' ? (
      <PhoneMulligan state={state} me={me} onInspect={setViewCard} onKeep={() => send({ type: 'MULLIGAN', player: me, mulligan: false })} onMull={() => send({ type: 'MULLIGAN', player: me, mulligan: true })} />
    ) : state.phase === 'stance' ? (
      <PhoneStance state={state} me={me} onPick={(st) => send({ type: 'PICK_STANCE', player: me, stance: st })} />
    ) : state.phase === 'feint' ? (
      <PhoneFeint state={state} me={me} onPick={(st) => send({ type: 'FEINT', player: me, stance: st })} />
    ) : state.phase === 'evolve' ? (
      <PhoneEvolve state={state} me={me} onPick={(id) => send({ type: 'CHOOSE_EVOLUTION', player: me, id })} onDecline={() => send({ type: 'CHOOSE_EVOLUTION', player: me, id: null })} />
    ) : reacting && state.window ? (
      <PhoneReaction state={state} me={me} onAct={(a) => send(a)} onInspect={setViewCard} />
    ) : (
      <section className={`lab-panel flex h-full min-h-0 gap-1.5 rounded-lg border p-1.5 ${myTurn ? 'border-accent/70' : 'border-line'}`} aria-label="Your hand" data-coach-id="hand">
        {selDef && selected ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 pt-1">
            <CardView def={selDef} cost={cardCost(state, mine, selDef)} size="xs" selected onClick={() => setViewCard(selDef.id)} />
            <div className="min-w-0 flex-1 text-[10px] leading-snug">
              <div className="font-display text-[12px] font-bold">{selDef.name}</div>
              <button onClick={() => setViewCard(selDef.id)} className="line-clamp-2 text-left text-ink2" title="Show the full card">
                {selDef.text} <span className="text-accent">· full card</span>
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">{selectedActions(true)}</div>
            </div>
            <button onClick={clearSel} className="self-start rounded border border-line px-1.5 py-0.5 text-xs text-ink2" aria-label="Put the card back">
              ✕
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-2 px-0.5 text-[9px] leading-none">
              <span className="text-mute">
                Hand {mine.hand.length}/{state.config.match.maxHand} · hold a card to read it
                {mine.hand.length >= state.config.match.maxHand && <span className="ml-1 text-amber-300">full</span>}
              </span>
              {myTurn && <span className="truncate text-accent">{cycleMode ? 'Pick a card to cycle' : playableNow ? 'Tap a card' : 'Nothing playable: Pass or Cycle'}</span>}
              {!myTurn && <span className="text-mute">Waiting for {state.players[state.turn].name}…</span>}
            </div>
            <div className="flex min-h-0 flex-1 items-end justify-center pb-0.5 pt-1.5">
              {mine.hand.length === 0 && <span className="self-center text-xs text-mute">Your hand is empty.</span>}
              {mine.hand.map((c, i) => {
                const d = cardOf(c.cardId);
                const dim = !cycleMode && !playable.has(c.uid);
                const combo = dim || arrivals.has(c.uid) ? null : comboEngine(d, mine);
                return (
                  <div
                    key={c.uid}
                    {...handDrag.bind(c.uid, <CardView def={d} size="xs" />, !dim)}
                    {...tiltHandlers}
                    className={`${i > 0 ? (fan ? '-ml-3' : 'ml-1') : ''} ${arrivals.has(c.uid) ? 'card-draw' : 'hand-tilt'} ${combo ? 'combo-glow rounded-lg' : ''}`}
                    style={{ ...tiltStyle, ...(arrivals.has(c.uid) ? { '--i': `${arrivals.get(c.uid)! * 90}ms` } : {}), ...(combo ? { '--eng': engineColor(combo) } : {}) } as React.CSSProperties}
                    title={combo ? `Combo: sets off your ${ENGINE_META[combo].name} payoff` : undefined}
                  >
                    <CardView def={d} cost={cardCost(state, mine, d)} size="xs" dim={dim} reason={dim ? (whyNot(c.uid) ?? undefined) : undefined} onClick={() => onHandClick(c.uid)} onDoubleClick={() => onHandDoubleClick(c.uid)} onInspect={() => setViewCard(c.cardId)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex w-[72px] shrink-0 flex-col justify-center gap-1">{actionButtons(true)}</div>
      </section>
    );
    const tank = (p: PlayerId, side: 'left' | 'right') => (
      <div className={`relative h-full ${clashClasses(clash, p, side)}`} style={clashStyle(clash, p)}>
        <Specimen state={state} player={p} viewer={me} flip={side === 'left'} fill color={PLAYER_COLORS[p]} highlight={p === me ? mineHi : oppHi} onSlot={p === me ? onMySlot : onOppSlot} />
        <ClashDamage ev={clash} player={p} />
        {stancesRevealed && state.players[p].stance && (
          <div className="pointer-events-none absolute inset-x-0 bottom-1 z-10 flex justify-center">
            <StanceBadge state={state} player={p} show />
          </div>
        )}
      </div>
    );
    return (
      <div
        className="fixed inset-0 flex flex-col gap-1 overflow-hidden p-1"
        style={{ paddingLeft: 'max(4px, env(safe-area-inset-left))', paddingRight: 'max(4px, env(safe-area-inset-right))', paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }}
      >
        <header className="lab-panel relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-1.5">
          <button onClick={() => (over ? onExit() : setConfirmExit(true))} className="rounded border border-line px-1.5 text-xs text-ink2" aria-label="Leave match">
            ✕
          </button>
          <span className="whitespace-nowrap font-display text-xs font-bold">
            R{Math.max(state.round, 1)}
            <span className="text-mute">/{state.config.match.maxRounds}</span>
          </span>
          {state.round >= state.config.match.meltdownFromRound && <span className="hazard hazard-scroll rounded px-1 font-display text-[8px] font-bold"><span className="bg-black/80 px-0.5 text-amber-300">MELTDOWN</span></span>}
          {!over && myTurn ? (
            <span className="turn-glow rounded bg-accent px-1.5 font-display text-[11px] font-bold text-black">YOUR TURN</span>
          ) : !over && reacting ? (
            <span className="turn-glow rounded bg-amber-400 px-1.5 font-display text-[11px] font-bold text-black">RESPOND?</span>
          ) : (
            <span className="truncate font-display text-[10px] font-semibold uppercase tracking-wider text-accent">{state.phase === 'actions' ? `${state.players[state.window ? state.window.reactor : state.turn].name}'s turn` : PHASE_LABEL[state.phase]}</span>
          )}
          {lastStanceLine && state.phase !== 'stance' && <span className="hidden min-w-0 truncate text-[10px] text-sky-300 min-[760px]:inline">{lastStanceLine}</span>}
          {clashNow && !over && <ClashChip p={clashNow} compact />}
          {objectiveChip && <span className="hidden min-w-0 min-[700px]:inline-flex">{objectiveChip}</span>}
          {evoOffer && (
            <button onClick={() => setEvoPick(true)} className="turn-glow shrink-0 rounded bg-violet-400 px-1.5 font-display text-[11px] font-bold text-black">
              ✦ Evolve
            </button>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {timer && <TimerBadge timer={timer} who={actor!} />}
            <button onClick={() => setShowHistory(true)} className="rounded border border-line px-1.5 text-[11px] text-ink2">
              Plays
            </button>
            <button onClick={() => setShowLog(true)} className="rounded border border-line px-1.5 text-[11px] text-ink2">
              Log
            </button>
            <SoundToggle size="xs" />
            <button onClick={() => setShowHelp(true)} className="rounded border border-line px-1.5 text-[11px] text-ink2" aria-label="Help">
              ?
            </button>
          </div>
          {confirmExit && (
            <div className="pop absolute left-1 top-full z-50 mt-1 flex w-64 flex-col gap-2 rounded-xl border border-red-500/60 bg-panel p-2.5 text-xs shadow-xl" role="dialog" aria-label="Leave match?">
              <div className="font-bold">Leave this match? It can't be resumed.</div>
              <div className="flex gap-2">
                <button onClick={onExit} className="flex-1 rounded-lg bg-red-700 px-2 py-1.5 font-bold">
                  Leave
                </button>
                <button onClick={() => setConfirmExit(false)} className="flex-1 rounded-lg bg-panel2 px-2 py-1.5 font-semibold">
                  Keep playing
                </button>
              </div>
            </div>
          )}
        </header>

        {error && <div className="pointer-events-none fixed left-1/2 top-10 z-50 -translate-x-1/2 rounded-lg border border-red-500/50 bg-red-950/90 px-3 py-1 text-xs text-red-200">{error}</div>}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-1">
          <div className="min-h-0 min-w-0 rounded-lg" data-coach-id="me">
            <PlayerPanelCompact state={state} player={me} viewer={me} color={PLAYER_COLORS[me]} active={myDecision} onSheet={setEvoSheet} />
          </div>
          <section className="relative flex h-full min-h-0 items-center gap-1" aria-label="Arena">
            <PlayToast state={state} viewer={me} recs={toastRecs} onDismiss={() => setSeenPlays(playCount)} onOpen={setPlaySheet} />
            {tank(me, 'left')}
            <div className="relative flex h-full w-3 flex-col items-center justify-center">
              <span className="font-display text-[9px] font-bold text-mute [writing-mode:vertical-rl]">VS</span>
              <ClashBurst ev={clash} />
            </div>
            {tank(opp, 'right')}
          </section>
          <PlayerPanelCompact state={state} player={opp} color={PLAYER_COLORS[opp]} active={state.phase === 'actions' && (state.window ? state.window.reactor : state.turn) === opp} onSheet={setEvoSheet} viewer={me} />
        </div>

        <div className="h-[100px] shrink-0">{strip}</div>

        {showLog && (
          <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={() => setShowLog(false)}>
            <div className="pop flex h-full w-[min(320px,85vw)] flex-col gap-1 bg-bg p-1.5" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setShowLog(false)} className="self-end rounded border border-line px-2 text-xs text-ink2">
                Close log
              </button>
              <LogPanel log={state.log} className="min-h-0 flex-1" />
            </div>
          </div>
        )}
        {overlays()}
      </div>
    );
  };

  // ----- Overlays that replace the board entirely -----
  if (!introSeen)
    return (
      <Intro
        state={state}
        encounter={encounter}
        me={me}
        objective={objective}
        onGo={() => {
          tryLandscapeFullscreen();
          setIntroSeen(true);
        }}
        onExit={onExit}
      />
    );
  if (phone) return phoneBoard();

  return (
    <div className="mx-auto grid min-h-dvh max-w-6xl gap-2 p-2 lg:h-dvh lg:min-h-0 lg:max-w-[1500px] lg:grid-cols-[minmax(0,1fr)_300px] lg:overflow-hidden">
      <main className="flex min-w-0 flex-col gap-2 lg:min-h-0">
        {/* Header */}
        <header className="lab-panel relative flex items-center gap-2 rounded-xl border border-line px-3 py-2">
          <button onClick={() => (over ? onExit() : setConfirmExit(true))} className="rounded-md border border-line px-2 py-1 text-xs text-ink2 hover:border-mute" aria-label="Leave match" title="Leave match">
            ✕
          </button>
          <div className="whitespace-nowrap font-display text-sm font-bold">
            <span className="text-mute">
              <span className="hidden sm:inline">ROUND </span>
              <span className="sm:hidden">R</span>
            </span>
            {Math.max(state.round, 1)}
            <span className="text-mute">/{state.config.match.maxRounds}</span>
          </div>
          {state.round >= state.config.match.meltdownFromRound && (
            <span className="hazard hazard-scroll rounded px-1.5 py-0.5 font-display text-[9px] font-bold text-black" title={`Meltdown: both Specimens gain ${state.config.match.meltdownStrain} Strain each round from round ${state.config.match.meltdownFromRound}.`}>
              <span className="rounded-sm bg-black/80 px-1 text-amber-300">MELTDOWN</span>
            </span>
          )}
          {!over && myTurn ? (
            <span className="turn-glow rounded-md bg-accent px-2 py-0.5 font-display text-xs font-bold tracking-wider text-black">YOUR TURN</span>
          ) : !over && reacting ? (
            <span className="turn-glow rounded-md bg-amber-400 px-2 py-0.5 font-display text-xs font-bold tracking-wider text-black">RESPOND?</span>
          ) : state.phase === 'actions' && !over ? (
            <div className="flex min-w-0 items-center gap-1 text-xs text-ink2" title={state.window ? 'May respond' : 'Turn'}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[state.window ? state.window.reactor : state.turn] }} />
              <span className="truncate">
                {state.players[state.window ? state.window.reactor : state.turn].name}
                {state.window ? ' may respond' : "'s turn"}
              </span>
            </div>
          ) : (
            <div className="truncate font-display text-xs font-semibold uppercase tracking-wider text-accent">{PHASE_LABEL[state.phase]}</div>
          )}
          {objectiveChip && <span className="ml-auto hidden min-w-0 md:inline-flex">{objectiveChip}</span>}
          {confirmExit && (
            <div className="pop absolute left-2 top-full z-40 mt-1 flex w-72 flex-col gap-2 rounded-xl border border-red-500/60 bg-panel p-3 text-xs shadow-xl" role="dialog" aria-label="Leave match?">
              <div className="font-bold">Leave this match?</div>
              <div className="text-ink2">The match is abandoned and can't be resumed.</div>
              <div className="flex gap-2">
                <button onClick={onExit} className="flex-1 rounded-lg bg-red-700 px-3 py-1.5 font-bold">
                  Leave
                </button>
                <button onClick={() => setConfirmExit(false)} className="flex-1 rounded-lg bg-panel2 px-3 py-1.5 font-semibold" autoFocus>
                  Keep playing
                </button>
              </div>
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {timer && <TimerBadge timer={timer} who={actor!} />}
            <SoundToggle size="sm" />
            <button onClick={() => setShowHelp(true)} className="rounded-md border border-line px-2 py-1 text-xs text-ink2 hover:border-mute" title="Quick rules and keyboard shortcuts (?)" aria-label="Help">
              ?
            </button>
            <button onClick={() => setShowHistory(true)} className="whitespace-nowrap rounded-md border border-line px-2 py-1 text-xs text-ink2 hover:border-mute" title="Every card played this match">
              Plays{state.plays.length > 0 ? ` (${state.plays.length})` : ''}
            </button>
            <button onClick={() => setShowLog((v) => !v)} className="rounded-md border border-line px-2 py-1 text-xs text-ink2 hover:border-mute lg:hidden">
              Log
            </button>
          </div>
        </header>

        {error && <div className="rounded-lg border border-red-500/50 bg-red-950/40 px-3 py-1.5 text-xs text-red-200">{error}</div>}

        {/* Mobile: opponent, arena, me stacked. Desktop: me | arena | opponent on one row. */}
        <div className="flex flex-col gap-2 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[250px_minmax(0,1fr)_250px] lg:items-start lg:overflow-y-auto">
          <div className="lg:order-3">
            <PlayerPanel state={state} player={opp} viewer={me} onSheet={setEvoSheet} color={PLAYER_COLORS[opp]} active={state.phase === 'actions' && (state.window ? state.window.reactor : state.turn) === opp} />
          </div>

          {/* Arena: the two Specimens face each other */}
          <section className="relative rounded-xl border border-line bg-[radial-gradient(ellipse_at_50%_40%,rgba(123,224,176,0.06),transparent_65%)] px-1.5 py-2 lg:order-2 lg:flex lg:flex-col lg:justify-center lg:self-stretch" aria-label="Arena">
            <div className="mb-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1 text-center">
              <span className="lab-label truncate" style={{ color: PLAYER_COLORS[me] }}>
                {mine.name} · you
              </span>
              <span className="w-8" />
              <span className="lab-label truncate" style={{ color: PLAYER_COLORS[opp] }}>
                {theirs.name}
              </span>
            </div>
            <PlayToast state={state} viewer={me} recs={toastRecs} onDismiss={() => setSeenPlays(playCount)} onOpen={setPlaySheet} />
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
              <div className={clashClasses(clash, me, 'left')} style={clashStyle(clash, me)}>
                {/* The artwork's creature looks to its left, so the left-hand (your) tank is mirrored: both face the middle. */}
                <div className="relative">
                  <Specimen state={state} player={me} viewer={me} flip color={PLAYER_COLORS[me]} highlight={mineHi} onSlot={onMySlot} />
                  <ClashDamage ev={clash} player={me} />
                </div>
                <StanceBadge state={state} player={me} show={stancesRevealed} />
              </div>
              <div className="relative flex flex-col items-center gap-1 px-0.5">
                <span className="h-10 w-px bg-linear-to-b from-transparent to-line" />
                <span className="font-display text-[11px] font-bold tracking-widest text-mute">VS</span>
                <span className="h-10 w-px bg-linear-to-t from-transparent to-line" />
                <ClashBurst ev={clash} />
              </div>
              <div className={clashClasses(clash, opp, 'right')} style={clashStyle(clash, opp)}>
                <div className="relative">
                  <Specimen state={state} player={opp} viewer={me} color={PLAYER_COLORS[opp]} highlight={oppHi} onSlot={onOppSlot} />
                  <ClashDamage ev={clash} player={opp} />
                </div>
                <StanceBadge state={state} player={opp} show={stancesRevealed} />
              </div>
            </div>
            {lastStanceLine && state.phase !== 'stance' && <div className="mx-1 mt-1 rounded-lg bg-sky-950/40 px-3 py-1 text-center text-xs text-sky-200">{lastStanceLine}</div>}
            {clashNow && !over && (
              <div className="mx-1 mt-1 flex justify-center">
                <ClashChip p={clashNow} />
              </div>
            )}
            {recap && <div className="mx-1 mt-1 rounded-lg bg-black/30 px-3 py-1 text-center text-xs text-ink2">{recap}</div>}
            <PlaysStrip state={state} viewer={me} onOpen={setPlaySheet} />
          </section>

          <div className="rounded-xl lg:order-1" data-coach-id="me">
            <PlayerPanel state={state} player={me} viewer={me} onSheet={setEvoSheet} color={PLAYER_COLORS[me]} active={myDecision} />
          </div>
        </div>

        {/* Prompt / hand */}
        {portrait && rotateTip && <RotateTip onDismiss={hideRotateTip} />}
        {evoOffer && (
          <div className="pop flex items-center gap-2 rounded-xl border-2 border-violet-400/70 bg-violet-950/40 px-3 py-2 text-sm" role="status">
            <span className="font-display font-bold text-violet-200">✦ Evolution ready</span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink2">{evoForms.map((d) => d.name).join(' or ')}: choose whenever you like this round.</span>
            <button onClick={() => setEvoPick(true)} className="rounded-lg bg-violet-400 px-3 py-1 text-xs font-bold text-black">
              Choose
            </button>
          </div>
        )}
        <div ref={decisionRef} className="contents" />
        {over ? (
          overBox(false)
        ) : !myDecision ? (
          <div className="rounded-xl border border-line bg-panel p-3 text-center text-sm text-ink2">{waitingText}</div>
        ) : state.phase === 'mulligan' ? (
          <MulliganPrompt onInspect={setViewCard} hand={mine.hand} onKeep={() => send({ type: 'MULLIGAN', player: me, mulligan: false })} onMull={() => send({ type: 'MULLIGAN', player: me, mulligan: true })} state={state} me={me} seconds={defaultConfig.timers.enabled ? state.config.timers.mulliganSeconds : null} />
        ) : state.phase === 'stance' ? (
          <StancePrompt state={state} me={me} onPick={(st) => send({ type: 'PICK_STANCE', player: me, stance: st })} />
        ) : state.phase === 'feint' ? (
          <FeintPrompt state={state} me={me} onPick={(st) => send({ type: 'FEINT', player: me, stance: st })} />
        ) : state.phase === 'evolve' ? (
          <EvolvePrompt
            state={state}
            me={me}
            onPick={(id) => send({ type: 'CHOOSE_EVOLUTION', player: me, id })}
            onDecline={() => send({ type: 'CHOOSE_EVOLUTION', player: me, id: null })}
          />
        ) : reacting && state.window ? (
          <ReactionPrompt state={state} me={me} onAct={(a) => send(a)} onInspect={setViewCard} />
        ) : (
          <section className={`lab-panel shrink-0 rounded-xl border p-2 ${myTurn ? 'border-accent/70' : 'border-line'}`} aria-label="Your hand" data-coach-id="hand">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="lab-label">
                  Hand · {mine.hand.length}/{state.config.match.maxHand}
                  <span className="ml-2 normal-case tracking-normal text-mute">right-click or hold a card to read it</span>
                  {mine.hand.length >= state.config.match.maxHand && <span className="ml-2 normal-case tracking-normal text-amber-300">full: new draws are burned</span>}
                </span>
                {myTurn && !cycleMode && (
                  <span className="truncate text-[11px] text-accent">{selected ? 'Tap where it goes, or double-tap the card to play it now' : playableNow ? 'Tap a card to pick it up' : 'Nothing playable — Pass or Cycle'}</span>
                )}
              </div>
              <div className="scroll-thin flex flex-wrap content-start justify-center gap-2.5 overflow-y-auto px-2 pb-3 pt-4 lg:max-h-[48vh]">
                {mine.hand.length === 0 && <div className="p-3 text-xs text-mute">Your hand is empty.</div>}
                {mine.hand.map((c, i) => {
                  const d = cardOf(c.cardId);
                  const dim = !cycleMode && !playable.has(c.uid);
                  const combo = dim || arrivals.has(c.uid) ? null : comboEngine(d, mine);
                  return (
                    <div
                      key={c.uid}
                      {...handDrag.bind(c.uid, <CardView def={d} size="sm" />, !dim)}
                      {...tiltHandlers}
                      className={`${arrivals.has(c.uid) ? 'card-draw' : 'hand-tilt'} ${combo ? 'combo-glow rounded-xl' : ''}`}
                      style={{ ...tiltStyle, ...(arrivals.has(c.uid) ? { '--i': `${arrivals.get(c.uid)! * 90}ms` } : {}), ...(combo ? { '--eng': engineColor(combo) } : {}) } as React.CSSProperties}
                      title={combo ? `Combo: sets off your ${ENGINE_META[combo].name} payoff` : undefined}
                    >
                    <CardView
                      def={d}
                      cost={cardCost(state, mine, d)}
                      selected={selected === c.uid}
                      dim={dim}
                      reason={dim ? (whyNot(c.uid) ?? undefined) : undefined}
                      hotkey={i < 9 ? String(i + 1) : undefined}
                      onClick={() => onHandClick(c.uid)}
                      onDoubleClick={() => onHandDoubleClick(c.uid)}
                      onInspect={() => setViewCard(c.cardId)}
                      size={mine.hand.length > 7 ? 'sm' : 'md'}
                    />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col justify-end">
            {selDef && selected && (
              <div className="mb-2 rounded-lg bg-black/30 p-2 text-xs">
                <div className="font-bold">
                  {selDef.name} <span className="font-normal text-ink2">— {selDef.text}</span>
                  <button onClick={() => setViewCard(selDef.id)} className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink2 hover:border-mute">
                    Full card
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">{selectedActions(false)}</div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">{actionButtons(false)}</div>
            {nothingToPlay && <div className="mt-1.5 text-center text-[11px] text-accent">Nothing you can play right now. Pass to end your turn.</div>}
            {cycleMode && !selected && <div className="mt-1.5 text-center text-[11px] text-sky-300">Cycle: tap a card to discard, then choose vent or draw.</div>}
            {!myTurn && <div className="mt-1.5 text-center text-[11px] text-mute">Waiting for {state.players[state.turn].name}…</div>}
            </div>
          </section>
        )}
      </main>

      <aside className={`${showLog ? 'block' : 'hidden'} flex-col gap-2 lg:flex`}>
        <LogPanel log={state.log} className="h-56 lg:h-[calc(100dvh-1rem)]" />
      </aside>

      {overlays()}
    </div>
  );
}

/** Phone held upright during a match: ask to rotate (the board is designed for landscape). */
/** Upright on a phone: a tip, not a wall. The board works this way; sideways just fits it on one screen. */
function RotateTip({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-ink2" role="note">
      <span className="rotate-hint grid h-7 w-4 shrink-0 place-items-center rounded border-2 border-accent" aria-hidden>
        <span className="h-0.5 w-2 rounded-full bg-accent/60" />
      </span>
      <span className="min-w-0 flex-1">Tip: turn your phone sideways to see the whole board at once.</span>
      <button onClick={onDismiss} className="shrink-0 px-1 text-mute" aria-label="Hide this tip">
        ✕
      </button>
    </div>
  );
}

const botOf = (s: GameState) => s.players.find((p) => p.isBot);

// ---------- Small pieces ----------
function StanceBadge({ state, player, show }: { state: GameState; player: PlayerId; show: boolean }) {
  const st = state.players[player].stance;
  if (!show || !st) return <div className="h-6" />;
  const m = STANCE_META[st];
  const winner = state.stanceResult?.winner;
  // Revealed stances flip over together each round; then the winner pops and glows and the loser dims.
  const outcome = winner === undefined || winner === null ? 'stance-tie' : winner === player ? 'stance-win' : 'stance-lose';
  return (
    <div key={`${state.round}:${st}`} className={`stance-flip ${outcome} mx-auto mt-1 w-fit rounded-full px-2.5 py-0.5 text-[11px] font-bold ${winner === player ? 'bg-accent text-black' : 'bg-black/50 text-ink2'}`}>
      {m.glyph} {m.name}
      {winner === player && ' ✓'}
    </div>
  );
}

function TimerBadge({ timer, who }: { timer: TimerView; who: PlayerId }) {
  const pct = Math.max(0, (timer.left / timer.limit) * 100);
  const urgent = timer.left <= 5 && timer.left > 0;
  return (
    <div className={`flex items-center gap-1.5 rounded px-0.5 text-[11px] ${urgent ? 'timer-urgent' : ''}`} aria-label="Timer">
      <div className="h-1.5 w-8 overflow-hidden rounded bg-black/50 sm:w-14">
        <div className={`h-full transition-[width] duration-1000 ease-linear ${urgent ? 'bg-red-500' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
      <span key={urgent ? timer.left : 'n'} className={`inline-block w-7 font-bold tabular-nums ${urgent ? 'timer-tick text-red-400' : ''}`}>
        {timer.left}s
      </span>
      <span className={`tabular-nums ${timer.usingReserve ? 'font-bold text-amber-300' : 'hidden text-mute sm:inline'}`} title="Reserve time left">
        +{timer.reserve[who]}s
      </span>
    </div>
  );
}

function PromptBox({ title, children, coach }: { title: string; children: React.ReactNode; coach?: string }) {
  return (
    <section className="pop lab-panel rounded-xl border border-accent/60 p-2.5" data-coach-id={coach}>
      <div className="mb-2 font-display text-sm font-bold">{title}</div>
      {children}
    </section>
  );
}

function MulliganPrompt({ hand, onKeep, onMull, state, me, seconds, onInspect }: { hand: { uid: string; cardId: string }[]; onKeep: () => void; onMull: () => void; state: GameState; me: PlayerId; seconds: number | null; onInspect: (cardId: string) => void }) {
  return (
    <PromptBox title={`Opening hand: keep it or take your free mulligan (redraw all 5)?${seconds ? ` Take your time: you have ${seconds} seconds.` : ''}`} coach="mulligan">
      <div className="scroll-thin flex gap-2 overflow-x-auto px-1 pb-2 pt-3">
        {hand.map((c) => {
          const d = cardOf(c.cardId);
          return <CardView key={c.uid} def={d} cost={cardCost(state, state.players[me], d)} onClick={() => onInspect(c.cardId)} onInspect={() => onInspect(c.cardId)} />;
        })}
      </div>
      <div className="flex gap-2">
        <button onClick={onKeep} className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-black">
          Keep
        </button>
        <button onClick={onMull} className="flex-1 rounded-lg bg-panel2 px-3 py-2 text-sm font-bold">
          Mulligan
        </button>
      </div>
    </PromptBox>
  );
}

function StanceButtons({ onPick, disabledStance }: { onPick: (s: Stance) => void; disabledStance?: Stance }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {STANCES.map((st) => {
        const m = STANCE_META[st];
        return (
          <button key={st} disabled={disabledStance === st} onClick={() => onPick(st)} className="group rounded-xl border border-line bg-panel2 p-2.5 text-center transition hover:-translate-y-0.5 hover:border-accent hover:bg-accent/10 disabled:opacity-40">
            <div className="text-3xl transition group-hover:scale-110">{m.glyph}</div>
            <div className="mt-0.5 font-display text-base font-bold">{m.name}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-ink2">{m.text}</div>
            <div className="mt-1 text-[10px] text-mute">loses to {STANCES.find((o) => STANCE_META[o].beats === m.name) ? STANCE_META[STANCES.find((o) => STANCE_META[o].beats === m.name)!].name : '—'}</div>
          </button>
        );
      })}
    </div>
  );
}

function StancePrompt({ state, me, onPick }: { state: GameState; me: PlayerId; onPick: (s: Stance) => void }) {
  const last = state.players[other(me)].stanceHistory.at(-1);
  return (
    <PromptBox title="Pick your stance (secret until both players have chosen)" coach="stance">
      {last && <div className="mb-2 text-[11px] text-mute">Opponent's last stance: {STANCE_META[last].name}</div>}
      <StanceButtons onPick={onPick} />
    </PromptBox>
  );
}

function FeintPrompt({ state, me, onPick }: { state: GameState; me: PlayerId; onPick: (s: Stance | null) => void }) {
  const st = state.players[me].stance!;
  const params = findNode('feint')?.params ?? {};
  const price = [params.strain ? `gain ${params.strain} Strain` : '', params.damage ? `take ${params.damage} damage` : ''].filter(Boolean);
  return (
    <PromptBox title={`Stances tied on ${STANCE_META[st].name}. Use Feint? (once per match)`}>
      <div className="mb-2 text-[11px] text-ink2">
        Re-pick your stance; your opponent keeps {STANCE_META[state.players[other(me)].stance!].name}.
        {price.length > 0 && <> Price: {price.join(' and ')}.</>}
      </div>
      <StanceButtons onPick={onPick} />
      <button onClick={() => onPick(null)} className="mt-2 w-full rounded-lg bg-panel2 px-3 py-2 text-sm font-semibold">
        Keep {STANCE_META[st].name} (save Feint)
      </button>
    </PromptBox>
  );
}

function EvolvePrompt({ state, me, onPick, onDecline }: { state: GameState; me: PlayerId; onPick: (id: string) => void; onDecline: () => void }) {
  const p = state.players[me];
  const defs = (state.config.evolutions as Record<string, { id: string; name: string; text: string }[]>)[p.faction].filter((d) => p.evolutionOptions.includes(d.id));
  const both = defs.length > 1;
  return (
    <PromptBox title={both ? 'Both evolution conditions are met. Choose your form, or hold off.' : `Your condition for ${defs[0]?.name} is met. Evolve now, or hold off?`}>
      <div className="grid gap-2 sm:grid-cols-2">
        {defs.map((d) => (
          <button key={d.id} onClick={() => onPick(d.id)} className="rounded-xl border border-line bg-panel2 p-2 text-left hover:border-accent">
            <div className="text-sm font-bold text-accent">{d.name}</div>
            <div className="text-[11px] text-ink2">{d.text}</div>
            <ul className="mt-1 space-y-0.5 text-[11px]">
              {evolutionBoosts(state, p, d.id).map((b) => (
                <li key={b}>
                  <span className="text-accent">▲</span> {b}
                </li>
              ))}
            </ul>
            <Flavor text={EVOLUTION_FLAVOR[d.id]} className="mt-1.5 text-[11px]" />
          </button>
        ))}
      </div>
      <button onClick={onDecline} className="mt-2 w-full rounded-lg bg-panel2 px-3 py-2 text-sm font-semibold hover:border hover:border-mute">
        Hold off (evolving is permanent; you'll be asked again while the condition still holds)
      </button>
    </PromptBox>
  );
}

function ReactionPrompt({ state, me, onAct, onInspect }: { state: GameState; me: PlayerId; onAct: (a: Action) => void; onInspect: (cardId: string) => void }) {
  const w = state.window!;
  const options = reactionOptions(state, me, w.play);
  const inc = incomingInfo(state, me, w.play);
  const opp = state.players[w.play.player];
  return (
    <PromptBox title={`${opp.name} is playing ${inc.name} ${inc.aim}. Respond with a Protocol?`}>
      <div className="scroll-thin flex items-start gap-3 overflow-x-auto px-1 pb-2 pt-3">
        {/* The play you would be answering, clearly separated from your options. */}
        <div className="flex shrink-0 flex-col items-center gap-1 rounded-xl border border-red-500/50 bg-red-950/20 p-1.5">
          <span className="rounded bg-red-700 px-1.5 font-display text-[10px] font-bold tracking-widest text-white">INCOMING</span>
          {inc.def ? (
            <CardView def={inc.def} onClick={() => onInspect(inc.def!.id)} onInspect={() => onInspect(inc.def!.id)} />
          ) : (
            <div className="grid h-[198px] w-[132px] place-items-center rounded-xl border border-line bg-[repeating-linear-gradient(45deg,#1b2521_0_6px,#111916_6px_12px)] p-2 text-center text-xs text-mute">Face-down graft (hidden)</div>
          )}
          <span className="max-w-[132px] text-center text-[11px] font-semibold leading-tight text-amber-200">{inc.aim}</span>
        </div>
        <div className="self-center font-display text-sm font-bold text-mute">VS</div>
        {options.map((a) => {
          if (a.type !== 'REACT') return null;
          if (a.ability === 'pressureValve') {
            return (
              <button key="valve" onClick={() => onAct(a)} className="h-[198px] w-[132px] shrink-0 rounded-xl border border-accent bg-panel2 p-2 text-left">
                <div className="text-[10px] font-bold uppercase text-accent">Skill</div>
                <div className="text-sm font-bold">Pressure Valve</div>
                <div className="mt-1 text-[10px] text-ink2">{findNode('pressureValve')?.text}</div>
                <div className="mt-1 text-[10px] text-mute">Doesn't stop the play.</div>
              </button>
            );
          }
          const c = state.players[me].hand.find((x) => x.uid === a.uid)!;
          const d = cardOf(c.cardId);
          const v = protocolVerdict(d, inc.def ? inc.name : 'it');
          return (
            <div key={c.uid} className="flex w-[132px] shrink-0 flex-col items-center gap-1">
              <span className={`rounded px-1.5 font-display text-[10px] font-bold tracking-wider ${VERDICT_CLASS[v.kind]}`}>{v.short}</span>
              <CardView def={d} cost={cardCost(state, state.players[me], d)} onClick={() => onAct(a)} onInspect={() => onInspect(c.cardId)} />
              <span className="text-center text-[10px] leading-tight text-ink2">{v.long}</span>
            </div>
          );
        })}
      </div>
      <button onClick={() => onAct({ type: 'DECLINE_REACTION', player: me })} className="w-full rounded-lg bg-panel2 px-3 py-2 text-sm font-semibold">
        No response
      </button>
    </PromptBox>
  );
}

function DetailSheet({ detail, state, me, myTurn, onClose, onReveal }: { detail: Detail; state: GameState; me: PlayerId; myTurn: boolean; onClose: () => void; onReveal: (slot: SlotId) => void }) {
  const def: CardDef | null = detail.cardId ? cardOf(detail.cardId) : null;
  const owner = state.players[detail.owner];
  const g = detail.slot ? owner.grafts.find((x) => x.slot === detail.slot) : undefined;
  const ambush = ambushText(state.config, owner.faction);
  const canAmbush = !!g && g.faceDown && (g.sleptSince ?? state.round) < state.round;
  const wake = detail.faceDown && detail.owner === me && detail.slot && (
    <button disabled={!myTurn} onClick={() => onReveal(detail.slot!)} className="w-full rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold disabled:opacity-40">
      Wake{canAmbush ? ` (Ambush: ${ambush})` : ''} (uses your turn)
    </button>
  );
  // A known card opens in the full card view, with what matters about it on the board underneath.
  if (def) {
    return (
      <CardDetail def={def} onClose={onClose}>
        <div className="space-y-1.5 text-[11px]">
          <div className="text-mute">
            {owner.name}'s graft{detail.slot ? ` · ${SLOT_LABEL[detail.slot]}` : ''} · <span className="text-amber-300">Strain on the Specimen: {detail.strain}</span>
          </div>
          {detail.faceDown && detail.owner === me && (
            <div className="text-sky-300">
              Asleep: no attack, armor or text until it wakes, and your opponent sees only its slot and Strain. Waking adds {g?.dormantStrain ?? 0} Strain.{' '}
              {canAmbush ? `Wake it now for an Ambush: ${ambush} this round.` : `Wake it after it has slept through a round for an Ambush (${ambush}).`}
            </div>
          )}
          {g && g.poisoned > 0 && <div className="text-fuchsia-300">Poisoned: 0 stats for {g.poisoned} more round(s).</div>}
          {g && g.disabled > 0 && <div className="text-ink2">Disabled: text off for {g.disabled} more round(s).</div>}
          {wake}
        </div>
      </CardDetail>
    );
  }
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/60 p-2 sm:place-items-center" onClick={onClose}>
      <div className="pop w-full max-w-sm rounded-2xl border border-line bg-panel p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-[11px] uppercase tracking-wide text-mute">
          {owner.name}'s graft · {detail.slot ? SLOT_LABEL[detail.slot] : ''}
        </div>
        <div className="mt-2 text-sm text-ink2">A face-down graft. It is asleep, so it adds no attack, armor or text yet. All you can see is its slot and its Strain ({detail.strain}). A Scanner Probe or a Sabotage forces it awake.</div>
        <div className="mt-3 flex gap-2">
          {detail.faceDown && detail.owner === me && detail.slot && (
            <button disabled={!myTurn} onClick={() => onReveal(detail.slot!)} className="flex-1 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold disabled:opacity-40">
              Wake{canAmbush ? ` (Ambush: ${ambush})` : ''} (uses your turn)
            </button>
          )}
          <button onClick={onClose} className="flex-1 rounded-lg bg-panel2 px-3 py-2 text-sm font-semibold">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Intro({ state, encounter, objective, onGo, onExit, me = 0 }: { state: GameState; encounter: EncounterLines | null; objective: Objective | null; onGo: () => void; onExit: () => void; me?: PlayerId }) {
  const them = state.players[other(me)];
  // After a few matches the full briefing is a wall to click through: show who you face, what's special and
  // your goal, with the loadouts one tap away.
  const [full, setFull] = useState(false);
  if (!full)
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-3 p-4 phone:h-dvh phone:min-h-0 phone:gap-2 phone:p-2">
        <div className="lab-label">Next opponent</div>
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[them.id] }} />
          <span className="min-w-0 flex-1 truncate font-display text-2xl font-bold phone:text-lg">{them.name}</span>
          {[them.faction, them.worldFaction].map((id) => (
            <ChipArt key={id} id={id} size={40} className="phone:h-8! phone:w-8!" />
          ))}
        </div>
        <div className="text-xs text-ink2">
          <span style={{ color: FACTION_META[them.faction].color }}>{FACTION_META[them.faction].name}</span> /{' '}
          <span style={{ color: WORLD_FACTION_META[them.worldFaction].color }}>{WORLD_FACTION_META[them.worldFaction].name}</span>
          {them.evolution && <span className="text-violet-300"> · starts evolved</span>}
        </div>
        {encounter && (
          <p className="lab-panel rounded-xl border border-amber-400/40 px-3 py-2 font-serif text-[14px] italic leading-snug text-ink phone:py-1.5 phone:text-[12px]">
            <LoreText text={encounter.before} />
          </p>
        )}
        {state.players.some((p) => p.integrates) && (
          <p className="text-[12px] text-amber-200">
            <b>Integration:</b> at each Strain check, if your Specimen is Overclocked or worse, {state.players.find((p) => p.integrates)!.name} absorbs your most worn-down awake graft. Stay Stable to hold on to it.
          </p>
        )}
        {objective && <p className="text-sm font-semibold text-emerald-300">◎ Goal: {objective.text}</p>}
        <div className="mt-2 flex gap-2">
          <button onClick={onExit} className="rounded-lg bg-panel2 px-4 py-3 text-sm font-semibold">
            Back
          </button>
          <button onClick={() => setFull(true)} className="rounded-lg border border-line px-3 py-3 text-sm text-ink2">
            Loadouts
          </button>
          <button onClick={onGo} autoFocus className="flex-1 rounded-lg bg-accent px-4 py-3 font-display text-sm font-bold text-black">
            Start match
          </button>
        </div>
      </div>
    );
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-3 p-3 phone:h-dvh phone:min-h-0 phone:max-w-none phone:gap-1.5 phone:p-2">
      <div>
        <div className="lab-label">Pre-match briefing</div>
        <h1 className="font-display text-2xl font-bold phone:text-base">Specimens and loadouts</h1>
        <p className="text-xs text-ink2 phone:hidden">Both players see both Chip loadouts and each Build's two evolutions.</p>
        {objective && <p className="mt-1 text-sm font-semibold text-emerald-300 phone:text-xs">◎ Goal this match: {objective.text}</p>}
      </div>
      {encounter && (
        <p className="lab-panel rounded-xl border border-amber-400/40 px-3 py-2 font-serif text-[14px] italic leading-snug text-ink phone:py-1.5 phone:text-[12px]">
          <LoreText text={encounter.before} />
          {state.players.some((p) => p.integrates) && (
            <span className="mt-1.5 block font-sans text-[12px] not-italic text-amber-200 phone:text-[11px]">
              <b>Integration:</b> at each Strain check, if your Specimen is Overclocked or worse, {state.players.find((p) => p.integrates)!.name} absorbs your most worn-down awake graft. Stay Stable to hold on to it.
            </span>
          )}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 phone:min-h-0 phone:flex-1 phone:grid-cols-2 phone:gap-2 phone:overflow-y-auto">
        {state.players.map((p) => (
          <section key={p.id} className="lab-panel rounded-xl border border-line p-3 phone:p-2 phone:text-[11px]" style={{ borderTop: `3px solid ${PLAYER_COLORS[p.id]}` }}>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[p.id] }} />
              <span className="min-w-0 truncate font-bold">{p.name}</span>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {[
                  { id: p.faction, meta: FACTION_META[p.faction] },
                  { id: p.worldFaction, meta: WORLD_FACTION_META[p.worldFaction] },
                ].map(({ id, meta }) => (
                  <span key={id} className="flex flex-col items-center text-[10px] font-semibold leading-none" style={{ color: meta.color }} title={meta.tagline}>
                    <ChipArt id={id} size={40} className="phone:h-7! phone:w-7!" />
                    {meta.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-mute">Evolutions (with their boosts)</div>
            <div className="mt-1">
              <FormList state={state} player={p.id} />
            </div>
            <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-mute">{chipOf(p.chip)?.name ?? 'Chip'} loadout</div>
            <ul className="mt-1 space-y-1.5">
              {p.loadout.map((id) => {
                const n = findNode(id);
                return (
                  <li key={id} className="text-xs">
                    <span className="font-semibold text-accent">{n?.name}</span> <span className="text-ink2">— <IconText text={n?.text ?? ''} /></span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <div className="mt-auto flex shrink-0 gap-2">
        <button onClick={onExit} className="rounded-lg bg-panel2 px-4 py-3 text-sm font-semibold">
          Back
        </button>
        <button onClick={onGo} autoFocus className="flex-1 rounded-lg bg-accent px-4 py-3 font-display text-sm font-bold text-black">
          Start match
        </button>
      </div>
    </div>
  );
}

/** This match's side goal in the header: live progress, green when done, struck through once out of reach. */
function ObjectiveChip({ objective, state, me }: { objective: Objective; state: GameState; me: PlayerId }) {
  const [have, need] = objective.progress(state, me);
  const done = objectiveDone(objective, state, me) || (!objective.needsWin && have >= need);
  const failed = objectiveFailed(objective, state, me);
  return (
    <span
      className={`truncate rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${done ? 'border-emerald-400/60 text-emerald-300' : failed ? 'border-line text-mute line-through' : 'border-line text-ink2'}`}
      title={`Goal this match: ${objective.text}${objective.needsWin ? ' (and win)' : ''}`}
    >
      ◎ {objective.text}
      {need > 1 && !failed ? ` ${have}/${need}` : done ? ' ✓' : ''}
    </span>
  );
}

/** The coming Clash as things stand: what you'd deal and take if it happened now. */
function ClashChip({ p, compact = false }: { p: ClashPreview; compact?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-black/40 font-display font-bold ${compact ? 'px-1.5 text-[10px]' : 'px-2.5 py-0.5 text-xs'}`} title="The Clash if it happened now (plays still to come can change it)">
      <span className="font-sans font-normal text-mute">{compact ? 'Clash' : 'Clash now:'}</span>
      <span className="text-red-300">deal {p.deal}</span>
      <span className="text-mute">·</span>
      <span className="text-sky-300">take {p.take}</span>
    </span>
  );
}

const ZONE_TEXT = { stable: 'Stable', overclocked: 'Overclocked', rejection: 'rejection!' } as const;

/** What the selected card would do: Strain and Energy after, the Clash after, grafts it breaks or costs you. */
function PreviewLine({ p, compact }: { p: PlayPreview; compact: boolean }) {
  const parts: ReactNode[] = [];
  if (p.strain[0] !== p.strain[1]) parts.push(<span key="s" className={p.zone === 'rejection' ? 'text-red-300' : p.zone === 'overclocked' ? 'text-amber-300' : 'text-ink2'}>Strain {p.strain[0]}→{p.strain[1]}{p.zone !== 'stable' ? ` (${ZONE_TEXT[p.zone]})` : ''}</span>);
  if (p.energy[0] !== p.energy[1]) parts.push(<span key="e" className="text-ink2">Energy {p.energy[0]}→{p.energy[1]}</span>);
  if (p.clash && (p.clash.after.deal !== p.clash.before.deal || p.clash.after.take !== p.clash.before.take)) {
    const d = p.clash.after.deal - p.clash.before.deal;
    const t = p.clash.after.take - p.clash.before.take;
    parts.push(
      <span key="c" className="text-ink2">
        Clash: deal <b className="text-red-300">{p.clash.after.deal}</b>
        {d ? ` (${d > 0 ? '+' : ''}${d})` : ''}, take <b className="text-sky-300">{p.clash.after.take}</b>
        {t ? ` (${t > 0 ? '+' : ''}${t})` : ''}
      </span>,
    );
  }
  if (p.kills.length) parts.push(<span key="k" className="text-emerald-300">destroys {p.kills.join(', ')}</span>);
  if (p.losses.length) parts.push(<span key="l" className="text-amber-300">you lose {p.losses.join(', ')}</span>);
  if (!parts.length) return null;
  return (
    <span className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 ${compact ? 'text-[10px]' : 'text-[11px]'}`} aria-label="If you play it">
      <span className="text-mute">If played:</span>
      {parts}
    </span>
  );
}
