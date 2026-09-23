import type { TreeRow } from '../../engine';

/** One node per row. The caller resolves the chip's rows and validation errors. */
export function LoadoutPicker({ rows, errors, value, onChange }: { rows: TreeRow[]; errors: string[]; value: string[]; onChange: (l: string[]) => void }) {
  const pick = (rowNodeIds: string[], id: string) => onChange([...value.filter((v) => !rowNodeIds.includes(v)), id]);
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const ids = row.nodes.map((n) => n.id);
        return (
          <div key={row.id}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mute">{row.name} row</div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {row.nodes.map((n) => {
                const on = value.includes(n.id);
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => pick(ids, n.id)}
                    aria-pressed={on}
                    className={`rounded-lg border p-2 text-left ${on ? 'border-accent bg-accent/10' : 'border-line bg-panel hover:border-mute'}`}
                  >
                    <div className="text-xs font-bold">{n.name}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-ink2">{n.text}</div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {errors.length > 0 && (
        <ul className="rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-[11px] text-red-300" role="alert">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
