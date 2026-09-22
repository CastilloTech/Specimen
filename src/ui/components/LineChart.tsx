import { useState } from 'react';
import { PLAYER_COLORS } from '../meta';

interface Props {
  title: string;
  names: [string, string];
  rounds: number[];
  values: [number[], number[]];
  yMax: number;
  yStep: number;
  /** Optional horizontal reference line (e.g. the Rejection threshold). */
  refLine?: { y: number; label: string };
}

const W = 360;
const H = 190;
const M = { l: 30, r: 34, t: 12, b: 24 };
const SURFACE = '#151b19';

/** Two-series line chart: 2px lines, 10px markers with a surface ring, crosshair tooltip, table view. */
export function LineChart({ title, names, rounds, values, yMax, yStep, refLine }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const n = rounds.length;
  const x = (i: number) => M.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - M.l - M.r));
  const y = (v: number) => M.t + (1 - Math.min(v, yMax) / yMax) * (H - M.t - M.b);
  const ticks = Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep);
  const path = (vs: number[]) => vs.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (W - M.l - M.r);
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / (W - M.l - M.r)) * (n - 1)))));
  };

  const summary = `${title}: ${names[0]} ends at ${values[0][n - 1]}, ${names[1]} ends at ${values[1][n - 1]}.`;

  return (
    <figure className="rounded-xl border border-line bg-panel p-3">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm font-bold">{title}</span>
        {names.map((nm, k) => (
          <span key={k} className="flex items-center gap-1.5 text-xs text-ink2">
            <span className="inline-block h-[3px] w-4 rounded" style={{ background: PLAYER_COLORS[k] }} />
            {nm}
          </span>
        ))}
        <button onClick={() => setTable((t) => !t)} className="ml-auto text-[11px] text-mute underline">
          {table ? 'Show chart' : 'Show as table'}
        </button>
      </figcaption>
      {table ? (
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-mute">
              <th className="py-1">Round</th>
              <th>{names[0]}</th>
              <th>{names[1]}</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r, i) => (
              <tr key={r} className="border-t border-line">
                <td className="py-1">{r === 0 ? 'start' : r}</td>
                <td>{values[0][i]}</td>
                <td>{values[1][i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full touch-none" role="img" aria-label={summary}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#383835' : '#2c2c2a'} strokeWidth={1} />
                <text x={M.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#898781">
                  {t}
                </text>
              </g>
            ))}
            {rounds.map((r, i) => (
              <text key={r} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#898781">
                {r === 0 ? 'start' : `R${r}`}
              </text>
            ))}
            {refLine && (
              <g>
                <line x1={M.l} x2={W - M.r} y1={y(refLine.y)} y2={y(refLine.y)} stroke="#d03b3b" strokeWidth={1} strokeDasharray="4 3" />
                <text x={W - M.r + 3} y={y(refLine.y) + 3} fontSize="8" fill="#d03b3b">
                  {refLine.label}
                </text>
              </g>
            )}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={H - M.b} stroke="#8a948f" strokeWidth={1} />}
            {[0, 1].map((k) => (
              <g key={k}>
                <path d={path(values[k])} fill="none" stroke={PLAYER_COLORS[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {values[k].map((v, i) => (
                  <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4} fill={PLAYER_COLORS[k]} stroke={SURFACE} strokeWidth={2} />
                ))}
                <text x={x(n - 1) + 8} y={y(values[k][n - 1]) + (values[0][n - 1] === values[1][n - 1] ? (k === 0 ? -3 : 9) : 3)} fontSize="10" fontWeight="700" fill="#eef2f0">
                  {values[k][n - 1]}
                </text>
              </g>
            ))}
            <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-1 rounded-lg border border-line bg-bg/95 px-2 py-1 text-[11px] shadow"
              style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > n / 2 ? 'translateX(-105%)' : 'translateX(8px)' }}
            >
              <div className="font-semibold text-ink2">{rounds[hover] === 0 ? 'Start' : `End of round ${rounds[hover]}`}</div>
              {[0, 1].map((k) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: PLAYER_COLORS[k] }} />
                  {names[k]}: <b>{values[k][hover]}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

