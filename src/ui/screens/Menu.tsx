import { InstallCard } from '../components/AppPrompts';
import { useState } from 'react';
import { setTutorialDone, tutorialDone } from '../tutorial';
import { DIFFICULTY, lastDifficulty } from '../picks';
import { SoundToggle } from '../components/AudioMenu';
import { Creature } from '../components/Specimen';
import { FACTION_META, WORLD_FACTION_META } from '../meta';
import { activeSave, loadLastSetup } from '../storage';

interface Props {
  onQuick: () => void;
  onModes: () => void;
  onBot: () => void;
  onSaves: () => void;
  onGuide: () => void;
  onDecks: () => void;
  onTutorial: () => void;
}

// Portrait / desktop: one centered column. Phone landscape (`phone:`): art and title on the left,
// compact buttons on the right, so the whole menu fits a short screen without scrolling.
export function Menu({ onQuick, onModes, onBot, onSaves, onGuide, onDecks, onTutorial }: Props) {
  const [newcomer, setNewcomer] = useState(() => !tutorialDone());
  const save = activeSave();
  const last = loadLastSetup()?.[0];
  const tier = DIFFICULTY.find((d) => d.id === lastDifficulty())!;
  const btn = 'lab-panel w-full rounded-xl border border-line px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-accent phone:rounded-lg phone:px-3 phone:py-1.5';
  const desc = 'text-xs text-ink2 phone:hidden';
  return (
    <div
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-4 phone:h-dvh phone:min-h-0 phone:max-w-3xl phone:flex-row phone:items-center phone:gap-6 phone:py-2"
      style={{ paddingLeft: 'max(1rem, env(safe-area-inset-left))', paddingRight: 'max(1rem, env(safe-area-inset-right))' }}
    >
      <div className="mb-2 flex flex-col items-center text-center phone:mb-0 phone:w-[42%] phone:shrink-0">
        <div className="relative h-52 w-52 overflow-hidden rounded-[28px] border border-accent/30 phone:h-[42dvh] phone:w-[42dvh]" style={{ boxShadow: '0 0 44px -8px rgba(80,220,230,0.45)' }}>
          <Creature />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(123,224,176,0.08),transparent_40%)]" />
          {[18, 44, 76].map((l, i) => (
            <span key={l} className="tank-bubble absolute bottom-1 h-1 w-1 rounded-full border border-white/50" style={{ left: `${l}%`, animationDelay: `${i * 1.4}s` }} />
          ))}
        </div>
        <div className="lab-label mt-4 phone:mt-2">Containment lab · playtest build</div>
        <h1 className="font-display text-5xl font-bold tracking-[0.12em] text-accent drop-shadow-[0_0_18px_rgba(123,224,176,0.35)] phone:text-4xl">SPECIMEN</h1>
        <p className="mt-1 text-sm text-ink2 phone:text-xs">One creature. Two players. Graft it, strain it, and break theirs before yours rejects.</p>
      </div>
      <div className="flex w-full flex-col gap-3 phone:min-w-0 phone:flex-1 phone:gap-1.5">
        <div className="flex items-stretch gap-2 phone:gap-1.5">
        <button onClick={onSaves} className="lab-panel flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-line px-4 py-2.5 text-left transition hover:border-accent phone:rounded-lg phone:px-3 phone:py-1.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${save ? 'bg-accent shadow-[0_0_8px_var(--color-accent)]' : 'bg-mute'}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-mute phone:hidden">{save ? `Save slot ${save.slot + 1}` : 'No save loaded'}</span>
            <span className="block truncate font-display font-bold phone:text-sm">{save ? save.meta.name : 'Create a save to keep decks and stats'}</span>
          </span>
          <span className="font-display text-sm font-bold text-accent">Save ›</span>
        </button>
        <div className="lab-panel grid place-items-center rounded-xl border border-line px-1.5 phone:rounded-lg">
          <SoundToggle />
        </div>
        </div>
        {newcomer && (
          <section className="coach-pop relative flex items-center gap-2 rounded-xl border-2 border-amber-400/80 bg-amber-950/30 p-2 phone:rounded-lg phone:p-1.5" aria-label="New here?">
            <button onClick={onTutorial} className="min-w-0 flex-1 text-left">
              <span className="block font-display font-bold text-amber-200">💡 New here? Play the tutorial</span>
              <span className="block text-xs text-ink2 phone:hidden">A coached first match against a gentle bot: about 5 minutes.</span>
            </button>
            <button onClick={onTutorial} className="shrink-0 rounded-lg bg-amber-400 px-3 py-2 font-display text-sm font-bold text-black phone:py-1">
              Start
            </button>
            <button
              onClick={() => {
                setTutorialDone();
                setNewcomer(false);
              }}
              className="shrink-0 px-1 text-mute hover:text-ink"
              aria-label="I know how to play: hide this"
              title="I know how to play"
            >
              ✕
            </button>
          </section>
        )}
        {/* Play: one card. Quick match is the big one-tap button; the full Vs Bot setup sits right under it. */}
        <section className="lab-panel rounded-xl border border-accent/50 p-2 phone:rounded-lg phone:p-1.5" aria-label="Play">
          <button className="w-full rounded-lg bg-accent px-4 py-3.5 text-left text-black shadow-[0_0_24px_-6px_rgba(123,224,176,0.6)] transition hover:brightness-110 phone:px-3 phone:py-2" onClick={onQuick}>
            <div className="flex items-center justify-between font-display text-lg font-bold phone:text-base">
              Quick match <span aria-hidden>▶</span>
            </div>
            <div className="text-xs text-black/70">
              {last ? (
                <>
                  Your {FACTION_META[last.faction]?.name}/{WORLD_FACTION_META[last.worldFaction]?.name} vs a random {tier.label} bot. No setup.
                </>
              ) : (
                `Straight into a game against a random ${tier.label} bot.`
              )}
            </div>
          </button>
          <button onClick={onBot} className="mt-1.5 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-ink2 transition hover:bg-white/5 hover:text-ink phone:mt-1 phone:py-1">
            <span>
              <b className="font-display text-ink">Custom match</b>
              <span className="phone:hidden"> · difficulty, both Specimens, decks and Chips</span>
            </span>
            <span aria-hidden>›</span>
          </button>
        </section>
        <InstallCard />
        <button className={`${btn} border-accent/50`} onClick={onModes}>
          <div className="font-display font-bold text-accent">Game Modes</div>
          <div className={desc}>A daily challenge, the Tower, Lineage and Containment Breach: earn biomass, craft cards and unlock Builds, World Factions and Chips.</div>
        </button>
        <div className="grid grid-cols-2 gap-3 phone:gap-1.5">
          <button className={btn} onClick={onDecks}>
            <div className="font-display font-bold">Decks &amp; Chips</div>
            <div className={desc}>Build 20-card decks, set Chip loadouts.</div>
          </button>
          <button className={btn} onClick={onGuide}>
            <div className="font-display font-bold">Game guide</div>
            <div className={desc}>How to play, step by step, and the tutorial match.</div>
          </button>
        </div>
      </div>
    </div>
  );
}
