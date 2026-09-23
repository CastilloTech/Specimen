import { useMemo, useState } from 'react';
import { chipRows, chipsFor, defaultConfig, FACTIONS, makeRng, starterDeck, validateChipChoice, validateDeck, validateLoadout, WORLD_FACTIONS } from '../../engine';
import type { Faction, MatchSetup, WorldFactionId } from '../../engine';
import { ChipPicker } from '../components/ChipPicker';
import { LoadoutPicker } from '../components/LoadoutPicker';
import { FACTION_META, PLAYER_COLORS, WORLD_FACTION_META } from '../meta';
import { activeSave, loadChipLoadouts, loadDecks, loadLastSetup, saveChipLoadout, saveLastSetup } from '../storage';
import type { LastPlayerPick } from '../storage';

interface PlayerCfg {
  name: string;
  faction: Faction;
  worldFaction: WorldFactionId;
  chip: string;
  deckId: string; // 'starter' or a saved deck id
  loadout: string[];
}

const defaultChip = (wf: WorldFactionId) => chipsFor(wf)[0].id;
// A saved loadout can go stale if the chip's own nodes changed since it was saved (localStorage
// persists across data updates); fall back to the chip's default nodes rather than surface invalid ids.
const defaultLoadout = (chipId: string) => {
  const saved = loadChipLoadouts()[chipId];
  if (saved && validateLoadout(chipId, saved).length === 0) return saved;
  return chipRows(chipId).map((r) => r.nodes[0].id);
};
const randomLoadout = (chipId: string) => {
  const rng = makeRng(Math.floor(Math.random() * 2 ** 31));
  return chipRows(chipId).map((r) => rng.pick(r.nodes).id);
};

/** A random Build, World Faction, Chip and loadout: the bot's "surprise me" opponent. */
function randomCfg(name: string): PlayerCfg {
  const rng = makeRng(Math.floor(Math.random() * 2 ** 31));
  const faction = rng.pick([...FACTIONS]);
  const worldFaction = rng.pick([...WORLD_FACTIONS]);
  const chip = rng.pick(chipsFor(worldFaction)).id;
  return { name, faction, worldFaction, chip, deckId: 'starter', loadout: randomLoadout(chip) };
}

/** Restore a remembered pick if it still fits today's data (chip in that World Faction, deck still saved). */
function fromPick(pick: LastPlayerPick | undefined, isBot: boolean): PlayerCfg | null {
  if (!pick || !FACTIONS.includes(pick.faction) || !WORLD_FACTIONS.includes(pick.worldFaction)) return null;
  const chip = chipsFor(pick.worldFaction).some((c) => c.id === pick.chip) ? pick.chip : defaultChip(pick.worldFaction);
  const deckOk = pick.deckId === 'starter' || loadDecks().some((d) => d.id === pick.deckId && d.faction === pick.faction && d.worldFaction === pick.worldFaction);
  return { name: pick.name, faction: pick.faction, worldFaction: pick.worldFaction, chip, deckId: deckOk ? pick.deckId : 'starter', loadout: isBot ? randomLoadout(chip) : defaultLoadout(chip) };
}

const deckOf = (c: PlayerCfg) => (c.deckId === 'starter' ? starterDeck(c.faction, c.worldFaction) : (loadDecks().find((d) => d.id === c.deckId)?.cards ?? starterDeck(c.faction, c.worldFaction)));
const toPick = ({ name, faction, worldFaction, chip, deckId }: PlayerCfg): LastPlayerPick => ({ name, faction, worldFaction, chip, deckId });

/** The loaded save's player name, or a plain default without a save. */
const playerName = () => activeSave()?.meta.name ?? 'Player 1';

/** Your defaults (the loaded save's last picks), named after the save. */
function myDefaults(): PlayerCfg {
  const cfg = fromPick(loadLastSetup()?.[0], false) ?? makeDefaultCfg('Player 1', 'predator', 'corrosion', false);
  return { ...cfg, name: playerName() };
}

/** Quick match: your default picks against a random bot build, no setup screen. */
export function quickBotSetup(): MatchSetup {
  const me = myDefaults();
  const bot = randomCfg('Bot');
  return {
    seed: Math.floor(Math.random() * 2 ** 31),
    players: [
      { name: me.name, faction: me.faction, worldFaction: me.worldFaction, chip: me.chip, deck: deckOf(me), loadout: me.loadout },
      { name: bot.name, faction: bot.faction, worldFaction: bot.worldFaction, chip: bot.chip, deck: deckOf(bot), loadout: bot.loadout, isBot: true },
    ],
  };
}

function PlayerSetup({ idx, cfg, onChange, isBot, nameLocked }: { idx: 0 | 1; cfg: PlayerCfg; onChange: (c: PlayerCfg) => void; isBot?: boolean; nameLocked?: boolean }) {
  const decks = loadDecks().filter((d) => d.faction === cfg.faction && d.worldFaction === cfg.worldFaction);
  const set = (patch: Partial<PlayerCfg>) => onChange({ ...cfg, ...patch });
  const changeFaction = (f: Faction) => set({ faction: f, deckId: 'starter' });
  const changeWorldFaction = (wf: WorldFactionId) => {
    const chip = defaultChip(wf);
    set({ worldFaction: wf, chip, deckId: 'starter', loadout: isBot ? randomLoadout(chip) : defaultLoadout(chip) });
  };
  const changeChip = (chip: string) => set({ chip, loadout: isBot ? randomLoadout(chip) : defaultLoadout(chip) });
  return (
    <section className="lab-panel rounded-xl border border-line p-3" style={{ borderLeft: `4px solid ${PLAYER_COLORS[idx]}` }}>
      <div className="flex items-center gap-2">
        <input value={cfg.name} onChange={(e) => set({ name: e.target.value })} readOnly={nameLocked} title={nameLocked ? 'Your save name (rename it on the Save screen)' : undefined} maxLength={16} aria-label="Player name" className={`w-40 rounded-md border border-line px-2 py-1 text-sm font-bold ${nameLocked ? 'bg-transparent text-accent' : 'bg-black/30'}`} />
        {isBot && <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-mute">bot</span>}
        {isBot && (
          <button onClick={() => onChange(randomCfg(cfg.name))} className="ml-auto rounded-md bg-panel2 px-3 py-1 text-xs font-semibold hover:bg-accent/20" title="Random Build, World Faction, Chip and loadout">
            Randomize opponent
          </button>
        )}
      </div>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-mute">Build (Strain, cards, evolutions)</div>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {FACTIONS.map((f) => (
          <button key={f} onClick={() => changeFaction(f)} aria-pressed={cfg.faction === f} className={`rounded-lg border p-2 text-left ${cfg.faction === f ? 'bg-black/30' : 'border-line hover:border-mute'}`} style={cfg.faction === f ? { borderColor: FACTION_META[f].color } : undefined}>
            <div className="text-sm font-bold" style={{ color: FACTION_META[f].color }}>
              {FACTION_META[f].name}
            </div>
            <div className="text-[10px] leading-snug text-ink2">{FACTION_META[f].tagline}</div>
          </button>
        ))}
      </div>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-mute">World Faction (a second card pool and Chip tree)</div>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {WORLD_FACTIONS.map((wf) => (
          <button
            key={wf}
            onClick={() => changeWorldFaction(wf)}
            aria-pressed={cfg.worldFaction === wf}
            className={`rounded-lg border p-2 text-left ${cfg.worldFaction === wf ? 'bg-black/30' : 'border-line hover:border-mute'}`}
            style={cfg.worldFaction === wf ? { borderColor: WORLD_FACTION_META[wf].color } : undefined}
          >
            <div className="text-sm font-bold" style={{ color: WORLD_FACTION_META[wf].color }}>
              {WORLD_FACTION_META[wf].name}
            </div>
            <div className="text-[10px] leading-snug text-ink2">{WORLD_FACTION_META[wf].tagline}</div>
          </button>
        ))}
      </div>
      <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-mute">
        Deck
        <select value={cfg.deckId} onChange={(e) => set({ deckId: e.target.value })} disabled={isBot} className="mt-1 block w-full rounded-md border border-line bg-black/30 px-2 py-1.5 text-sm normal-case text-ink">
          <option value="starter">
            {FACTION_META[cfg.faction].name} / {WORLD_FACTION_META[cfg.worldFaction].name} starter deck
          </option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-mute">Chip {isBot && '(random)'}</div>
      <div className="mt-1">
        {isBot ? (
          <button onClick={() => set({ loadout: randomLoadout(cfg.chip) })} className="mb-1.5 rounded-md bg-panel2 px-3 py-1.5 text-xs font-semibold">
            Re-roll bot loadout
          </button>
        ) : null}
        <ChipPicker worldFaction={cfg.worldFaction} value={cfg.chip} onChange={changeChip} />
      </div>
      <details className="mt-2" open={!isBot}>
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-mute">Chip loadout {isBot && '(random)'}</summary>
        <div className="mt-2">
          <LoadoutPicker rows={chipRows(cfg.chip)} errors={validateLoadout(cfg.chip, cfg.loadout)} value={cfg.loadout} onChange={(l) => set({ loadout: l })} />
        </div>
      </details>
    </section>
  );
}

function makeDefaultCfg(name: string, faction: Faction, worldFaction: WorldFactionId, isBot: boolean): PlayerCfg {
  const chip = defaultChip(worldFaction);
  return { name, faction, worldFaction, chip, deckId: 'starter', loadout: isBot ? randomLoadout(chip) : defaultLoadout(chip) };
}

export function Setup({ onStart, onBack }: { onStart: (s: MatchSetup) => void; onBack: () => void }) {
  const save = activeSave();
  const [p1, setP1] = useState<PlayerCfg>(myDefaults);
  const [p2, setP2] = useState<PlayerCfg>(() => fromPick(loadLastSetup()?.[1], true) ?? makeDefaultCfg('Bot', 'bastion', 'aegis', true));
  const [seedText, setSeedText] = useState('');

  const errors = useMemo(
    () => [
      ...validateDeck(p1.faction, p1.worldFaction, deckOf(p1)).map((e) => `${p1.name}: ${e}`),
      ...validateChipChoice(p1.worldFaction, p1.chip).map((e) => `${p1.name}: ${e}`),
      ...validateLoadout(p1.chip, p1.loadout).map((e) => `${p1.name}: ${e}`),
      ...validateDeck(p2.faction, p2.worldFaction, deckOf(p2)).map((e) => `${p2.name}: ${e}`),
      ...validateChipChoice(p2.worldFaction, p2.chip).map((e) => `${p2.name}: ${e}`),
      ...validateLoadout(p2.chip, p2.loadout).map((e) => `${p2.name}: ${e}`),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p1, p2],
  );

  const start = () => {
    const seed = seedText.trim() && Number.isFinite(+seedText) ? Math.floor(+seedText) : Math.floor(Math.random() * 2 ** 31);
    saveChipLoadout(p1.chip, p1.loadout);
    saveLastSetup([toPick(p1), toPick(p2)]);
    onStart({
      seed,
      players: [
        { name: p1.name || 'Player 1', faction: p1.faction, worldFaction: p1.worldFaction, chip: p1.chip, deck: deckOf(p1), loadout: p1.loadout },
        { name: p2.name || 'Bot', faction: p2.faction, worldFaction: p2.worldFaction, chip: p2.chip, deck: deckOf(p2), loadout: p2.loadout, isBot: true },
      ],
    });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-3 p-3 pb-0">
      <div>
        <div className="lab-label">{save ? `Save: ${save.meta.name} · your picks become your defaults` : 'No save loaded · picks are remembered on this device only'}</div>
        <h1 className="font-display text-2xl font-bold">Vs Bot</h1>
      </div>
      <PlayerSetup idx={0} cfg={p1} onChange={setP1} nameLocked={!!save} />
      <PlayerSetup idx={1} cfg={p2} onChange={setP2} isBot />
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
      {/* Sticky so Start is always one click away, however far down the loadouts go. */}
      <div className="sticky bottom-0 z-20 -mx-3 mt-auto flex gap-2 border-t border-line bg-bg/90 px-3 py-3 backdrop-blur">
        <button onClick={onBack} className="rounded-xl bg-panel2 px-4 py-3 font-semibold">
          Back
        </button>
        <div className="hidden min-w-0 flex-1 items-center gap-2 text-xs text-ink2 sm:flex">
          <span className="truncate" style={{ color: FACTION_META[p1.faction].color }}>
            {FACTION_META[p1.faction].name}/{WORLD_FACTION_META[p1.worldFaction].name}
          </span>
          <span className="text-mute">vs</span>
          <span className="truncate" style={{ color: FACTION_META[p2.faction].color }}>
            {FACTION_META[p2.faction].name}/{WORLD_FACTION_META[p2.worldFaction].name}
          </span>
        </div>
        <button disabled={errors.length > 0} onClick={start} className="flex-1 rounded-xl bg-accent px-4 py-3 font-display font-bold text-black disabled:opacity-40 sm:flex-none sm:px-8">
          Start ({defaultConfig.match.maxRounds} rounds max)
        </button>
      </div>
    </div>
  );
}
