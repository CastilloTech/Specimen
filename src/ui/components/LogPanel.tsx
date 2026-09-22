import { useEffect, useRef } from 'react';
import type { LogEntry } from '../../engine';
import { PLAYER_COLORS } from '../meta';

const KIND_STYLE: Partial<Record<LogEntry['kind'], string>> = {
  round: 'mt-2 border-t border-line pt-1 font-bold text-accent',
  reject: 'font-semibold text-red-300',
  evolve: 'font-semibold text-violet-300',
  hit: 'font-semibold text-amber-200',
  end: 'font-bold text-accent',
  stance: 'text-sky-300',
  strain: 'text-amber-200/90',
  heal: 'text-emerald-300',
};

export function LogPanel({ log, className = '' }: { log: LogEntry[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <div ref={ref} className={`scroll-thin overflow-y-auto rounded-xl border border-line bg-panel p-2 text-[12px] leading-snug ${className}`} role="log" aria-label="Match log">
      {log.map((e) => (
        <div key={e.n} className={KIND_STYLE[e.kind] ?? 'text-ink2'}>
          {e.kind === 'round' ? (
            `— ${e.text} —`
          ) : (
            <>
              {e.player !== null && e.kind !== 'end' && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: PLAYER_COLORS[e.player] }} />}
              {e.text}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
