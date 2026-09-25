import type { ReactNode } from 'react';

export interface PillOption<T extends string> {
  id: T;
  label: ReactNode;
  /** Accent for the selected pill (and its label). */
  color?: string;
  /** Small trailing text, e.g. a count. */
  badge?: ReactNode;
  /** Artwork shown above the label (e.g. a Build's chip); makes the pill a small tile. */
  icon?: ReactNode;
  title?: string;
}

/**
 * A compact single-choice row: small pills that wrap on narrow screens. Only the selected option is
 * explained (in `hint`, one line under the row), which keeps setup screens short on a phone.
 */
export function Pills<T extends string>({ options, value, onChange, hint, label, labelIcon, cols }: { options: PillOption<T>[]; value: T; onChange: (v: T) => void; hint?: ReactNode; label?: string; labelIcon?: ReactNode; cols?: number }) {
  return (
    <div>
      {label && (
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-mute">
          {labelIcon}
          {label}
        </div>
      )}
      <div className={cols ? 'grid gap-1.5' : 'flex flex-wrap gap-1.5'} style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined} role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.title}
              onClick={() => onChange(o.id)}
              className={`flex min-h-9 min-w-0 items-center justify-center rounded-lg border font-bold transition ${o.icon ? 'flex-col gap-0.5 py-1' : 'gap-1.5 py-1.5'} ${cols && cols >= 4 ? 'px-1 text-[12px]' : 'px-2 text-[13px]'} ${on ? 'bg-black/35' : 'border-line text-ink2 hover:border-mute'} ${o.icon && !on ? '[&>img]:opacity-60 [&>img]:saturate-50' : ''}`}
              style={on ? { borderColor: o.color ?? 'var(--color-accent)', color: o.color ?? 'var(--color-accent)', boxShadow: `inset 0 0 0 1px ${o.color ?? 'var(--color-accent)'}55` } : o.color ? { color: `${o.color}cc` } : undefined}
            >
              {o.icon}
              <span className="line-clamp-2 min-w-0 text-center leading-tight">{o.label}</span>
              {o.badge !== undefined && <span className="shrink-0 text-[11px] font-semibold opacity-90">{o.badge}</span>}
            </button>
          );
        })}
      </div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-ink2">{hint}</div>}
    </div>
  );
}
