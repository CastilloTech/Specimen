import { useState } from 'react';
import type { GameState, MatchSetup } from './engine';
import { DeckBuilder } from './ui/screens/DeckBuilder';
import { MatchScreen } from './ui/screens/Match';
import { Menu } from './ui/screens/Menu';
import { PostMatch } from './ui/screens/PostMatch';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { quickBotSetup, Setup } from './ui/screens/Setup';
import { loadSettings, saveSettings } from './ui/storage';
import type { Settings } from './ui/storage';

type Mode = 'hotseat' | 'bot';
type Screen =
  | { name: 'menu' }
  | { name: 'setup'; mode: Mode }
  | { name: 'match'; mode: Mode; setup: MatchSetup; run: number }
  | { name: 'post'; mode: Mode; setup: MatchSetup; state: GameState }
  | { name: 'decks' }
  | { name: 'settings' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const menu = () => setScreen({ name: 'menu' });

  switch (screen.name) {
    case 'menu':
      return <Menu onQuick={() => setScreen({ name: 'match', mode: 'bot', setup: quickBotSetup(), run: Date.now() })} onBot={() => setScreen({ name: 'setup', mode: 'bot' })} onHotseat={() => setScreen({ name: 'setup', mode: 'hotseat' })} onDecks={() => setScreen({ name: 'decks' })} onSettings={() => setScreen({ name: 'settings' })} />;
    case 'setup':
      return <Setup mode={screen.mode} onBack={menu} onStart={(setup) => setScreen({ name: 'match', mode: screen.mode, setup, run: 0 })} />;
    case 'match':
      return <MatchScreen key={`${screen.setup.seed}-${screen.run}`} setup={screen.setup} mode={screen.mode} settings={settings} onExit={menu} onFinish={(state, setup) => setScreen({ name: 'post', mode: screen.mode, setup, state })} />;
    case 'post':
      return <PostMatch state={screen.state} setup={screen.setup} onMenu={menu} onRematch={() => setScreen({ name: 'match', mode: screen.mode, setup: { ...screen.setup, seed: Math.floor(Math.random() * 2 ** 31) }, run: Date.now() })} />;
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
