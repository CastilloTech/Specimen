import { useId } from 'react';
import type { CardDef } from '../../engine';

// Procedural "specimen plate" art: every card gets a small illustration drawn from its type (and a graft's
// slot), tinted by its faction and shaped by a seed from its id, so no two cards look alike and no image
// assets are needed.

function seeded(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A smooth organic outline: a circle whose radius wobbles with a few lobes. */
function blob(cx: number, cy: number, rx: number, ry: number, rnd: () => number, lobes = 3, amp = 0.18): string {
  const n = 16;
  const phase = rnd() * Math.PI * 2;
  const pts = Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const k = 1 + amp * Math.sin(lobes * t + phase) + (rnd() - 0.5) * amp * 0.6;
    return [cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k];
  });
  let d = '';
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    d += i === 0 ? `M${((pts[n - 1][0] + x0) / 2).toFixed(1)},${((pts[n - 1][1] + y0) / 2).toFixed(1)} ` : '';
    d += `Q${x0.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)} `;
  }
  return d + 'Z';
}

function veins(cx: number, cy: number, r: number, rnd: () => number, count = 4): string {
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const len = r * (0.5 + rnd() * 0.5);
    const bend = (rnd() - 0.5) * r * 0.8;
    const x1 = cx + Math.cos(a) * len;
    const y1 = cy + Math.sin(a) * len;
    d += `M${cx.toFixed(1)},${cy.toFixed(1)} Q${(cx + Math.cos(a + 0.6) * len * 0.5 + bend * 0.2).toFixed(1)},${(cy + Math.sin(a + 0.6) * len * 0.5).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} `;
  }
  return d;
}

export function CardArt({ def, accent, className = '' }: { def: CardDef; accent: string; className?: string }) {
  const uid = useId().replace(/:/g, '');
  const rnd = seeded(def.id);
  const flesh = '#c65a4e';
  const dark = '#0a0f0d';
  const bg = `bg${uid}`;
  const tissue = `ti${uid}`;
  let art: React.ReactNode;

  if (def.type === 'graft') {
    const slot = def.slot ?? 'Organ';
    if (slot === 'Head') {
      const d = blob(50, 32, 22, 19, rnd, 2, 0.1);
      const ex = 42 + rnd() * 4;
      const ex2 = 57 + rnd() * 3;
      art = (
        <>
          <path d={d} fill={`url(#${tissue})`} stroke={accent} strokeWidth="1.2" />
          <path d={veins(50, 32, 18, rnd, 5)} stroke="#7a2f3a" strokeWidth="0.9" fill="none" opacity="0.8" />
          <ellipse cx={ex} cy="30" rx="6" ry="5" fill="#f4e6c8" stroke={dark} strokeWidth="0.8" />
          <circle cx={ex + 1} cy="30.5" r="2.6" fill={accent} />
          <circle cx={ex + 1} cy="30.5" r="1.1" fill={dark} />
          <ellipse cx={ex2} cy="31" rx="3.5" ry="3" fill="#f4e6c8" opacity="0.8" stroke={dark} strokeWidth="0.6" />
          <circle cx={ex2 + 0.6} cy="31" r="1.3" fill={dark} />
        </>
      );
    } else if (slot === 'Limb') {
      const tilt = -20 + rnd() * 40;
      art = (
        <g transform={`rotate(${tilt.toFixed(0)} 50 32)`}>
          <path d="M18,36 C30,26 48,24 62,28 C70,30 78,26 86,18 C84,28 78,36 66,38 C50,42 34,44 18,40 Z" fill={`url(#${tissue})`} stroke={accent} strokeWidth="1.2" />
          {[32, 44, 56].map((x) => (
            <path key={x} d={`M${x},${29 + (x - 32) * -0.05} q2,6 0,12`} stroke="#7a2f3a" strokeWidth="1" fill="none" opacity="0.8" />
          ))}
          <path d="M84,19 l8,-8 l-3,10 Z" fill="#e8dcc0" stroke={dark} strokeWidth="0.6" />
          <path d="M80,24 l9,-4 l-6,8 Z" fill="#e8dcc0" stroke={dark} strokeWidth="0.6" />
        </g>
      );
    } else if (slot === 'Nerve') {
      const branches = Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2 + rnd() * 0.5;
        const l = 16 + rnd() * 14;
        const mx = 50 + Math.cos(a) * l * 0.55 + (rnd() - 0.5) * 6;
        const my = 31 + Math.sin(a) * l * 0.45;
        return `M50,31 Q${mx.toFixed(1)},${my.toFixed(1)} ${(50 + Math.cos(a) * l).toFixed(1)},${(31 + Math.sin(a) * l * 0.75).toFixed(1)}`;
      }).join(' ');
      art = (
        <>
          <path d={branches} stroke={accent} strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.9" />
          <path d={branches} stroke="#fff" strokeWidth="0.4" fill="none" opacity="0.5" />
          <path d={blob(50, 31, 9, 8, rnd, 3, 0.15)} fill={`url(#${tissue})`} stroke={accent} strokeWidth="1.2" />
          <circle cx="50" cy="31" r="3" fill={accent} opacity="0.9" />
        </>
      );
    } else {
      art = (
        <>
          <path d={blob(50, 33, 21, 17, rnd, 2, 0.2)} fill={`url(#${tissue})`} stroke={accent} strokeWidth="1.2" />
          <path d={blob(44, 30, 8, 7, rnd, 3, 0.2)} fill="#9e3f3a" opacity="0.8" />
          <path d={blob(57, 36, 7, 6, rnd, 3, 0.2)} fill="#9e3f3a" opacity="0.7" />
          <path d={veins(50, 33, 22, rnd, 6)} stroke={accent} strokeWidth="0.8" fill="none" opacity="0.55" />
          <path d="M40,14 C42,8 48,6 50,12 M58,15 C60,9 66,9 66,14" stroke="#7a2f3a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      );
    }
  } else if (def.type === 'serum') {
    const level = 0.35 + rnd() * 0.4;
    const top = 14 + (1 - level) * 30;
    art = (
      <g transform={`rotate(${(-25 + rnd() * 10).toFixed(0)} 50 32)`}>
        <rect x="41" y="10" width="18" height="36" rx="4" fill="rgba(200,240,230,0.08)" stroke="#cfe7de" strokeWidth="1" />
        <rect x="42" y={top} width="16" height={45 - top} rx="3" fill={accent} opacity="0.75" />
        <circle cx="47" cy={top + 8} r="1.3" fill="#fff" opacity="0.7" />
        <circle cx="53" cy={top + 14} r="0.9" fill="#fff" opacity="0.6" />
        <rect x="44" y="6" width="12" height="5" rx="1" fill="#6b7a73" />
        <path d="M50,46 L50,58" stroke="#cfe7de" strokeWidth="1.2" />
      </g>
    );
  } else if (def.type === 'toxin') {
    const spores = Array.from({ length: 6 }, () => [20 + rnd() * 60, 12 + rnd() * 38, 3 + rnd() * 6] as const);
    art = (
      <>
        {spores.map(([x, y, r], i) => (
          <g key={i}>
            {Array.from({ length: 8 }, (_, k) => {
              const a = (k / 8) * Math.PI * 2;
              return <line key={k} x1={x} y1={y} x2={x + Math.cos(a) * r * 1.5} y2={y + Math.sin(a) * r * 1.5} stroke={accent} strokeWidth="0.6" opacity="0.7" />;
            })}
            <circle cx={x} cy={y} r={r} fill={accent} opacity={0.35 + (i % 3) * 0.2} stroke={accent} strokeWidth="0.8" />
            <circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.3} fill="#fff" opacity="0.35" />
          </g>
        ))}
      </>
    );
  } else if (def.type === 'protocol') {
    const nodes = Array.from({ length: 5 }, (_, i) => [16 + i * 17, 16 + rnd() * 30] as const);
    const path = nodes.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y.toFixed(1)}`).join(' ');
    art = (
      <>
        <path d={path} stroke={accent} strokeWidth="1.4" fill="none" strokeDasharray="3 2" />
        {nodes.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="5" fill={dark} stroke={accent} strokeWidth="1.2" />
            <circle cx={x} cy={y} r="2" fill={accent} />
          </g>
        ))}
        <path d="M52,6 L44,30 L52,30 L46,54 L62,24 L54,24 L60,6 Z" fill={accent} opacity="0.25" />
      </>
    );
  } else {
    art = (
      <>
        <path d="M14,44 C34,40 56,30 88,14" stroke="#7a2f3a" strokeWidth="2.2" fill="none" strokeDasharray="4 3" />
        {[30, 48, 66].map((x) => (
          <path key={x} d={`M${x},${44 - (x - 14) * 0.38} q1.5,4 0,6 q-1.5,-2 0,-6`} fill={flesh} />
        ))}
        <g transform={`rotate(${(-28 + rnd() * 8).toFixed(0)} 50 30)`}>
          <path d="M20,30 L62,26 C72,25 80,28 84,31 C74,33 66,34 62,34 L20,34 Z" fill="#dfe8e4" stroke={dark} strokeWidth="0.8" />
          <path d="M22,30.5 L60,27.5" stroke="#fff" strokeWidth="0.6" opacity="0.8" />
          <rect x="4" y="29" width="18" height="6" rx="2" fill={accent} />
        </g>
      </>
    );
  }

  return (
    <svg viewBox="0 0 100 60" className={className} aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id={bg} cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
          <stop offset="60%" stopColor={accent} stopOpacity="0.06" />
          <stop offset="100%" stopColor="#050807" stopOpacity="1" />
        </radialGradient>
        <radialGradient id={tissue} cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#f0a592" />
          <stop offset="55%" stopColor={flesh} />
          <stop offset="100%" stopColor="#5a1f24" />
        </radialGradient>
      </defs>
      <rect width="100" height="60" fill={`url(#${bg})`} />
      <circle cx="50" cy="31" r="27" fill="none" stroke={accent} strokeOpacity="0.18" strokeWidth="0.6" />
      <circle cx="50" cy="31" r="20" fill="none" stroke={accent} strokeOpacity="0.1" strokeWidth="0.5" strokeDasharray="1 2" />
      {art}
      {def.signature && <rect x="1" y="1" width="98" height="58" fill="none" stroke="#e6c35c" strokeWidth="1.2" strokeDasharray="6 2" />}
    </svg>
  );
}
