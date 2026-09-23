import { useState } from 'react';
import type { GameState, MatchSetup } from './engine';
import { DeckBuilder } from './ui/screens/DeckBuilder';
import { GuideScreen } from './ui/screens/GuideScreen';
import { MatchScreen } from './ui/screens/Match';
import { Menu } from './ui/screens/Menu';
import { PostMatch } from './ui/screens/PostMatch';
import { SavesScreen } from './ui/screens/SavesScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { quickBotSetup, Setup } from './ui/screens/Setup';
import { loadSettings, saveSettings } from './ui/storage';
import type { Settings } from './ui/storage';

type Screen =
  | { name: 'menu' }
  | { name: 'setup' }
  | { name: 'match'; setup: MatchSetup; run: number }
  | { name: 'post'; setup: MatchSetup; state: GameState }
  | { name: 'saves' }
  | { name: 'guide' }
  | { name: 'decks' }
  | { name: 'settings' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const menu = () => setScreen({ name: 'menu' });
  const quick = () => setScreen({ name: 'match', setup: quickBotSetup(), run: Date.now() });

  switch (screen.name) {
    case 'menu':
      return <Menu onQuick={quick} onBot={() => setScreen({ name: 'setup' })} onSaves={() => setScreen({ name: 'saves' })} onGuide={() => setScreen({ name: 'guide' })} onDecks={() => setScreen({ name: 'decks' })} onSettings={() => setScreen({ name: 'settings' })} />;
    case 'setup':
      return <Setup onBack={menu} onStart={(setup) => setScreen({ name: 'match', setup, run: 0 })} />;
    case 'match':
      return <MatchScreen key={`${screen.setup.seed}-${screen.run}`} setup={screen.setup} settings={settings} onExit={menu} onFinish={(state, setup) => setScreen({ name: 'post', setup, state })} />;
    case 'post':
      return <PostMatch state={screen.state} setup={screen.setup} onMenu={menu} onRematch={() => setScreen({ name: 'match', setup: { ...screen.setup, seed: Math.floor(Math.random() * 2 ** 31) }, run: Date.now() })} />;
    case 'saves':
      return <SavesScreen onBack={menu} />;
    case 'guide':
      return <GuideScreen onBack={menu} onPlay={quick} />;
    case 'decks':
      return <DeckBuilder onBack={menu} />;
    case 'settings':
      return (
        <SettingsScreen
          settings={settings}
          onChange={(s) => {
            setSettings(s);
            saveSettings(s);
          }}
          onBack={menu}
        />
      );
  }
}
