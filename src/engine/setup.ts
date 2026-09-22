import { CARD_MAP, defaultConfig, mergeConfig, treeRows } from './data';
import { nextInt, shuffleInPlace } from './rng';
import { slotsFor } from './stats';
import type { Config, Faction, GameState, MatchSetup, PlayerId, PlayerSetup, PlayerState } from './types';
import { FACTIONS } from './types';

export function validateDeck(faction: Faction, deck: string[], config: Config = defaultConfig): string[] {
  const errors: string[] = [];
  const d = config.deck;
  if (!FACTIONS.includes(faction)) errors.push(`Unknown faction "${faction}".`);
  if (deck.length !== d.size) errors.push(`Deck must have exactly ${d.size} cards (has ${deck.length}).`);
  const counts: Record<string, number> = {};
  let fac = 0;
  let tech = 0;
  for (const id of deck) {
    const c = CARD_MAP[id];
    if (!c) {
      errors.push(`Unknown card "${id}".`);
      continue;
    }
    counts[id] = (counts[id] ?? 0) + 1;
    if (c.faction === 'tech') tech++;
    else if (c.faction === faction) fac++;
    else errors.push(`${c.name} belongs to ${c.faction}, not ${faction}.`);
  }
  if (fac < d.minFaction) errors.push(`Need at least ${d.minFaction} ${faction} cards (has ${fac}).`);
  if (tech > d.maxTech) errors.push(`At most ${d.maxTech} tech cards allowed (has ${tech}).`);
  for (const [id, n] of Object.entries(counts)) {
    const c = CARD_MAP[id];
    const max = c.signature ? d.signatureCopies : d.maxCopies;
    if (n > max) errors.push(`${c.name}: at most ${max} cop${max === 1 ? 'y' : 'ies'} allowed (has ${n}).`);
  }
  return errors;
}

export function validateLoadout(faction: Faction, loadout: string[]): string[] {
  const errors: string[] = [];
  const rows = treeRows(faction);
  if (loadout.length !== rows.length) errors.push(`Loadout needs exactly ${rows.length} nodes (one per row).`);
  for (const row of rows) {
    const picked = loadout.filter((id) => row.nodes.some((n) => n.id === id));
    if (picked.length === 0) errors.push(`Pick a node in the ${row.name} row.`);
    else if (picked.length > 1) errors.push(`Pick only one node in the ${row.name} row.`);
  }
  const known = new Set(rows.flatMap((r) => r.nodes.map((n) => n.id)));
  for (const id of loadout) if (!known.has(id)) errors.push(`Node "${id}" is not available to ${faction}.`);
  return errors;
}

function makePlayer(id: PlayerId, setup: PlayerSetup, config: Config): PlayerState {
  return {
    id,
    name: setup.name,
    faction: setup.faction,
    isBot: !!setup.isBot,
    loadout: [...setup.loadout],
    hp: config.specimen.hp,
    strain: 0,
    energy: 0,
    bank: 0,
    deck: [],
    hand: [],
    discard: [],
    slots: slotsFor(config, setup.loadout),
    grafts: [],
    stance: null,
    stanceHistory: [],
    hold: false,
    cycledThisRound: 0,
    attachedThisRound: 0,
    attachedLastRound: false,
    rejectedThisRound: false,
    mulliganDecided: false,
    mulliganUsed: false,
    feintUsed: false,
    valveUsed: false,
    firstGraftDone: false,
    tempAttack: 0,
    tempArmor: 0,
    evolution: null,
    evolutionOptions: [],
    stats: { damageDealt: 0, damageTaken: 0, damageBlocked: 0, strainVented: 0, rejectionsSuffered: 0, maxStrain: 0, graftsPlayed: 0, cardsPlayed: 0 },
  };
}

export function createMatch(setup: MatchSetup): GameState {
  const config = mergeConfig(defaultConfig, setup.config);
  const errors: string[] = [];
  setup.players.forEach((p, i) => {
    errors.push(...validateDeck(p.faction, p.deck, config).map((e) => `Player ${i + 1}: ${e}`));
    errors.push(...validateLoadout(p.faction, p.loadout).map((e) => `Player ${i + 1}: ${e}`));
  });
  if (errors.length) throw new Error(errors.join(' '));
  const s: GameState = {
    config,
    seed: setup.seed,
    rng: setup.seed | 0,
    round: 0,
    phase: 'mulligan',
    players: [makePlayer(0, setup.players[0], config), makePlayer(1, setup.players[1], config)],
    stanceResult: null,
    initiative: 0,
    lastInitiative: 0,
    turn: 0,
    passStreak: 0,
    actionCount: 0,
    window: null,
    feintQueue: [],
    evoQueue: [],
    result: null,
    log: [],
    history: [],
    plays: [],
    snapshots: [],
    lastError: null,
    uidCounter: 0,
    graftSeq: 0,
  };
  for (const pl of s.players) {
    pl.deck = setup.players[pl.id].deck.map((cardId) => ({ uid: `${pl.id}:${s.uidCounter++}`, cardId }));
    shuffleInPlace(s, pl.deck);
    for (let i = 0; i < config.match.startingHand; i++) pl.hand.push(pl.deck.pop()!);
  }
  s.lastInitiative = nextInt(s, 2) as PlayerId;
  s.snapshots.push({ round: 0, hp: [config.specimen.hp, config.specimen.hp], strain: [0, 0] });
  s.log.push({ n: 0, round: 0, kind: 'info', player: null, text: `Match start. ${s.players[0].name} (${s.players[0].faction}) vs ${s.players[1].name} (${s.players[1].faction}). Seed ${setup.seed}.` });
  return s;
}
