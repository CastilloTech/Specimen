import { defaultConfig } from '../engine';
import type { CardType, Faction, Stance, WorldFactionId } from '../engine';

export const FACTION_META: Record<Faction, { name: string; color: string; tagline: string }> = {
  predator: { name: 'Predator', color: '#e0563a', tagline: 'Aggro. High Strain, high attack. Lives in Overclock.' },
  parasite: { name: 'Parasite', color: '#b06be0', tagline: 'Toxins, Sabotage and disruption.' },
  bastion: { name: 'Bastion', color: '#4aa3c8', tagline: 'Armor grafts, venting and defense.' },
};

/** The second, orthogonal build axis: a card pool and Chip tree built around Integrity and statuses. */
export const WORLD_FACTION_META: Record<WorldFactionId, { name: string; color: string; tagline: string }> = {
  corrosion: { name: 'Corrosion', color: '#8fbf4a', tagline: 'Aggressive integrity damage and Bleed.' },
  aegis: { name: 'Aegis', color: '#c9c9c9', tagline: 'Integrity protection and regeneration.' },
  miasma: { name: 'Miasma', color: '#7a6bd6', tagline: 'Numb and Fever: battlefield denial.' },
  hollow: { name: 'Hollow', color: '#5a5a6a', tagline: 'Necrosis and Purge: board control.' },
};

export const STANCE_META: Record<Stance, { name: string; glyph: string; beats: string; text: string }> = {
  aggress: { name: 'Aggress', glyph: '⚔', beats: 'Adapt', text: `Beats Adapt: +${defaultConfig.stances.aggressBeatsAdaptBonus} damage.` },
  adapt: { name: 'Adapt', glyph: '◈', beats: 'Fortify', text: 'Beats Fortify: attack ignores armor.' },
  fortify: { name: 'Fortify', glyph: '⛨', beats: 'Aggress', text: `Beats Aggress: half damage${defaultConfig.stances.fortifyCounterDamage > 0 ? `, then ${defaultConfig.stances.fortifyCounterDamage} counter` : ''}. Vents ${defaultConfig.strain.fortifyVent} Strain.` },
};

export const TYPE_META: Record<CardType, { label: string; color: string }> = {
  graft: { label: 'Graft', color: '#5aa86f' },
  serum: { label: 'Serum', color: '#4a9fd8' },
  protocol: { label: 'Protocol', color: '#c9a227' },
  toxin: { label: 'Toxin', color: '#a86bd6' },
  sabotage: { label: 'Sabotage', color: '#d65a5a' },
};

/** Player identity colors (validated categorical slots 1 and 2, dark surface). */
export const PLAYER_COLORS = ['#3987e5', '#d95926'] as const;
