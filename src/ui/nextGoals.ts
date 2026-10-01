import type { Faction, WorldFactionId } from '../engine';
import { masteryProgress } from './achievements';
import { FACTION_META, WORLD_FACTION_META } from './meta';
import { COSTS } from './modes';
import type { Progress } from './modes';
import { adaptStatus, DIFFICULTY } from './picks';
import type { MatchRecord } from './storage';
import { CHIPS, FACTIONS, WORLD_FACTIONS } from '../engine';

// After a match, the one or two things you are closest to: a reason to start the next one.

const nameOf = (f: Faction | WorldFactionId) => (FACTION_META as Record<string, { name: string }>)[f]?.name ?? WORLD_FACTION_META[f as WorldFactionId].name;

export function nextGoals(rs: MatchRecord[], p: Progress | null, played: { faction: Faction; worldFaction: WorldFactionId }, quick: boolean): string[] {
  const out: { text: string; closeness: number }[] = [];
  // Mastery of what you just played (the Mastery card is the reward).
  for (const f of [played.faction, played.worldFaction]) {
    const m = masteryProgress(rs, f);
    if (m.done >= m.total) continue;
    const n = m.next;
    out.push({ text: `${nameOf(f)} mastery ${m.done}/${m.total}${n ? ` · next: ${n.name}${n.need > 1 ? ` (${n.have}/${n.need})` : ''}` : ''}`, closeness: m.done || n?.have ? (m.done + (n ? n.have / n.need : 0)) / m.total : -1 }); // nothing started yet: last
  }
  // The cheapest thing biomass can still unlock in Game Modes.
  if (p) {
    const locked: { cost: number; what: string }[] = [
      ...FACTIONS.filter((f) => !p.builds.includes(f)).map((f) => ({ cost: COSTS.build, what: `the ${nameOf(f)} Build` })),
      ...WORLD_FACTIONS.filter((w) => !p.worlds.includes(w)).map((w) => ({ cost: COSTS.world, what: `${nameOf(w)}` })),
      ...CHIPS.filter((c) => p.worlds.includes(c.worldFaction) && !p.chips.includes(c.id)).map((c) => ({ cost: COSTS.chip, what: `the ${c.name} Chip` })),
    ].sort((a, b) => a.cost - b.cost);
    const t = locked[0];
    if (t) out.push(p.biomass >= t.cost ? { text: `You can unlock ${t.what} now (Game Modes)`, closeness: 1 } : { text: `${t.cost - p.biomass} biomass to unlock ${t.what}`, closeness: p.biomass / t.cost });
  }
  // Quick match stepping up.
  if (quick) {
    const a = adaptStatus();
    if (a.canStepUp && a.winRun > 0 && a.next) {
      const left = 3 - a.winRun;
      out.push({ text: `${left} more win${left === 1 ? '' : 's'} in a row to face a ${DIFFICULTY.find((d) => d.id === a.next)!.label} bot`, closeness: a.winRun / 3 });
    }
  }
  return out.sort((a, b) => b.closeness - a.closeness).slice(0, 2).map((g) => g.text);
}
