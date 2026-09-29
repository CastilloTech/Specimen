import type { GameState } from '../../engine';
import { Creature } from '../components/Specimen';
import type { Lesson } from '../tutorial';

const LEARNED_ADVANCED = ['Chips and their nodes', 'Evolution conditions and forms', 'Status effects: Fever, Numb, Bleed', 'Face-down grafts and Ambush', 'Answering with Protocols', 'Venting toward an evolution'];
const LEARNED = ['Stances: the secret triangle each round', 'Energy, grafts and slots', 'Strain: Stable, Overclocked, rejection', 'The Clash and the Strain check', 'Serums, Toxins, Sabotage and Protocols', 'Hold and Cycle to vent'];

/** After the tutorial match: what you learned and where to go next. */
export function TutorialDone({ state, lesson, onAdvanced, onQuick, onGuide, onModes, onMenu, onReplay }: { state: GameState; lesson: Lesson; onAdvanced: () => void; onQuick: () => void; onGuide: () => void; onModes: () => void; onMenu: () => void; onReplay: () => void }) {
  const won = state.result?.winner === 0;
  const advanced = lesson === 'advanced';
  const learned = advanced ? LEARNED_ADVANCED : LEARNED;
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4 phone:max-w-3xl phone:flex-row phone:items-center">
      <div className="flex flex-col items-center text-center phone:w-[40%] phone:shrink-0">
        <div className="relative h-36 w-36 overflow-hidden rounded-[24px] border border-accent/40 phone:h-[34dvh] phone:w-[34dvh]" style={{ boxShadow: '0 0 40px -8px rgba(80,220,230,0.5)' }}>
          <Creature surge={won} />
        </div>
        <div className="lab-label mt-3">{advanced ? 'Advanced training complete' : 'Training complete'}</div>
        <h1 className="font-display text-3xl font-bold text-accent">{won ? 'Specimen contained!' : advanced ? 'Close one' : 'Good first run'}</h1>
        <p className="mt-1 text-sm text-ink2">{won ? `You won in ${state.round} rounds.` : advanced ? 'The bot got you this time, but you have tried every tool in the game.' : 'The bot got you this time, but you have seen every part of a round.'} You're ready for real matches.</p>
      </div>
      <div className="flex flex-col gap-3 phone:min-w-0 phone:flex-1">
        <section className="lab-panel rounded-xl border border-line p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mute">You learned</div>
          <ul className="grid gap-1 text-[13px] sm:grid-cols-2 phone:grid-cols-2 phone:text-[11px]">
            {learned.map((l) => (
              <li key={l} className="flex gap-1.5">
                <span className="text-accent">✓</span>
                {l}
              </li>
            ))}
          </ul>
        </section>
        {!advanced && (
          <button onClick={onAdvanced} className="rounded-xl border-2 border-amber-400/80 bg-amber-950/30 px-4 py-2.5 text-left font-display font-bold text-amber-200">
            Part 2: advanced training ▶<span className="block font-sans text-xs font-normal text-ink2">Chips, evolution, status effects, face-down grafts and Protocols.</span>
          </button>
        )}
        <button onClick={onQuick} className="rounded-xl bg-accent px-4 py-3 text-left font-display font-bold text-black">
          Quick match ▶<span className="block font-sans text-xs font-normal text-black/70">A real opponent: your picks against a random bot.</span>
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onGuide} className="lab-panel rounded-xl border border-line px-3 py-2 text-left text-sm font-semibold hover:border-accent">
            Game guide<span className="block text-[11px] font-normal text-ink2">Evolutions, factions, Chips</span>
          </button>
          <button onClick={onModes} className="lab-panel rounded-xl border border-line px-3 py-2 text-left text-sm font-semibold hover:border-accent">
            Game Modes<span className="block text-[11px] font-normal text-ink2">Daily, Tower and more</span>
          </button>
        </div>
        <div className="flex gap-2 text-sm">
          <button onClick={onReplay} className="flex-1 rounded-lg border border-line px-3 py-2 text-ink2 hover:border-mute">
            ▶ Watch the replay
          </button>
          <button onClick={onMenu} className="flex-1 rounded-lg bg-panel2 px-3 py-2 font-semibold">
            Menu
          </button>
        </div>
      </div>
    </div>
  );
}
