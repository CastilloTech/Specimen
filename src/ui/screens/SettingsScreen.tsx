import { defaultConfig } from '../../engine';
import type { Settings } from '../storage';

const ROWS: { key: keyof Settings; name: string; text: string }[] = [
  { key: 'timers', name: 'Timers', text: `${defaultConfig.timers.stanceSeconds}s per stance; ${defaultConfig.timers.mulliganSeconds}s for the opening keep/mulligan decision; ${defaultConfig.timers.actionSeconds}s per action plus a ${defaultConfig.timers.reserveSeconds}s reserve bank per player per match. Running out passes / auto-picks (keeps the hand for the mulligan).` },
  { key: 'cycling', name: 'Cycling', text: 'Once per round, as an action, discard a card to vent 1 Strain or draw 1.' },
  { key: 'dormant', name: 'Dormant grafts', text: 'A graft may be attached face-down and asleep: no stats or text, less Strain, hidden from the opponent. Waking it later (after a round asleep) gives an Ambush attack bonus.' },
  { key: 'neuralLinks', name: 'Neural links', text: 'Nerve grafts give +1 attack to grafts in adjacent slots. (Off by default.)' },
  { key: 'energyBanking', name: 'Energy banking', text: 'Carry over up to 2 unspent Energy. (Off by default.)' },
  { key: 'stanceMomentum', name: 'Stance momentum', text: 'Picking the same stance two rounds in a row gives +1 to its effect. (Off by default.)' },
  { key: 'replaceGrafts', name: 'Replace grafts', text: `Play a graft onto an occupied slot to replace it for ${defaultConfig.replace.extraCost} extra Energy. The old graft is discarded with its Strain. A late-game Energy sink.` },
];

const QOL_ROWS: { key: keyof Settings; name: string; text: string }[] = [
  { key: 'confirmPass', name: 'Confirm before passing', text: 'If you still have a card you can afford and play, Pass asks first. Stops mis-taps.' },
  { key: 'keyboard', name: 'Keyboard shortcuts', text: 'In a match: A / D / F pick a stance, 1-9 select a card, P pass, H hold, N no response, Esc cancel, ? help.' },
];

export function SettingsScreen({ settings, onChange, onBack }: { settings: Settings; onChange: (s: Settings) => void; onBack: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-4">
      <h1 className="text-xl font-bold">Settings</h1>
      <p className="text-xs text-ink2">These apply to the next match you start. Numbers such as HP or Strain threshold live in src/data/config.json.</p>
      {[...ROWS, ...QOL_ROWS].map((r) => (
        <label key={r.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-panel p-3">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-emerald-400" checked={settings[r.key]} onChange={(e) => onChange({ ...settings, [r.key]: e.target.checked })} />
          <span>
            <span className="block text-sm font-bold">{r.name}</span>
            <span className="block text-xs text-ink2">{r.text}</span>
          </span>
        </label>
      ))}
      <button onClick={onBack} className="mt-auto rounded-xl bg-accent px-4 py-3 font-bold text-black">
        Done
      </button>
    </div>
  );
}
