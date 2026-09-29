import { defaultConfig } from '../engine';
import type { CardType, EngineId, Faction, Stance, WorldFactionId } from '../engine';

export const FACTION_META: Record<Faction, { name: string; color: string; tagline: string }> = {
  predator: { name: 'Predator', color: '#e0563a', tagline: 'Aggro. High Strain, high attack. Lives in Overclock.' },
  parasite: { name: 'Parasite', color: '#b06be0', tagline: 'Toxins and disruption. Infect: fresh statuses you inflict add Strain.' },
  bastion: { name: 'Bastion', color: '#4aa3c8', tagline: 'Armor grafts, venting and defense.' },
};

/** The second, orthogonal build axis: a card pool and Chip tree built around Integrity and statuses. */
export const WORLD_FACTION_META: Record<WorldFactionId, { name: string; color: string; tagline: string }> = {
  corrosion: { name: 'Corrosion', color: '#8fbf4a', tagline: 'Aggressive integrity damage and Bleed.' },
  aegis: { name: 'Aegis', color: '#c9c9c9', tagline: 'Integrity protection and regeneration.' },
  miasma: { name: 'Miasma', color: '#7a6bd6', tagline: 'Numb and Fever: battlefield denial.' },
  hollow: { name: 'Hollow', color: '#a79cc0', tagline: 'Necrosis and Purge: board control.' },
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

/** Synergy engines: the keyword shown on each engine card, what it runs on, and its colour. */
export const ENGINE_META: Record<EngineId, { name: string; owner: Faction | WorldFactionId; text: string }> = {
  frenzy: { name: 'Frenzy', owner: 'predator', text: 'Payoffs fire whenever you gain Strain (some only while Overclocked). Enablers add Strain to you.' },
  feed: { name: 'Feed', owner: 'parasite', text: 'Payoffs fire whenever the opponent gains Strain. Enablers push Strain onto them.' },
  pressure: { name: 'Pressure', owner: 'bastion', text: 'Payoffs fire whenever you vent Strain. Enablers vent: Fortify, Hold, venting cards.' },
  hemorrhage: { name: 'Hemorrhage', owner: 'corrosion', text: 'Payoffs grow with the Bleed stacks on the opponent. Enablers make them bleed.' },
  doubleDose: { name: 'Double dose', owner: 'miasma', text: 'Payoffs switch on while the opponent has 2 or more statuses. Enablers inflict Fever, Numb and Bleed.' },
  starvation: { name: 'Starvation', owner: 'hollow', text: "Payoffs fire whenever you drain the opponent's Energy. Enablers drain it." },
  renewal: { name: 'Renewal', owner: 'aegis', text: 'Payoffs fire whenever you repair a graft\'s Integrity. Enablers repair.' },
  carrion: { name: 'Carrion', owner: 'predator', text: 'Payoffs fire whenever you destroy an enemy graft. Enablers wear grafts down: Integrity damage, Sabotage.' },
  overload: { name: 'Overload', owner: 'parasite', text: 'Payoffs fire whenever the opponent rejects a graft. Enablers push their Strain past the limit.' },
  fortress: { name: 'Fortress', owner: 'bastion', text: 'Payoffs fire when your armor stops 3 or more damage in a Clash. Enablers pile on armor.' },
  dissolve: { name: 'Dissolve', owner: 'corrosion', text: 'Payoffs fire whenever one of your cards or abilities takes Integrity off an enemy graft (Clash wear does not count).' },
  silence: { name: 'Silence', owner: 'miasma', text: 'Payoffs switch on while the opponent is Numbed. Enablers numb them.' },
  necropolis: { name: 'Necropolis', owner: 'hollow', text: 'Payoffs grow with each enemy slot locked by Necrosis. Enablers necrose grafts.' },
  cleanse: { name: 'Cleanse', owner: 'aegis', text: 'Payoffs fire whenever you Purge yourself. Enablers Purge.' },
  overkill: { name: 'Overkill', owner: 'predator', text: 'Payoffs fire when your Clash hit deals 8 or more damage. Enablers pump your attack.' },
  brood: { name: 'Brood', owner: 'parasite', text: 'Payoffs fire whenever you attach a graft, or grow with how many you have. Enablers are cheap grafts.' },
  endurance: { name: 'Endurance', owner: 'bastion', text: 'Payoffs grow with grafts that have survived 2 or more Strain checks. Enablers are sturdy, low-Strain grafts.' },
  rust: { name: 'Rust', owner: 'corrosion', text: 'Payoffs grow with each enemy graft below full Integrity. Enablers wear their grafts down.' },
  feverBurn: { name: 'Fever burn', owner: 'miasma', text: 'Payoffs fire whenever the opponent attaches a graft while they have Fever. Enablers give them Fever.' },
  grave: { name: 'Grave', owner: 'hollow', text: 'Payoffs grow with the cards in your discard pile. Enablers fill it: cheap spells, discarding your own cards.' },
  ward: { name: 'Ward', owner: 'aegis', text: 'Payoffs fire whenever you play a Protocol. Enablers are Protocols.' },
};
export const engineColor = (id: EngineId) => {
  const o = ENGINE_META[id].owner;
  return (FACTION_META as Record<string, { color: string }>)[o]?.color ?? (WORLD_FACTION_META as Record<string, { color: string }>)[o].color;
};
