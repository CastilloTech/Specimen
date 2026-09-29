import { useState } from 'react';
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
import type { Settings } from './ui/storage';

type Screen =
  | { name: 'menu' }
  | { name: 'setup' }
  | { name: 'match'; setup: MatchSetup; run: number; towerFloor?: number; replay?: boolean; lineage?: boolean; breach?: boolean }
  | { name: 'breach'; last?: WaveOutcome | null }
  | { name: 'lineage'; report?: MatchReport | null }
  | { name: 'modes' }
  | { name: 'collection' }
  | { name: 'tower'; last?: TowerOutcome | null }
  | { name: 'post'; setup: MatchSetup; state: GameState }
  | { name: 'saves' }
  | { name: 'guide' }
  | { name: 'decks' };


export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const menu = () => setScreen({ name: 'menu' });
  const quick = () => setScreen({ name: 'match', setup: quickBotSetup(), run: Date.now() });

  switch (screen.name) {
    case 'menu':
      return <Menu onQuick={quick} onModes={() => setScreen({ name: 'modes' })} onBot={() => setScreen({ name: 'setup' })} onSaves={() => setScreen({ name: 'saves' })} onGuide={() => setScreen({ name: 'guide' })} onDecks={() => setScreen({ name: 'decks' })} />;
    case 'setup':
      return <Setup onBack={menu} onDecks={() => setScreen({ name: 'decks' })} onStart={(setup) => setScreen({ name: 'match', setup, run: 0 })} />;
    case 'match':
      return (
        <MatchScreen
          key={`${screen.setup.seed}-${screen.run}`}
          setup={screen.setup}
          settings={settings}
          onExit={screen.towerFloor ? () => setScreen({ name: 'tower' }) : screen.lineage ? () => setScreen({ name: 'lineage' }) : screen.breach ? () => setScreen({ name: 'breach' }) : menu}
          onFinish={(state, setup) => {
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
            if (!floor) return setScreen({ name: 'post', setup, state });
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
      return <GameModes onBack={menu} onBreach={() => setScreen({ name: 'breach' })} onLineage={() => setScreen({ name: 'lineage' })} onTower={() => setScreen({ name: 'tower' })} onCollection={() => setScreen({ name: 'collection' })} onSaves={() => setScreen({ name: 'saves' })} />;
    case 'breach':
      return <BreachScreen last={screen.last} onBack={() => setScreen({ name: 'modes' })} onCollection={() => setScreen({ name: 'collection' })} onFight={(setup) => setScreen({ name: 'match', setup, run: Date.now(), breach: true })} />;
    case 'lineage':
      return <LineageScreen report={screen.report} onBack={() => setScreen({ name: 'modes' })} onCollection={() => setScreen({ name: 'collection' })} onFight={(setup) => setScreen({ name: 'match', setup, run: Date.now(), lineage: true })} />;
    case 'collection':
      return <CollectionScreen onBack={() => setScreen({ name: 'modes' })} />;
    case 'tower':
      return <TowerScreen last={screen.last} onBack={() => setScreen({ name: 'modes' })} onCollection={() => setScreen({ name: 'collection' })} onFight={(setup, floor, replay) => setScreen({ name: 'match', setup, run: Date.now(), towerFloor: floor, replay })} />;
    case 'post':
      return <PostMatch state={screen.state} setup={screen.setup} onMenu={menu} onNext={quick} onRematch={() => setScreen({ name: 'match', setup: { ...screen.setup, seed: Math.floor(Math.random() * 2 ** 31) }, run: Date.now() })} />;
    case 'saves':
      return <SavesScreen onBack={menu} />;
    case 'guide':
      return (
        <GuideScreen
          onBack={menu}
          onPlay={quick}
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
