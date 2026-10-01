import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { play } from './ui/sfx';
import { UpdateToast } from './ui/components/AppPrompts';
import { QueueBeacon } from './ui/components/QueueBeacon';
import { matchmaker } from './ui/matchmaker';
import type { GameState, MatchSetup, PlayerId } from './engine';
import type { OnlineConn } from './ui/online';
import type { TowerOutcome } from './ui/screens/TowerScreen';
import { deckProblems, floorInfo, floorMatch, loadProgress, replayResult, saveProgress, TOWER_FLOORS, towerResult } from './ui/modes';
import { applyLineageMatch } from './ui/lineage';
import type { MatchReport } from './ui/lineage';
import type { WaveOutcome } from './ui/screens/BreachScreen';
import { afterWave, waveMatch, wavesSurvived } from './ui/breach';
import { Menu } from './ui/screens/Menu';
import { defaultChip, defaultLoadout, quickBotSetup, recordQuickResult } from './ui/picks';
import { modeTarget } from './ui/resume';
import type { ModeKind } from './ui/resume';
import type { DeckTest } from './ui/screens/DeckBuilder';
import { startDraftWith } from './ui/deckDraft';
import { loadSettings, saveSettings } from './ui/storage';
import type { SavedReplay, Settings } from './ui/storage';
import { LESSON_LABEL, lessonSetup, setLessonDone } from './ui/tutorial';
import type { Lesson } from './ui/tutorial';
import { activeSave } from './ui/storage';
import { applyDaily } from './ui/daily';
import { clearIncoming, readIncoming, replayFromCode } from './ui/share';
import type { DailyOutcome } from './ui/daily';
import { syncReminderState } from './ui/reminders';

type Screen =
  | { name: 'menu' }
  | { name: 'setup' }
  | { name: 'match'; setup: MatchSetup; run: number; towerFloor?: number; replay?: boolean; lineage?: boolean; breach?: boolean; daily?: string; tutorial?: Lesson; label?: string; deckTest?: DeckTest }
  | { name: 'tutorialDone'; setup: MatchSetup; state: GameState; lesson: Lesson }
  | { name: 'daily'; last?: DailyOutcome | null }
  | { name: 'replay'; replay: SavedReplay; back: Screen; shared?: boolean; startAt?: number }
  | { name: 'breach'; last?: WaveOutcome | null }
  | { name: 'lineage'; report?: MatchReport | null }
  | { name: 'modes' }
  | { name: 'collection' }
  | { name: 'tower'; last?: TowerOutcome | null }
  | { name: 'post'; setup: MatchSetup; state: GameState; label?: string; me?: PlayerId }
  | { name: 'online'; code?: string }
  | { name: 'onlineMatch'; conn: OnlineConn }
  | { name: 'watch'; conn: OnlineConn }
  | { name: 'admin' }
  | { name: 'saves' }
  | { name: 'guide' }
  | { name: 'archive' }
  | { name: 'decks' };


// Every screen but the menu loads when first opened (the service worker has them all cached after the first
// visit, so this only speeds up the very first load). The match screen is fetched in the background as soon
// as the menu is up, so Quick match starts instantly.
const ArchiveScreen = lazy(() => import('./ui/screens/ArchiveScreen').then((m) => ({ default: m.ArchiveScreen })));
const CollectionScreen = lazy(() => import('./ui/screens/CollectionScreen').then((m) => ({ default: m.CollectionScreen })));
const DeckBuilder = lazy(() => import('./ui/screens/DeckBuilder').then((m) => ({ default: m.DeckBuilder })));
const GameModes = lazy(() => import('./ui/screens/GameModes').then((m) => ({ default: m.GameModes })));
const TowerScreen = lazy(() => import('./ui/screens/TowerScreen').then((m) => ({ default: m.TowerScreen })));
const LineageScreen = lazy(() => import('./ui/screens/LineageScreen').then((m) => ({ default: m.LineageScreen })));
const BreachScreen = lazy(() => import('./ui/screens/BreachScreen').then((m) => ({ default: m.BreachScreen })));
const GuideScreen = lazy(() => import('./ui/screens/GuideScreen').then((m) => ({ default: m.GuideScreen })));
const MatchScreen = lazy(() => import('./ui/screens/Match').then((m) => ({ default: m.MatchScreen })));
const OnlineMatchScreen = lazy(() => import('./ui/screens/Match').then((m) => ({ default: m.OnlineMatchScreen })));
const OnlineScreen = lazy(() => import('./ui/screens/OnlineScreen').then((m) => ({ default: m.OnlineScreen })));
const AdminScreen = lazy(() => import('./ui/screens/AdminScreen').then((m) => ({ default: m.AdminScreen })));
const PostMatch = lazy(() => import('./ui/screens/PostMatch').then((m) => ({ default: m.PostMatch })));
const SavesScreen = lazy(() => import('./ui/screens/SavesScreen').then((m) => ({ default: m.SavesScreen })));
const ReplayScreen = lazy(() => import('./ui/screens/ReplayScreen').then((m) => ({ default: m.ReplayScreen })));
const DailyScreen = lazy(() => import('./ui/screens/DailyScreen').then((m) => ({ default: m.DailyScreen })));
const TutorialDone = lazy(() => import('./ui/screens/TutorialDone').then((m) => ({ default: m.TutorialDone })));
const Setup = lazy(() => import('./ui/screens/Setup').then((m) => ({ default: m.Setup })));

/** A replay of a match that just ended (also kept in the save's Replays list). `me`: your seat. */
function replayOf(setup: MatchSetup, state: GameState, label?: string, me: PlayerId = 0): SavedReplay {
  const w = state.result?.winner;
  return { id: `post-${setup.seed}`, at: Date.now(), me, names: [state.players[0].name, state.players[1].name], result: w === me ? 'win' : w == null ? 'draw' : 'loss', rounds: state.round, label, setup, actions: state.history };
}

export default function App() {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <Screens />
      </Suspense>
      <UpdateToast />
    </>
  );
}

function Loading() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
    </div>
  );
}

const SCREEN_DEPTH: Record<Screen['name'], number> = { menu: 0, setup: 1, modes: 1, decks: 1, guide: 1, archive: 1, saves: 1, online: 1, admin: 1, tower: 2, lineage: 2, breach: 2, daily: 2, collection: 2, match: 3, onlineMatch: 3, watch: 3, post: 4, tutorialDone: 4, replay: 4 };

function Screens() {
  useEffect(() => {
    // The match first (Quick match), then the screens most often opened from the menu, so none flashes a spinner.
    void syncReminderState(loadProgress());
    const warm = () => {
      void import('./ui/screens/Match');
      for (const load of [() => import('./ui/screens/GameModes'), () => import('./ui/screens/DeckBuilder'), () => import('./ui/screens/TowerScreen'), () => import('./ui/screens/ArchiveScreen'), () => import('./ui/screens/PostMatch'), () => import('./ui/screens/DailyScreen')]) void load();
    };
    const w = window as { requestIdleCallback?: (f: () => void) => void };
    if (w.requestIdleCallback) w.requestIdleCallback(warm);
    else setTimeout(warm, 1500);
  }, []);
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const transition = useRef({ key: 'menu', depth: 0, cls: 'screen-in' });
  // Enter presses the screen's main button (marked data-primary) when nothing else has the focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return;
      const a = document.activeElement;
      if (a && a !== document.body && a.tagName !== 'MAIN') return;
      if (document.querySelector('[role="dialog"]')) return;
      const b = [...document.querySelectorAll<HTMLButtonElement>('button[data-primary]')].find((x) => !x.disabled && x.offsetParent !== null);
      if (b) {
        e.preventDefault();
        b.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Opened from a shared link: a replay (#replay=…) or the daily challenge (#daily).
  useEffect(() => {
    const incoming = readIncoming();
    if (!incoming) return;
    clearIncoming();
    if (incoming.kind === 'daily') return setScreen(loadProgress() ? { name: 'daily' } : { name: 'modes' });
    if (incoming.kind === 'room') return setScreen({ name: 'online', code: incoming.code });
    if (incoming.kind === 'lounge') return setScreen({ name: 'online' });
    if (incoming.kind === 'admin') return setScreen({ name: 'admin' });
    replayFromCode(incoming.code)
      .then((replay) => setScreen({ name: 'replay', replay, back: { name: 'menu' }, shared: true }))
      .catch((e: Error) => setLinkError(e.message));
  }, []);
  // A soft click for every button in the app (match events have their own sounds).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const b = (e.target as Element | null)?.closest?.('button');
      if (b && !(b as HTMLButtonElement).disabled) play('click');
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
  const menu = () => setScreen({ name: 'menu' });
  const toLounge = useCallback(() => setScreen({ name: 'online' }), []);
  // In online play (the lounge or a match), stay connected to the lounge: friends see you, challenges reach you.
  const inOnline = screen.name === 'online' || screen.name === 'onlineMatch' || screen.name === 'watch';
  useEffect(() => (inOnline ? matchmaker.watch() : undefined), [inOnline]);
  const quick = () => setScreen({ name: 'match', setup: quickBotSetup(), run: Date.now(), label: 'Quick match' });
  /** Start a Game Mode's next match directly, or open its screen when something needs doing there first. */
  const playMode = (kind: ModeKind) => {
    const p = loadProgress();
    const t = p ? modeTarget(p, kind, activeSave()?.meta.name ?? 'You') : null;
    if (!t?.setup) return setScreen(kind === 'tower' ? { name: 'tower' } : kind === 'lineage' ? { name: 'lineage' } : { name: 'breach' });
    setScreen({ name: 'match', setup: t.setup, run: Date.now(), ...(kind === 'tower' ? { towerFloor: p!.tower.floor } : kind === 'lineage' ? { lineage: true } : { breach: true }) });
  };
  /** A Quick match with the deck on the builder's bench, against a random bot at your Quick match level. */
  const testDeck = (d: DeckTest): Screen => {
    const chip = defaultChip(d.worldFaction);
    const base = quickBotSetup();
    const you = { ...base.players[0], faction: d.faction, worldFaction: d.worldFaction, chip, loadout: defaultLoadout(chip), deck: d.cards };
    return { name: 'match', setup: { ...base, players: [you, base.players[1]] }, run: Date.now(), label: 'Deck test', deckTest: d };
  };
  const tutorial = (lesson: Lesson = 'basics') => setScreen({ name: 'match', setup: lessonSetup(lesson, activeSave()?.meta.name ?? 'Player 1'), run: Date.now(), tutorial: lesson, label: LESSON_LABEL[lesson] });

  type MatchScreenState = Extract<Screen, { name: 'match' }>;
  /**
   * Book a finished match (tutorial, daily, Breach wave, Lineage match, Tower floor or a plain match) and say
   * where to go: the mode's own screen, or the next match straight away when there is an obvious one.
   */
  const settle = (state: GameState, setup: MatchSetup, sc: MatchScreenState = screen as MatchScreenState): { after: Screen; next?: Screen } => {
    if (sc.deckTest) return { after: { name: 'decks' }, next: testDeck(sc.deckTest) };
    if (sc.tutorial) {
      setLessonDone(sc.tutorial);
      return { after: { name: 'tutorialDone', setup, state, lesson: sc.tutorial } };
    }
    if (sc.daily) {
      // The daily challenge: counted for the day the attempt started.
      const p = loadProgress();
      if (!p) return { after: { name: 'modes' } };
      const r = applyDaily(p, sc.daily, state);
      saveProgress(r.progress);
      void syncReminderState(r.progress); // a win today means no reminder today
      return { after: { name: 'daily', last: r.outcome } };
    }
    if (sc.breach) {
      // A Containment Breach wave: carry HP and Strain over, or end the run and keep the best score.
      const p = loadProgress();
      if (!p?.breach) return { after: { name: 'modes' } };
      const r = afterWave(p.breach, state);
      const score = wavesSurvived(r.run);
      const newBest = !r.survived && score > (p.breachBest ?? 0);
      saveProgress({ ...p, breach: r.run, biomass: p.biomass + r.reward, earned: p.earned + r.reward, breachBest: Math.max(p.breachBest ?? 0, score) });
      const after: Screen = { name: 'breach', last: { wave: p.breach.wave, survived: r.survived, reward: r.reward, newBest } };
      return { after, next: r.survived ? { name: 'match', setup: waveMatch(r.run, activeSave()?.meta.name ?? 'You'), run: Date.now(), breach: true } : undefined };
    }
    if (sc.lineage) {
      // A Lineage match: scars, the next mutation offer, and biomass (always via its screen: there is a choice to make).
      const p = loadProgress();
      if (!p?.lineage) return { after: { name: 'modes' } };
      const r = applyLineageMatch(p.lineage, state);
      saveProgress({ ...p, lineage: r.lineage, biomass: p.biomass + r.report.reward, earned: p.earned + r.report.reward });
      return { after: { name: 'lineage', report: r.report } };
    }
    const floor = sc.towerFloor;
    if (!floor && sc.label === 'Quick match') recordQuickResult(state.result?.winner === 0 ? 'win' : state.result?.winner == null ? 'draw' : 'loss');
    if (!floor) return { after: { name: 'post', setup, state, label: sc.label }, next: sc.label === 'Quick match' ? { name: 'match', setup: quickBotSetup(), run: Date.now(), label: 'Quick match' } : undefined };
    // A Tower floor: pay out, advance (or fall back to the checkpoint), and show the result on the map.
    const p = loadProgress();
    if (!p) return { after: { name: 'modes' } };
    const won = state.result?.winner === 0;
    if (sc.replay) {
      const r = replayResult(p, floor, won);
      saveProgress(r.progress);
      return { after: { name: 'tower', last: { floor, won, reward: r.reward, cleared: false, replay: true } } };
    }
    const r = towerResult(p, floor, won);
    saveProgress(r.progress);
    const after: Screen = { name: 'tower', last: { floor, won, reward: r.reward, cleared: r.cleared, checkpoint: won && floorInfo(floor).checkpoint } };
    const t = r.progress.tower;
    const nextFloor = r.cleared ? null : t.floor;
    return { after, next: nextFloor && deckProblems(r.progress).length === 0 ? { name: 'match', setup: floorMatch(nextFloor, t.runSeed, r.progress.deck, activeSave()?.meta.name ?? 'You'), run: Date.now(), towerFloor: nextFloor } : undefined };
  };
  /** The result screen's one-tap "next" for this mode, if it has one (labelled by the result). */
  const nextFor = (sc: MatchScreenState) => {
    if (sc.tutorial || sc.daily || sc.lineage || sc.replay) return undefined;
    if (sc.deckTest) return { label: () => 'Test again', go: (state: GameState, setup: MatchSetup) => setScreen(settle(state, setup, sc).next!) };
    if (!(sc.breach || sc.towerFloor || sc.label === 'Quick match')) return undefined;
    return {
      label: (state: GameState) => {
        const won = state.result?.winner === 0;
        if (sc.breach) return won ? 'Next wave' : null;
        if (sc.towerFloor) return sc.towerFloor >= TOWER_FLOORS && won ? null : won ? `Floor ${sc.towerFloor + 1}` : 'Climb again';
        return 'Next match';
      },
      go: (state: GameState, setup: MatchSetup) => {
        const r = settle(state, setup, sc);
        setScreen(r.next ?? r.after);
      },
    };
  };

  const key = screen.name === 'match' ? `match-${screen.run}-${screen.setup.seed}` : screen.name === 'onlineMatch' ? `online-${screen.conn.code}` : screen.name;
  // Screens have a depth (menu, hubs, modes, a match, its results): going deeper slides in from the right,
  // going back from the left. A match only fades (its layout is fixed to the viewport).
  if (transition.current.key !== key) {
    const depth = SCREEN_DEPTH[screen.name];
    const was = transition.current.depth;
    transition.current = { key, depth, cls: screen.name === 'match' || screen.name === 'onlineMatch' ? 'screen-in' : depth > was ? 'screen-fwd' : depth < was ? 'screen-back' : 'screen-in' };
  }
  return (
    <>
      <div key={key} className={transition.current.cls}>
        {renderScreen()}
      </div>
      <QueueBeacon where={screen.name === 'online' ? 'lounge' : screen.name === 'onlineMatch' ? 'match' : 'away'} onJoin={toLounge} />
    </>
  );

  function renderScreen() {
    switch (screen.name) {
      case 'menu':
        return (
          <>
            {linkError && (
              <div className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-center gap-2 rounded-lg border border-red-500/50 bg-red-950/90 px-3 py-2 text-xs text-red-100" role="alert">
                <span className="flex-1">Couldn't open that link: {linkError}</span>
                <button onClick={() => setLinkError(null)} aria-label="Dismiss" className="px-1">
                  ✕
                </button>
              </div>
            )}
            <Menu onQuick={quick} onModes={() => setScreen({ name: 'modes' })} onBot={() => setScreen({ name: 'setup' })} onSaves={() => setScreen({ name: 'saves' })} onGuide={() => setScreen({ name: 'guide' })} onDecks={() => setScreen({ name: 'decks' })} onTutorial={() => tutorial('basics')} onArchive={() => setScreen({ name: 'archive' })} onDaily={() => setScreen({ name: 'daily' })} onContinue={(kind) => playMode(kind)} onOnline={() => setScreen({ name: 'online' })} />
          </>
        );
      case 'setup':
        return <Setup onBack={menu} onDecks={() => setScreen({ name: 'decks' })} onStart={(setup) => setScreen({ name: 'match', setup, run: 0, label: 'Custom match' })} />;
      case 'match':
        return (
          <MatchScreen
            key={`${screen.setup.seed}-${screen.run}`}
            setup={screen.setup}
            settings={settings}
            tutorial={screen.tutorial}
            label={screen.label ?? (screen.towerFloor ? `Tower floor ${screen.towerFloor}${screen.replay ? ' (replayed)' : ''}` : screen.lineage ? 'Lineage' : screen.breach ? 'Containment Breach' : screen.daily ? `Daily challenge ${screen.daily}` : undefined)}
            onExit={screen.deckTest ? () => setScreen({ name: 'decks' }) : screen.towerFloor ? () => setScreen({ name: 'tower' }) : screen.lineage ? () => setScreen({ name: 'lineage' }) : screen.breach ? () => setScreen({ name: 'breach' }) : screen.daily ? () => setScreen({ name: 'daily' }) : menu}
            onFinish={(state, setup) => setScreen(settle(state, setup).after)}
            next={nextFor(screen)}
          />
        );
      case 'modes':
        return <GameModes onBack={menu} onBreach={() => setScreen({ name: 'breach' })} onDaily={() => setScreen({ name: 'daily' })} onLineage={() => setScreen({ name: 'lineage' })} onTower={() => setScreen({ name: 'tower' })} onCollection={() => setScreen({ name: 'collection' })} onSaves={() => setScreen({ name: 'saves' })} onPlay={playMode} />;
      case 'tutorialDone':
        return (
          <TutorialDone
            state={screen.state}
            lesson={screen.lesson}
            onAdvanced={() => tutorial('advanced')}
            onEngines={() => tutorial('engines')}
            onQuick={quick}
            onGuide={() => setScreen({ name: 'guide' })}
            onModes={() => setScreen({ name: 'modes' })}
            onMenu={menu}
            onReplay={() => setScreen({ name: 'replay', back: screen, replay: replayOf(screen.setup, screen.state, LESSON_LABEL[screen.lesson]) })}
          />
        );
      case 'daily':
        return <DailyScreen last={screen.last} onBack={() => setScreen({ name: 'modes' })} onWatch={(replay) => setScreen({ name: 'replay', replay, back: { name: 'daily' } })} onFight={(setup, daily) => setScreen({ name: 'match', setup, run: Date.now(), daily })} />;
      case 'breach':
        return <BreachScreen last={screen.last} onBack={() => setScreen({ name: 'modes' })} onCollection={() => setScreen({ name: 'collection' })} onFight={(setup) => setScreen({ name: 'match', setup, run: Date.now(), breach: true })} />;
      case 'lineage':
        return <LineageScreen report={screen.report} onBack={() => setScreen({ name: 'modes' })} onCollection={() => setScreen({ name: 'collection' })} onFight={(setup) => setScreen({ name: 'match', setup, run: Date.now(), lineage: true })} />;
      case 'collection':
        return <CollectionScreen onBack={() => setScreen({ name: 'modes' })} />;
      case 'tower':
        return <TowerScreen last={screen.last} onBack={() => setScreen({ name: 'modes' })} onCollection={() => setScreen({ name: 'collection' })} onFight={(setup, floor, replay) => setScreen({ name: 'match', setup, run: Date.now(), towerFloor: floor, replay })} />;
      case 'post':
        return (
          <PostMatch
            state={screen.state}
            setup={screen.setup}
            me={screen.me}
            onMenu={menu}
            onNext={quick}
            onBuildWith={(cardId) => {
              startDraftWith(cardId);
              setScreen({ name: 'decks' });
            }}
            onRematch={() => setScreen({ name: 'match', setup: { ...screen.setup, seed: Math.floor(Math.random() * 2 ** 31) }, run: Date.now(), label: screen.label })}
            onReplay={(startAt) => setScreen({ name: 'replay', back: screen, replay: replayOf(screen.setup, screen.state, screen.label, screen.me), startAt })}
          />
        );
      case 'saves':
        return <SavesScreen onBack={menu} onWatch={(replay) => setScreen({ name: 'replay', replay, back: { name: 'saves' } })} />;
      case 'replay':
        return <ReplayScreen replay={screen.replay} shared={screen.shared} startAt={screen.startAt} onBack={() => setScreen(screen.back)} />;
      case 'online':
        return <OnlineScreen initialCode={screen.code} onBack={menu} onStart={(conn) => setScreen({ name: 'onlineMatch', conn })} onWatch={(conn) => setScreen({ name: 'watch', conn })} onDecks={() => setScreen({ name: 'decks' })} />;
      case 'watch':
        return <OnlineMatchScreen conn={screen.conn} settings={settings} onExit={toLounge} onNewRoom={toLounge} onFindAnother={toLounge} />;
      case 'admin':
        return <AdminScreen onBack={menu} />;
      case 'onlineMatch':
        return (
          <OnlineMatchScreen
            conn={screen.conn}
            settings={settings}
            onExit={menu}
            onNewRoom={toLounge}
            onFindAnother={() => {
              matchmaker.find();
              toLounge();
            }}
          />
        );
      case 'archive':
        return <ArchiveScreen onBack={menu} />;
      case 'guide':
        return (
          <GuideScreen
            onBack={menu}
            onPlay={quick}
            onTutorial={tutorial}
            settings={settings}
            onSettings={(s) => {
              setSettings(s);
              saveSettings(s);
            }}
          />
        );
      case 'decks':
        return <DeckBuilder onBack={menu} onTest={(d) => setScreen(testDeck(d))} />;
    }
  }
}
