import type { TreeRow } from '../../engine';

/** One node per row, two nodes side by side (also on a phone). The caller resolves rows and validation errors. */
export function LoadoutPicker({ rows, errors, value, onChange, disabled }: { rows: TreeRow[]; errors: string[]; value: string[]; onChange: (l: string[]) => void; disabled?: boolean }) {
  const pick = (rowNodeIds: string[], id: string) => onChange([...value.filter((v) => !rowNodeIds.includes(v)), id]);
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const ids = row.nodes.map((n) => n.id);
        return (
          <div key={row.id} role="radiogroup" aria-label={`${row.name} row`}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mute">{row.name}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {row.nodes.map((n) => {
                const on = value.includes(n.id);
                return (
                  <button
                    key={n.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => pick(ids, n.id)}
                    className={`rounded-lg border px-2 py-1.5 text-left transition disabled:cursor-default ${on ? 'border-accent bg-accent/10' : 'border-line hover:border-mute disabled:opacity-50'}`}
                  >
                    <div className={`text-[12px] font-bold ${on ? 'text-accent' : ''}`}>{n.name}</div>
                    <div className="mt-0.5 text-[10.5px] leading-snug text-ink2">{n.text}</div>
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
