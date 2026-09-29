import { useEffect, useState } from 'react';
import { play } from './ui/sfx';
import type { GameState, MatchSetup } from './engine';
import { CollectionScreen } from './ui/screens/CollectionScreen';
import { DeckBuilder } from './ui/screens/DeckBuilder';
import { GameModes } from './ui/screens/GameModes';
import { TowerScreen } from './ui/screens/TowerScreen';
import type { TowerOutcome } from './ui/screens/TowerScreen';
import { floorInfo, loadProgress, replayResult, saveProgress, towerResult } from './ui/modes';
import { applyLineageMatch } from './ui/lineage';
import type { MatchReport } from './ui/lineage';
import { LineageScreen } from './ui/screens/LineageScreen';
import { BreachScreen } from './ui/screens/BreachScreen';
import type { WaveOutcome } from './ui/screens/BreachScreen';
import { afterWave, wavesSurvived } from './ui/breach';
import { GuideScreen } from './ui/screens/GuideScreen';
import { MatchScreen } from './ui/screens/Match';
import { Menu } from './ui/screens/Menu';
import { PostMatch } from './ui/screens/PostMatch';
import { SavesScreen } from './ui/screens/SavesScreen';
import { quickBotSetup, Setup } from './ui/screens/Setup';
import { loadSettings, saveSettings } from './ui/storage';
import type { SavedReplay, Settings } from './ui/storage';
import { ReplayScreen } from './ui/screens/ReplayScreen';
import { DailyScreen } from './ui/screens/DailyScreen';
import { TutorialDone } from './ui/screens/TutorialDone';
import { setTutorialDone, tutorialSetup } from './ui/tutorial';
import { activeSave } from './ui/storage';
import { applyDaily } from './ui/daily';
import type { DailyOutcome } from './ui/daily';

type Screen =
  | { name: 'menu' }
  | { name: 'setup' }
  | { name: 'match'; setup: MatchSetup; run: number; towerFloor?: number; replay?: boolean; lineage?: boolean; breach?: boolean; daily?: string; tutorial?: boolean; label?: string }
  | { name: 'tutorialDone'; setup: MatchSetup; state: GameState }
  | { name: 'daily'; last?: DailyOutcome | null }
  | { name: 'replay'; replay: SavedReplay; back: Screen }
  | { name: 'breach'; last?: WaveOutcome | null }
  | { name: 'lineage'; report?: MatchReport | null }
  | { name: 'modes' }
  | { name: 'collection' }
  | { name: 'tower'; last?: TowerOutcome | null }
  | { name: 'post'; setup: MatchSetup; state: GameState; label?: string }
  | { name: 'saves' }
  | { name: 'guide' }
  | { name: 'decks' };


/** A replay of a match that just ended (also kept in the save's Replays list). */
function replayOf(setup: MatchSetup, state: GameState, label?: string): SavedReplay {
  const w = state.result?.winner;
  return { id: `post-${setup.seed}`, at: Date.now(), me: 0, names: [state.players[0].name, state.players[1].name], result: w === 0 ? 'win' : w == null ? 'draw' : 'loss', rounds: state.round, label, setup, actions: state.history };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [settings, setSettings] = useState<Settings>(loadSettings);
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
  const quick = () => setScreen({ name: 'match', setup: quickBotSetup(), run: Date.now(), label: 'Quick match' });
  const tutorial = () => setScreen({ name: 'match', setup: tutorialSetup(activeSave()?.meta.name ?? 'You'), run: Date.now(), tutorial: true, label: 'Tutorial' });

  switch (screen.name) {
    case 'menu':
      return <Menu onQuick={quick} onModes={() => setScreen({ name: 'modes' })} onBot={() => setScreen({ name: 'setup' })} onSaves={() => setScreen({ name: 'saves' })} onGuide={() => setScreen({ name: 'guide' })} onDecks={() => setScreen({ name: 'decks' })} onTutorial={tutorial} />;
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
          onExit={screen.towerFloor ? () => setScreen({ name: 'tower' }) : screen.lineage ? () => setScreen({ name: 'lineage' }) : screen.breach ? () => setScreen({ name: 'breach' }) : screen.daily ? () => setScreen({ name: 'daily' }) : menu}
          onFinish={(state, setup) => {
            if (screen.tutorial) {
              setTutorialDone();
              return setScreen({ name: 'tutorialDone', setup, state });
            }
            if (screen.daily) {
              // The daily challenge: counted for the day the attempt started.
              const p = loadProgress();
              if (!p) return setScreen({ name: 'modes' });
              const r = applyDaily(p, screen.daily, state);
              saveProgress(r.progress);
              return setScreen({ name: 'daily', last: r.outcome });
            }
            if (screen.breach) {
              // A Containment Breach wave: carry HP and Strain over, or end the run and keep the best score.
              const p = loadProgress();
              if (!p?.breach) return setScreen({ name: 'modes' });
              const r = afterWave(p.breach, state);
              const score = wavesSurvived(r.run);
              const newBest = !r.survived && score > (p.breachBest ?? 0);
              saveProgress({ ...p, breach: r.run, biomass: p.biomass + r.reward, earned: p.earned + r.reward, breachBest: Math.max(p.breachBest ?? 0, score) });
              return setScreen({ name: 'breach', last: { wave: p.breach.wave, survived: r.survived, reward: r.reward, newBest } });
            }
            if (screen.lineage) {
              // A Lineage match: scars, the next mutation offer, and biomass.
              const p = loadProgress();
              if (!p?.lineage) return setScreen({ name: 'modes' });
              const r = applyLineageMatch(p.lineage, state);
              saveProgress({ ...p, lineage: r.lineage, biomass: p.biomass + r.report.reward, earned: p.earned + r.report.reward });
              return setScreen({ name: 'lineage', report: r.report });
            }
            const floor = screen.towerFloor;
            if (!floor) return setScreen({ name: 'post', setup, state, label: screen.label });
            // A Tower floor: pay out, advance (or fall back to the checkpoint), and show the result on the map.
            const p = loadProgress();
            if (!p) return setScreen({ name: 'modes' });
            const won = state.result?.winner === 0;
            if (screen.replay) {
              const r = replayResult(p, floor, won);
              saveProgress(r.progress);
              return setScreen({ name: 'tower', last: { floor, won, reward: r.reward, cleared: false, replay: true } });
            }
            const r = towerResult(p, floor, won);
            saveProgress(r.progress);
            setScreen({ name: 'tower', last: { floor, won, reward: r.reward, cleared: r.cleared, checkpoint: won && floorInfo(floor).checkpoint } });
          }}
        />
      );
    case 'modes':
      return <GameModes onBack={menu} onBreach={() => setScreen({ name: 'breach' })} onDaily={() => setScreen({ name: 'daily' })} onLineage={() => setScreen({ name: 'lineage' })} onTower={() => setScreen({ name: 'tower' })} onCollection={() => setScreen({ name: 'collection' })} onSaves={() => setScreen({ name: 'saves' })} />;
    case 'tutorialDone':
      return (
        <TutorialDone
          state={screen.state}
          onQuick={quick}
          onGuide={() => setScreen({ name: 'guide' })}
          onModes={() => setScreen({ name: 'modes' })}
          onMenu={menu}
          onReplay={() => setScreen({ name: 'replay', back: screen, replay: replayOf(screen.setup, screen.state, 'Tutorial') })}
        />
      );
    case 'daily':
      return <DailyScreen last={screen.last} onBack={() => setScreen({ name: 'modes' })} onFight={(setup, daily) => setScreen({ name: 'match', setup, run: Date.now(), daily })} />;
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
          onMenu={menu}
          onNext={quick}
          onRematch={() => setScreen({ name: 'match', setup: { ...screen.setup, seed: Math.floor(Math.random() * 2 ** 31) }, run: Date.now(), label: screen.label })}
          onReplay={() => setScreen({ name: 'replay', back: screen, replay: replayOf(screen.setup, screen.state, screen.label) })}
        />
      );
    case 'saves':
      return <SavesScreen onBack={menu} onWatch={(replay) => setScreen({ name: 'replay', replay, back: { name: 'saves' } })} />;
    case 'replay':
      return <ReplayScreen replay={screen.replay} onBack={() => setScreen(screen.back)} />;
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
      return <DeckBuilder onBack={menu} />;
  }
}
