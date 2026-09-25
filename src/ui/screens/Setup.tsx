import { useMemo, useState } from 'react';
import { chipRows, chipsFor, findNode, FACTIONS, makeRng, starterDeck, validateChipChoice, validateDeck, validateLoadout, WORLD_FACTIONS } from '../../engine';
import type { Faction, MatchSetup, WorldFactionId } from '../../engine';
import { ChipPicker } from '../components/ChipPicker';
import { ChipArt, Emblem } from '../components/Emblem';
import { Pills } from '../components/Pills';
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

const buildOptions = FACTIONS.map((f) => ({ id: f, label: FACTION_META[f].name, color: FACTION_META[f].color, title: FACTION_META[f].tagline, icon: <ChipArt id={f} size={34} /> }));
const worldOptions = WORLD_FACTIONS.map((wf) => ({ id: wf, label: WORLD_FACTION_META[wf].name, color: WORLD_FACTION_META[wf].color, title: WORLD_FACTION_META[wf].tagline, icon: <ChipArt id={wf} size={30} /> }));

/** Build, World Faction, deck, Chip and (for you) the loadout, as compact pickers. */
function PlayerPicks({ cfg, onChange, isBot }: { cfg: PlayerCfg; onChange: (c: PlayerCfg) => void; isBot?: boolean }) {
  const decks = loadDecks().filter((d) => d.faction === cfg.faction && d.worldFaction === cfg.worldFaction);
  const set = (patch: Partial<PlayerCfg>) => onChange({ ...cfg, ...patch });
  const changeWorldFaction = (wf: WorldFactionId) => {
    const chip = defaultChip(wf);
    set({ worldFaction: wf, chip, deckId: 'starter', loadout: isBot ? randomLoadout(chip) : defaultLoadout(chip) });
  };
  const changeChip = (chip: string) => set({ chip, loadout: isBot ? randomLoadout(chip) : defaultLoadout(chip) });
  return (
    <div className="space-y-3">
      <Pills label="Build" cols={3} options={buildOptions} value={cfg.faction} onChange={(f) => set({ faction: f, deckId: 'starter' })} hint={FACTION_META[cfg.faction].tagline} />
      <Pills label="World Faction" cols={4} options={worldOptions} value={cfg.worldFaction} onChange={changeWorldFaction} hint={WORLD_FACTION_META[cfg.worldFaction].tagline} />
      {!isBot && (
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-mute">Deck</span>
          <select value={cfg.deckId} onChange={(e) => set({ deckId: e.target.value })} className="block min-h-9 w-full rounded-lg border border-line bg-black/30 px-2 text-[13px]">
            <option value="starter">Starter deck</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <ChipPicker worldFaction={cfg.worldFaction} value={cfg.chip} onChange={changeChip} />
      {isBot ? (
        <div className="flex items-center gap-2 text-[11px] text-ink2">
          <span className="min-w-0 flex-1 truncate">Loadout: {cfg.loadout.map((id) => findNode(id)?.name ?? id).join(' · ')}</span>
          <button onClick={() => set({ loadout: randomLoadout(cfg.chip) })} className="shrink-0 rounded-md border border-line px-2 py-1 font-semibold hover:border-mute">
            Re-roll
          </button>
        </div>
      ) : (
        <LoadoutPicker rows={chipRows(cfg.chip)} errors={validateLoadout(cfg.chip, cfg.loadout)} value={cfg.loadout} onChange={(l) => set({ loadout: l })} />
      )}
    </div>
  );
}

/** "Predator / Corrosion · Acid Fang" in the identity colors. */
function Identity({ cfg }: { cfg: PlayerCfg }) {
  return (
    <span className="min-w-0 truncate text-[13px] font-semibold">
      <Emblem id={cfg.faction} size={16} className="mr-0.5 -mt-0.5 align-middle" />
      <span style={{ color: FACTION_META[cfg.faction].color }}>{FACTION_META[cfg.faction].name}</span>
      <span className="text-mute"> / </span>
      <Emblem id={cfg.worldFaction} size={16} className="mr-0.5 -mt-0.5 align-middle" />
      <span style={{ color: WORLD_FACTION_META[cfg.worldFaction].color }}>{WORLD_FACTION_META[cfg.worldFaction].name}</span>
      <span className="text-mute"> · {chipsFor(cfg.worldFaction).find((c) => c.id === cfg.chip)?.name}</span>
    </span>
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
  const [editBot, setEditBot] = useState(false);

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
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-3 p-3 pb-0">
      <header className="flex items-center gap-2">
        <button onClick={onBack} className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink2 hover:border-mute" aria-label="Back to menu">
          ←
        </button>
        <h1 className="font-display text-xl font-bold">Vs Bot</h1>
        <span className="ml-auto truncate text-[11px] text-mute">{save ? `Save: ${save.meta.name}` : 'No save loaded'}</span>
      </header>

      <section className="lab-panel rounded-xl border border-line p-3" style={{ borderTop: `3px solid ${PLAYER_COLORS[0]}` }} aria-label="Your Specimen">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">You</span>
          {save ? (
            <span className="font-display text-sm font-bold text-accent" title="Your save name (rename it on the Save screen)">
              {p1.name}
            </span>
          ) : (
            <input value={p1.name} onChange={(e) => setP1({ ...p1, name: e.target.value })} maxLength={16} aria-label="Player name" className="w-36 rounded-md border border-line bg-black/30 px-2 py-0.5 text-sm font-bold" />
          )}
        </div>
        <PlayerPicks cfg={p1} onChange={setP1} />
      </section>

      <section className="lab-panel rounded-xl border border-line p-3" style={{ borderTop: `3px solid ${PLAYER_COLORS[1]}` }} aria-label="Opponent">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">Opponent</span>
          <Identity cfg={p2} />
          <div className="ml-auto flex shrink-0 gap-1.5">
            <button onClick={() => setP2(randomCfg(p2.name))} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold hover:border-mute" title="Random Build, World Faction, Chip and loadout">
              🎲 Random
            </button>
            <button onClick={() => setEditBot((v) => !v)} aria-expanded={editBot} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${editBot ? 'border-accent text-accent' : 'border-line hover:border-mute'}`}>
              {editBot ? 'Done' : 'Edit'}
            </button>
          </div>
        </div>
        {editBot && (
          <div className="mt-3">
            <PlayerPicks cfg={p2} onChange={setP2} isBot />
          </div>
        )}
      </section>

      <details className="text-xs text-ink2">
        <summary className="cursor-pointer select-none text-mute">Advanced</summary>
        <label className="mt-2 flex items-center gap-2">
          Seed (for exact replays)
          <input value={seedText} onChange={(e) => setSeedText(e.target.value)} inputMode="numeric" placeholder="random" className="w-32 rounded-md border border-line bg-black/30 px-2 py-1 text-sm" />
        </label>
      </details>

      {errors.length > 0 && (
        <ul className="rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-xs text-red-300" role="alert">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}
      {/* Sticky so Start is always one tap away. */}
      <div className="sticky bottom-0 z-20 -mx-3 mt-auto flex items-center gap-2 border-t border-line bg-bg/90 px-3 pt-2.5 backdrop-blur" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
        <div className="hidden min-w-0 flex-1 items-center gap-2 text-xs sm:flex">
          <Identity cfg={p1} />
          <span className="shrink-0 text-mute">vs</span>
          <Identity cfg={p2} />
        </div>
        <button disabled={errors.length > 0} onClick={start} className="flex-1 rounded-xl bg-accent px-4 py-3 font-display font-bold text-black disabled:opacity-40 sm:flex-none sm:px-10">
          Start match
        </button>
      </div>
    </div>
  );
}
