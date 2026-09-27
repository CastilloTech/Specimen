import { CARD_MAP, defaultConfig, FACTIONS, WORLD_FACTIONS } from '../engine';
import type { Faction, WorldFactionId } from '../engine';
import { STANCE_META } from './meta';
import type { MatchRecord } from './storage';

// A guide per Build / World Faction combination: the game plan (written), and what your own matches with that
// combo say (record, evolutions, and how each card you used actually did).

const C = defaultConfig;
const T = C.strain.threshold;
const OC = Math.floor(T * C.strain.stableMaxRatio) + 1;

export interface Plan {
  plan: string;
  do: string[];
  avoid: string[];
}

export const BUILD_GUIDE: Record<Faction, Plan> = {
  predator: {
    plan: `Race. Put high-attack grafts down early and live in Overclock (${OC}–${T} Strain) for bonus Clash damage; your Strain is fuel until ${T}.`,
    do: ['Aggress when they are likely to Adapt; Fortify (half damage and a vent) when you are close to the threshold before the Strain check.', 'Pick an evolution early and steer toward it: Apex Stalker from damage dealt, Frenzy Form from ending rounds at high Strain without rejecting.'],
    avoid: [`Ending a round above ${T} Strain: your highest-Strain graft is ejected.`, `Stalling: Meltdown adds Strain to both Specimens from round ${C.match.meltdownFromRound}, and you already run hot.`],
  },
  parasite: {
    plan: 'Win slowly. Toxins and statuses push the opponent’s Strain (Infect: every fresh status you give also adds Strain) until their grafts start rejecting.',
    do: ['Give statuses they do not already have: only a fresh one Infects.', 'Hive Host comes from pushing their Strain high; Leech Form from taking damage, so it doubles as your comeback form.'],
    avoid: ['Refreshing a status they already have when a different one would Infect.', 'Ignoring defense: you carry less armor than the other Builds.'],
  },
  bastion: {
    plan: 'Out-last. Stack armor, block, vent your own Strain and win the long game.',
    do: ['Fortify against Aggress: half damage and a Strain vent.', 'Carapace comes from venting Strain; Juggernaut from damage blocked, and it turns armor into attack.'],
    avoid: ['Being read: Adapt ignores armor, so vary your stances when they start Adapting.', 'Too little attack: an unbreakable Specimen that never hits only wins on HP.'],
  },
};

export const WORLD_GUIDE: Record<WorldFactionId, Plan> = {
  corrosion: {
    plan: `Chip Integrity and Bleed. Sabotages and Clash wear destroy grafts; Bleed stacks up to ${C.status.bleedMaxStacks} (${C.status.bleedDamage} damage per stack at each Strain check).`,
    do: ['Re-apply Bleed while it lasts to add a stack instead of starting over.', 'Aim integrity damage at their best graft; a destroyed graft also takes its Strain and stats with it.'],
    avoid: ['Bleeding right before they can Purge (Aegis and Hollow clear statuses).'],
  },
  aegis: {
    plan: 'Protect and repair. Integrity healing and Purge keep your board alive while theirs wears down.',
    do: ['Clash wears your toughest awake graft first: keep your key graft topped up.', 'Hold a Sabotage answer (Ward Pact) against Corrosion and Hollow.'],
    avoid: ['Spending turns repairing when you are far behind on HP: repair buys time, it does not win it back.'],
  },
  miasma: {
    plan: `Denial. Numb stops Protocols for ${C.status.numbRounds} rounds; Fever makes their grafts cost ${C.status.feverCostIncrease} more.`,
    do: ['Numb them before your big turn so nothing gets answered.', 'Fever them when they need to rebuild their board.'],
    avoid: ['Re-applying a status they already have (it only refreshes; Bleed is the one that stacks).'],
  },
  hollow: {
    plan: 'Board control. Necrosis empties a slot and locks it, Energy drain shrinks their turn, Purge cleans you.',
    do: ['Necrose the slot holding their best graft.', 'Round-start drains hit right away; drains from the Clash or Strain check come off their next round.'],
    avoid: ['Draining an opponent who has already spent their Energy this turn (mid-turn drains take only what is left).'],
  },
};

const COMBO_NOTE: Record<string, string> = {
  'predator/corrosion': 'Pure pressure: your big Clash hits also wear Integrity, and Bleed keeps ticking while you race. Bleed early so the stacks pay off.',
  'predator/aegis': 'Aggro with staying power: Aegis repairs the grafts that carry your attack, so your Overclock damage lasts. Keep your top attacker healthy.',
  'predator/miasma': 'Numb stops them answering your big turn and Fever slows their rebuild. Numb first, then commit your strongest graft.',
  'predator/hollow': 'Necrose their defensive slots and drain their Energy so they cannot armor up against your Overclock hits.',
  'parasite/corrosion': 'Status pile-up: every fresh Bleed also Infects. Alternate Bleed with other statuses to keep Infect firing.',
  'parasite/aegis': 'Slow and safe: you out-sustain while Toxins push their Strain. Leech Form arrives naturally if you absorb hits.',
  'parasite/miasma': 'The status engine: Numb and Fever are both fresh statuses that Infect. The most Strain pressure of any combo.',
  'parasite/hollow': 'Strain plus starvation: with drained Energy they struggle to vent or defend. Aim for Hive Host.',
  'bastion/corrosion': 'A grind: your armor holds while Bleed and integrity damage erode them. It is slower than it looks, so do not panic early.',
  'bastion/aegis': 'Fortress: armor plus repair. Very hard to kill; make sure you still build attack (Juggernaut helps).',
  'bastion/miasma': 'Stall and deny: Fever and Numb stop their comeback while your armor holds.',
  'bastion/hollow': 'Lockdown: necrose their attackers’ slots and drain their Energy; your armor covers the rest.',
};

export interface ComboKey {
  key: string;
  faction: Faction;
  worldFaction: WorldFactionId;
}
export const ALL_COMBOS: ComboKey[] = FACTIONS.flatMap((f) => WORLD_FACTIONS.map((w) => ({ key: `${f}/${w}`, faction: f, worldFaction: w })));
export const comboNote = (key: string) => COMBO_NOTE[key] ?? '';

export interface CardRow {
  id: string;
  played: number; // total plays
  games: number; // games you played it in
  winRate: number | null; // score in the games you played it (null under 2 games)
  inDeck: number; // games it was in your deck
  rejected: number;
  lost: number; // destroyed / severed / necrosed
  negated: number;
}

export interface ComboReport {
  games: number;
  rate: number;
  rounds: number;
  forms: { id: string; games: number; rate: number }[];
  noEvolution: number;
  vs: { faction: Faction; games: number; rate: number }[];
  cards: CardRow[]; // most played first
  unplayed: string[]; // in your latest deck for this combo, never played in any tracked game
  tracked: number; // games with card data
  tips: string[];
}

const score = (r: MatchRecord) => (r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const cardName = (id: string) => CARD_MAP[id]?.name ?? id;

export function comboReport(all: MatchRecord[], combo: ComboKey): ComboReport | null {
  const rs = all.filter((r) => r.me.faction === combo.faction && r.me.worldFaction === combo.worldFaction);
  if (!rs.length) return null;
  const rate = mean(rs.map(score));
  const formIds = [...new Set(rs.map((r) => r.me.evolution).filter((x): x is string => !!x))];
  const forms = formIds.map((id) => {
    const g = rs.filter((r) => r.me.evolution === id);
    return { id, games: g.length, rate: mean(g.map(score)) };
  });
  const vs = FACTIONS.map((f) => {
    const g = rs.filter((r) => r.opp.faction === f);
    return { faction: f, games: g.length, rate: mean(g.map(score)) };
  }).filter((x) => x.games > 0);

  const tracked = rs.filter((r) => r.me.cards);
  const rows = new Map<string, CardRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { id, played: 0, games: 0, winRate: null, inDeck: 0, rejected: 0, lost: 0, negated: 0 }));
    return r;
  };
  const scoresWhenPlayed = new Map<string, number[]>();
  for (const m of tracked) {
    for (const id of new Set(m.me.deck ?? [])) row(id).inDeck++;
    for (const [id, u] of Object.entries(m.me.cards ?? {})) {
      const r = row(id);
      r.played += u.played;
      r.rejected += u.rejected ?? 0;
      r.lost += u.lost ?? 0;
      r.negated += u.negated ?? 0;
      if (u.played > 0) {
        r.games++;
        scoresWhenPlayed.set(id, [...(scoresWhenPlayed.get(id) ?? []), score(m)]);
      }
    }
  }
  for (const r of rows.values()) {
    const sc = scoresWhenPlayed.get(r.id) ?? [];
    r.winRate = sc.length >= 2 ? mean(sc) : null;
  }
  const cards = [...rows.values()].filter((r) => r.played > 0 || r.rejected + r.lost > 0).sort((a, b) => b.played - a.played || b.games - a.games);
  const latestDeck = [...tracked].reverse().find((m) => m.me.deck)?.me.deck ?? [];
  const unplayed = [...new Set(latestDeck)].filter((id) => !(rows.get(id)?.played ?? 0) && (rows.get(id)?.inDeck ?? 0) >= 3);

  // Personal tips for this combo, most useful first.
  const tips: string[] = [];
  const n = rs.length;
  if (n < 3) tips.push(`Only ${n} match${n === 1 ? '' : 'es'} with this combo so far: play a few more for tips about your games and cards.`);
  const best = cards.filter((c) => c.winRate !== null && c.games >= 3).sort((a, b) => b.winRate! - a.winRate!)[0];
  if (best && best.winRate! >= rate + 0.1) tips.push(`${cardName(best.id)} is your best card here: you score ${pct(best.winRate!)} in the ${best.games} games you played it (${pct(rate)} overall with this combo). Keep it in the deck and look for it early.`);
  const worst = cards.filter((c) => c.winRate !== null && c.games >= 3).sort((a, b) => a.winRate! - b.winRate!)[0];
  if (worst && worst !== best && worst.winRate! <= rate - 0.15) tips.push(`${cardName(worst.id)} underperforms: ${pct(worst.winRate!)} in the ${worst.games} games you played it. Play it at a better moment, or swap it out in the deck builder.`);
  const fragile = cards.filter((c) => c.played >= 3 && (c.rejected + c.lost) / c.played >= 0.4).sort((a, b) => (b.rejected + b.lost) / b.played - (a.rejected + a.lost) / a.played)[0];
  if (fragile) {
    const why = fragile.rejected >= fragile.lost ? `rejected ${fragile.rejected} time(s): as your highest-Strain graft it is the one ejected, so vent before the Strain check` : `destroyed ${fragile.lost} time(s): protect it (armor, Fortify, Aegis repair) or play it after their Sabotage is spent`;
    tips.push(`${cardName(fragile.id)} rarely survives: out of ${fragile.played} plays it was ${why}.`);
  }
  const negatedMost = cards.filter((c) => c.negated >= 2).sort((a, b) => b.negated - a.negated)[0];
  if (negatedMost) tips.push(`${cardName(negatedMost.id)} was negated ${negatedMost.negated} times. Bait their Protocol with a cheaper play first, or play it when they are Numbed or short on Energy.`);
  if (unplayed.length) tips.push(`Never played across ${Math.min(...unplayed.map((id) => rows.get(id)!.inDeck))}+ games: ${unplayed.map(cardName).join(', ')}. Consider swapping them in the deck builder.`);
  const rejRate = rs.filter((r) => r.me.rejections > 0).length / n;
  if (n >= 3 && rejRate >= 0.3) tips.push(`You reject a graft in ${pct(rejRate)} of games with this combo. Watch the Strain meter before passing: Fortify, Hold or a Cycle vent keep you under ${T + 1}.`);
  const noEvo = rs.filter((r) => !r.me.evolution).length / n;
  if (n >= 3 && noEvo >= 0.3) tips.push(`You evolve in only ${pct(1 - noEvo)} of games. Tap the Evolve block during a match to see both conditions, and pick one to chase from round 1.`);
  const bestForm = forms.filter((f) => f.games >= 2).sort((a, b) => b.rate - a.rate)[0];
  const worstForm = forms.filter((f) => f.games >= 2).sort((a, b) => a.rate - b.rate)[0];
  if (bestForm && worstForm && bestForm.id !== worstForm.id && bestForm.rate - worstForm.rate >= 0.2) tips.push(`Your ${formName(bestForm.id)} games go much better (${pct(bestForm.rate)}) than your ${formName(worstForm.id)} ones (${pct(worstForm.rate)}): steer toward ${formName(bestForm.id)}.`);
  const hardest = vs.filter((v) => v.games >= 3).sort((a, b) => a.rate - b.rate)[0];
  if (hardest && hardest.rate < 0.45) tips.push(`Your hardest matchup with this combo is against ${cap(hardest.faction)} (${pct(hardest.rate)} over ${hardest.games}).`);
  const stances = rs.flatMap((r) => r.me.stances);
  if (stances.length >= 15) {
    const top = (['aggress', 'adapt', 'fortify'] as const).map((s) => ({ s, share: stances.filter((x) => x === s).length / stances.length })).sort((a, b) => b.share - a.share)[0];
    if (top.share >= 0.55) tips.push(`You pick ${STANCE_META[top.s].name} ${pct(top.share)} of the time with this combo, which the bot learns to counter. Mix it up.`);
  }
  return { games: n, rate, rounds: mean(rs.map((r) => r.rounds)), forms, noEvolution: noEvo, vs, cards, unplayed, tracked: tracked.length, tips };
}

const FORM_NAME: Record<string, string> = Object.fromEntries(Object.values(C.evolutions as Record<string, { id: string; name: string }[]>).flat().map((d) => [d.id, d.name]));
export const formName = (id: string) => FORM_NAME[id] ?? id;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
