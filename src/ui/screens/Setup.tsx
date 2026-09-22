import { useMemo, useState } from 'react';
import { defaultConfig, FACTIONS, makeRng, STARTER_DECKS, treeRows, validateDeck, validateLoadout } from '../../engine';
import type { Faction, MatchSetup } from '../../engine';
import { LoadoutPicker } from '../components/LoadoutPicker';
import { FACTION_META, PLAYER_COLORS } from '../meta';
import { loadDecks, loadLoadouts, saveLoadout } from '../storage';

interface PlayerCfg {
  name: string;
  faction: Faction;
  deckId: string; // 'starter' or a saved deck id
  loadout: string[];
}

const defaultLoadout = (f: Faction) => loadLoadouts()[f] ?? treeRows(f).map((r) => r.nodes[0].id);
const randomLoadout = (f: Faction) => {
  const rng = makeRng(Math.floor(Math.random() * 2 ** 31));
  return treeRows(f).map((r) => rng.pick(r.nodes).id);
};

function PlayerSetup({ idx, cfg, onChange, isBot }: { idx: 0 | 1; cfg: PlayerCfg; onChange: (c: PlayerCfg) => void; isBot?: boolean }) {
  const decks = loadDecks().filter((d) => d.faction === cfg.faction);
  const set = (patch: Partial<PlayerCfg>) => onChange({ ...cfg, ...patch });
  const changeFaction = (f: Faction) => set({ faction: f, deckId: 'starter', loadout: isBot ? randomLoadout(f) : defaultLoadout(f) });
  return (
    <section className="rounded-xl border border-line bg-panel p-3" style={{ borderLeft: `4px solid ${PLAYER_COLORS[idx]}` }}>
      <div className="flex items-center gap-2">
        <input value={cfg.name} onChange={(e) => set({ name: e.target.value })} maxLength={16} aria-label="Player name" className="w-40 rounded-md border border-line bg-black/30 px-2 py-1 text-sm font-bold" />
        {isBot && <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-mute">bot</span>}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {FACTIONS.map((f) => (
          <button key={f} onClick={() => changeFaction(f)} aria-pressed={cfg.faction === f} className={`rounded-lg border p-2 text-left ${cfg.faction === f ? 'bg-black/30' : 'border-line hover:border-mute'}`} style={cfg.faction === f ? { borderColor: FACTION_META[f].color } : undefined}>
            <div className="text-sm font-bold" style={{ color: FACTION_META[f].color }}>
              {FACTION_META[f].name}
            </div>
            <div className="text-[10px] leading-snug text-ink2">{FACTION_META[f].tagline}</div>
          </button>
        ))}
      </div>
      <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-mute">
        Deck
        <select value={cfg.deckId} onChange={(e) => set({ deckId: e.target.value })} disabled={isBot} className="mt-1 block w-full rounded-md border border-line bg-black/30 px-2 py-1.5 text-sm normal-case text-ink">
          <option value="starter">{FACTION_META[cfg.faction].name} starter deck</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <details className="mt-2" open={!isBot}>
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-mute">
          Skill-tree loadout {isBot && '(random)'}
        </summary>
        <div className="mt-2">
          {isBot ? (
            <button onClick={() => set({ loadout: randomLoadout(cfg.faction) })} className="rounded-md bg-panel2 px-3 py-1.5 text-xs font-semibold">
              Re-roll bot loadout
            </button>
          ) : null}
          <LoadoutPicker faction={cfg.faction} value={cfg.loadout} onChange={(l) => set({ loadout: l })} />
        </div>
      </details>
    </section>
  );
}

export function Setup({ mode, onStart, onBack }: { mode: 'hotseat' | 'bot'; onStart: (s: MatchSetup) => void; onBack: () => void }) {
  const [p1, setP1] = useState<PlayerCfg>(() => ({ name: 'Player 1', faction: 'predator', deckId: 'starter', loadout: defaultLoadout('predator') }));
  const [p2, setP2] = useState<PlayerCfg>(() => ({ name: mode === 'bot' ? 'Bot' : 'Player 2', faction: 'bastion', deckId: 'starter', loadout: mode === 'bot' ? randomLoadout('bastion') : defaultLoadout('bastion') }));
  const [seedText, setSeedText] = useState('');

  const deckOf = (c: PlayerCfg) => (c.deckId === 'starter' ? STARTER_DECKS[c.faction] : (loadDecks().find((d) => d.id === c.deckId)?.cards ?? STARTER_DECKS[c.faction]));
  const errors = useMemo(
    () => [
      ...validateDeck(p1.faction, deckOf(p1)).map((e) => `${p1.name}: ${e}`),
      ...validateLoadout(p1.faction, p1.loadout).map((e) => `${p1.name}: ${e}`),
      ...validateDeck(p2.faction, deckOf(p2)).map((e) => `${p2.name}: ${e}`),
      ...validateLoadout(p2.faction, p2.loadout).map((e) => `${p2.name}: ${e}`),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p1, p2],
  );

  const start = () => {
    const seed = seedText.trim() && Number.isFinite(+seedText) ? Math.floor(+seedText) : Math.floor(Math.random() * 2 ** 31);
    if (mode === 'hotseat') {
      saveLoadout(p1.faction, p1.loadout);
      saveLoadout(p2.faction, p2.loadout);
    } else saveLoadout(p1.faction, p1.loadout);
    onStart({
      seed,
      players: [
        { name: p1.name || 'Player 1', faction: p1.faction, deck: deckOf(p1), loadout: p1.loadout },
        { name: p2.name || 'Player 2', faction: p2.faction, deck: deckOf(p2), loadout: p2.loadout, isBot: mode === 'bot' },
      ],
    });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-3 p-3">
      <h1 className="text-xl font-bold">{mode === 'bot' ? 'Vs Bot' : 'Hotseat'} - set up</h1>
      <PlayerSetup idx={0} cfg={p1} onChange={setP1} />
      <PlayerSetup idx={1} cfg={p2} onChange={setP2} isBot={mode === 'bot'} />
      <label className="text-xs text-ink2">
        Seed (optional, for exact replays)
        <input value={seedText} onChange={(e) => setSeedText(e.target.value)} inputMode="numeric" placeholder="random" className="ml-2 w-32 rounded-md border border-line bg-black/30 px-2 py-1 text-sm" />
      </label>
      {errors.length > 0 && (
        <ul className="rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-xs text-red-300" role="alert">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex gap-2">
        <button onClick={onBack} className="rounded-xl bg-panel2 px-4 py-3 font-semibold">
          Back
        </button>
        <button disabled={errors.length > 0} onClick={start} className="flex-1 rounded-xl bg-accent px-4 py-3 font-bold text-black disabled:opacity-40">
          Start ({defaultConfig.match.maxRounds} rounds max)
        </button>
      </div>
    </div>
  );
}
