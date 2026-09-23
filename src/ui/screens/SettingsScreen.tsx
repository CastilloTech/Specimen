import { useEffect, useState } from 'react';
import type { KeyAction, Settings } from '../storage';
import { defaultKeybinds, KEY_ACTIONS, keyLabel } from '../storage';

// 1-9 select hand cards (and 1-3 always pick a stance) and Escape cancels, so they cannot be rebound.
const RESERVED = new Set(['escape', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'tab', 'enter', 'shift', 'control', 'alt', 'meta']);

export function SettingsScreen({ settings, onChange, onBack }: { settings: Settings; onChange: (s: Settings) => void; onBack: () => void }) {
  const [listening, setListening] = useState<KeyAction | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const binds = settings.keybinds;

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        setListening(null);
        setNote(null);
        return;
      }
      if (RESERVED.has(k)) {
        setNote(`${keyLabel(e.key)} is reserved (1-9 pick cards, Esc cancels). Try another key.`);
        return;
      }
      onChange({ keybinds: { ...binds, [listening]: k } });
      setListening(null);
      setNote(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listening, binds, onChange]);

  const counts = new Map<string, number>();
  for (const a of KEY_ACTIONS) counts.set(binds[a.id], (counts.get(binds[a.id]) ?? 0) + 1);

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-3 p-4">
      <div>
        <div className="lab-label">Settings</div>
        <h1 className="font-display text-2xl font-bold">Key bindings</h1>
        <p className="mt-1 text-xs text-ink2">Click an action, then press the key you want. Esc cancels. 1-9 always select hand cards (and 1 / 2 / 3 pick a stance), so they can't be rebound.</p>
      </div>
      <div className="lab-panel divide-y divide-line rounded-xl border border-line">
        {KEY_ACTIONS.map((a) => {
          const clash = (counts.get(binds[a.id]) ?? 0) > 1;
          const active = listening === a.id;
          return (
            <div key={a.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm font-bold">{a.label}</div>
                <div className="text-[11px] text-ink2">{a.hint}</div>
              </div>
              <button
                onClick={() => {
                  setListening(active ? null : a.id);
                  setNote(null);
                }}
                className={`min-w-20 rounded-lg border px-3 py-1.5 font-mono text-sm font-bold ${active ? 'turn-glow border-accent bg-accent/20 text-accent' : clash ? 'border-amber-500 bg-amber-950/40 text-amber-300' : 'border-line bg-panel2 hover:border-accent'}`}
                aria-label={`Rebind ${a.label}`}
              >
                {active ? 'Press…' : keyLabel(binds[a.id])}
              </button>
            </div>
          );
        })}
      </div>
      {note && <div className="rounded-lg bg-amber-950/40 px-3 py-2 text-xs text-amber-300">{note}</div>}
      {[...counts.values()].some((n) => n > 1) && <div className="rounded-lg bg-amber-950/40 px-3 py-2 text-xs text-amber-300">Two actions share a key (highlighted). In a match the key does whichever of them applies at that moment, so a shared key only works if the actions never come up at the same time.</div>}
      <div className="mt-auto flex gap-2">
        <button onClick={() => onChange({ keybinds: defaultKeybinds() })} className="rounded-xl bg-panel2 px-4 py-3 font-semibold">
          Reset to defaults
        </button>
        <button onClick={onBack} className="flex-1 rounded-xl bg-accent px-4 py-3 font-display font-bold text-black">
          Done
        </button>
      </div>
    </div>
  );
}
