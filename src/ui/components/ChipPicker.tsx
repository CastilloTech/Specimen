import { chipsFor } from '../../engine';
import type { WorldFactionId } from '../../engine';

/** Pick one of the 3 Chips your World Faction offers. Each Chip carries its own 3-row x 2-node tree. */
export function ChipPicker({ worldFaction, value, onChange }: { worldFaction: WorldFactionId; value: string; onChange: (chipId: string) => void }) {
  const chips = chipsFor(worldFaction);
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {chips.map((c) => {
        const on = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            aria-pressed={on}
            className={`rounded-xl border p-2 text-left ${on ? 'border-accent bg-accent/10' : 'border-line bg-panel hover:border-mute'}`}
          >
            <div className="text-sm font-bold">{c.name}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-ink2">{c.text}</div>
            <ul className="mt-1.5 space-y-0.5 text-[10px] text-mute">
              {c.tree.map((row) => (
                <li key={row.id}>
                  {row.name}: {row.nodes.map((n) => n.name).join(' / ')}
                </li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>
  );
}
