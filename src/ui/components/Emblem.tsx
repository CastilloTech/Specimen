import type { Faction, WorldFactionId } from '../../engine';

// Build / World Faction artwork: the symbol (a transparent emblem, for inline use next to a name) and the chip
// (the symbol mounted in a circuit chip, for pickers and headers). Cut from the provided art into
// src/assets/emblems and src/assets/chips (256px / 192px WebP with alpha).

export type IdentityId = Faction | WorldFactionId;

const EMBLEMS = import.meta.glob('../../assets/emblems/*.webp', { eager: true, import: 'default' }) as Record<string, string>;
const CHIPS = import.meta.glob('../../assets/chips/*.webp', { eager: true, import: 'default' }) as Record<string, string>;
const src = (map: Record<string, string>, dir: string, id: string) => map[`../../assets/${dir}/${id}.webp`];

/** The Build / World Faction symbol (decorative: always shown next to its name). Tech has none. */
export function Emblem({ id, size = 16, className = '' }: { id: IdentityId | 'tech' | string; size?: number; className?: string }) {
  const url = src(EMBLEMS, 'emblems', id);
  if (!url) return null;
  return <img src={url} alt="" aria-hidden width={size} height={size} draggable={false} className={`inline-block shrink-0 select-none object-contain ${className}`} style={{ width: size, height: size }} />;
}

/** The Build / World Faction chip. */
export function ChipArt({ id, size = 32, className = '' }: { id: IdentityId; size?: number; className?: string }) {
  const url = src(CHIPS, 'chips', id);
  if (!url) return null;
  return <img src={url} alt="" aria-hidden width={size} height={size} draggable={false} className={`inline-block shrink-0 select-none object-contain ${className}`} style={{ width: size, height: size }} />;
}
