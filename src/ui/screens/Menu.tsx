import { Creature } from '../components/Specimen';
import { FACTION_META, WORLD_FACTION_META } from '../meta';
import { activeSave, loadLastSetup } from '../storage';

interface Props {
  onQuick: () => void;
  onBot: () => void;
  onSaves: () => void;
  onGuide: () => void;
  onDecks: () => void;
  onSettings: () => void;
}

export function Menu({ onQuick, onBot, onSaves, onGuide, onDecks, onSettings }: Props) {
  const save = activeSave();
  const last = loadLastSetup()?.[0];
  const btn = 'lab-panel w-full rounded-xl border border-line px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-accent';
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-4">
      <div className="mb-2 flex flex-col items-center text-center">
        <div className="relative h-52 w-52 overflow-hidden rounded-[28px] border border-accent/30" style={{ boxShadow: '0 0 44px -8px rgba(80,220,230,0.45)' }}>
          <Creature />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(123,224,176,0.08),transparent_40%)]" />
          {[18, 44, 76].map((l, i) => (
            <span key={l} className="tank-bubble absolute bottom-1 h-1 w-1 rounded-full border border-white/50" style={{ left: `${l}%`, animationDelay: `${i * 1.4}s` }} />
          ))}
        </div>
        <div className="lab-label mt-4">Containment lab · playtest build</div>
        <h1 className="font-display text-5xl font-bold tracking-[0.12em] text-accent drop-shadow-[0_0_18px_rgba(123,224,176,0.35)]">SPECIMEN</h1>
        <p className="mt-1 text-sm text-ink2">One creature. Two players. Graft it, strain it, and break theirs before yours rejects.</p>
      </div>
      <button onClick={onSaves} className="lab-panel flex items-center gap-3 rounded-xl border border-line px-4 py-2.5 text-left transition hover:border-accent">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${save ? 'bg-accent shadow-[0_0_8px_var(--color-accent)]' : 'bg-mute'}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-mute">{save ? `Save slot ${save.slot + 1}` : 'No save loaded'}</span>
          <span className="block truncate font-display font-bold">{save ? save.meta.name : 'Create a save to keep decks and stats'}</span>
        </span>
        <span className="font-display text-sm font-bold text-accent">Save ›</span>
      </button>
      <button className="w-full rounded-xl bg-accent px-4 py-4 text-left text-black shadow-[0_0_24px_-6px_rgba(123,224,176,0.6)] transition hover:brightness-110" onClick={onQuick}>
        <div className="font-display text-lg font-bold">Quick match</div>
        <div className="text-xs text-black/70">
          {last ? (
            <>
              Your {FACTION_META[last.faction]?.name}/{WORLD_FACTION_META[last.worldFaction]?.name} vs a random bot build. No setup.
            </>
          ) : (
            'Jump straight into a game against a random bot build.'
          )}
        </div>
      </button>
      <button className={btn} onClick={onBot}>
        <div className="font-display font-bold">Vs Bot</div>
        <div className="text-xs text-ink2">Choose both Specimens' Build, World Faction, Chip and deck.</div>
      </button>
      <button className={btn} onClick={onGuide}>
        <div className="font-display font-bold">Game guide</div>
        <div className="text-xs text-ink2">A quick, step-by-step tutorial: the goal, a round, stances, Strain, cards and evolution.</div>
      </button>
      <div className="grid grid-cols-2 gap-3">
        <button className={btn} onClick={onDecks}>
          <div className="font-display font-bold">Decks &amp; Chips</div>
          <div className="text-xs text-ink2">Build 20-card decks, set Chip loadouts.</div>
        </button>
        <button className={btn} onClick={onSettings}>
          <div className="font-display font-bold">Settings</div>
          <div className="text-xs text-ink2">Key bindings.</div>
        </button>
      </div>
    </div>
  );
}
