import type { CSSProperties } from 'react';
import energyArt from '../../assets/energy.webp';

/** Energy: its round emblem, inline beside a number. */
export function EnergyIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <img src={energyArt} alt="" aria-hidden draggable={false} className={`inline-block shrink-0 select-none rounded-full align-[-3px] ${className}`} />;
}

/** Background for a round cost badge: the emblem behind the number (the number keeps a dark outline to stay legible). */
export const ENERGY_BADGE: CSSProperties = { backgroundImage: `url(${energyArt})`, backgroundSize: 'cover', backgroundPosition: 'center', textShadow: '0 0 3px #000, 0 0 2px #000, 0 1px 1px #000' };
