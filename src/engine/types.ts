import type configJson from '../data/config.json';

export type Config = typeof configJson;
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type PlayerId = 0 | 1;
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export type Faction = 'predator' | 'parasite' | 'bastion';
export const FACTIONS: Faction[] = ['predator', 'parasite', 'bastion'];
/** The second, orthogonal build axis: a World Faction defines a card pool built around Integrity and the
 * five status effects (never Strain, which is the Build's own domain) plus three selectable Chips. */
export type WorldFactionId = 'corrosion' | 'aegis' | 'miasma' | 'hollow';
export const WORLD_FACTIONS: WorldFactionId[] = ['corrosion', 'aegis', 'miasma', 'hollow'];
export type Stance = 'aggress' | 'adapt' | 'fortify';
export const STANCES: Stance[] = ['aggress', 'adapt', 'fortify'];
export type SlotId = 'head' | 'limbA' | 'limbB' | 'organ' | 'organB' | 'nerve';
export type SlotType = 'Head' | 'Limb' | 'Organ' | 'Nerve';
export type CardType = 'graft' | 'serum' | 'protocol' | 'toxin' | 'sabotage';
export type Zone = 'stable' | 'overclocked' | 'rejection';
export type PlayKind = 'graft' | 'serum' | 'toxin' | 'sabotage';

// ---------- Card data ----------
export type Cond = {
  zone?: Zone;
  stance?: Stance;
  strainAtLeast?: number;
  strainAtMost?: number;
  oppStrainAtLeast?: number;
  hpAtMost?: number;
  minRound?: number;
  /** Only true once the player has evolved into this specific form id. */
  evolution?: string;
  /** True while the opponent/self has any of the four status effects (Bleed/Necrosis/Numb/Fever) active. */
  oppHasAnyStatus?: boolean;
  selfHasAnyStatus?: boolean;
  /** The opponent has at least this many different statuses (Bleed, Numb, Fever, Necrosis). */
  oppStatusesAtLeast?: number;
  /** The opponent has at most this much Energy left (checked when the ability fires). */
  oppEnergyAtMost?: number;
  /** The opponent currently has this status. */
  oppHas?: 'bleed' | 'numb' | 'fever';
  /** You control at least this many awake grafts. */
  graftsAtLeast?: number;
  /** Your discard pile holds at least this many cards. */
  discardAtLeast?: number;
};

/** A round-timed debuff on the player rather than a specific graft: see PlayerState. */
export type StatusKind = 'bleed' | 'numb' | 'fever';

export type Op =
  | { op: 'heal'; amount: number }
  | { op: 'damage'; who?: 'self' | 'opp'; amount: number }
  | { op: 'strain'; who?: 'self' | 'opp'; amount: number }
  | { op: 'vent'; amount: number }
  | { op: 'draw'; amount: number }
  | { op: 'discard'; who?: 'self' | 'opp'; amount: number }
  | { op: 'energy'; amount: number }
  | { op: 'drain'; amount: number }
  | { op: 'buff'; stat: 'attack' | 'armor'; who?: 'self' | 'opp'; amount: number }
  | { op: 'sabotage'; mode: 'sever' | 'poison' | 'disable' | 'necrosis'; rounds?: number; pick?: 'chosen' | 'random' | 'best' }
  | { op: 'reveal' }
  | { op: 'negate' }
  | { op: 'reflect' }
  | { op: 'mod'; stat: 'attack' | 'armor'; amount: number; per?: { what: 'grafts' | 'strain' | 'oppStrain' | 'missingHp' | 'oppBleedStacks' | 'oppNecroticSlots' | 'seasonedGrafts' | 'oppWornGrafts' | 'myDiscard'; div: number } }
  | { op: 'graftDamage'; amount: number }
  | { op: 'status'; kind: StatusKind; who?: 'self' | 'opp'; rounds?: number }
  | { op: 'purge'; who?: 'self' | 'opp' }
  | { op: 'integrityHeal'; amount: number };

export type Trigger =
  | 'passive'
  | 'onAttach'
  | 'onRoundStart'
  | 'onStrainCheck'
  | 'onDealDamage'
  | 'onTakeDamage'
  | 'onReject'
  // Engine events: they can fire several times a round, so engine abilities carry a per-round cap.
  | 'onGainStrain'
  | 'onOppGainStrain'
  | 'onVent'
  | 'onDrain'
  | 'onRepair'
  // Wave 2 engine events.
  | 'onKill' // you destroy an enemy graft (Integrity, Sever, Necrosis)
  | 'onOppReject' // the opponent rejects a graft at the Strain check
  | 'onBlock' // your armor stops at least engines.blockThreshold Clash damage
  | 'onWear' // an enemy graft loses Integrity to one of your cards or abilities (not Clash wear)
  | 'onPurge' // you Purge yourself
  // Wave 3 engine events.
  | 'onBigHit' // your Clash hit deals at least engines.bigHitThreshold damage
  | 'onAttachGraft' // you attach a graft (face-up or face-down)
  | 'onOppFeverGraft' // the opponent attaches a graft while they have Fever
  | 'onProtocol'; // you play a Protocol

export type Ability = {
  trigger: Trigger;
  cond?: Cond;
  ops: Op[];
  /** Fires at most this many times per round (engine payoffs). */
  perRound?: number;
};

/** A synergy engine: enabler cards make its event happen, payoff cards cash in on it. */
export type EngineId =
  | 'frenzy'
  | 'feed'
  | 'pressure'
  | 'hemorrhage'
  | 'doubleDose'
  | 'starvation'
  | 'renewal'
  | 'carrion'
  | 'overload'
  | 'fortress'
  | 'dissolve'
  | 'silence'
  | 'necropolis'
  | 'cleanse'
  | 'overkill'
  | 'brood'
  | 'endurance'
  | 'rust'
  | 'feverBurn'
  | 'grave'
  | 'ward';
export interface EngineTag {
  id: EngineId;
  role: 'enabler' | 'payoff';
}

export interface CardEffect {
  ops?: Op[];
  abilities?: Ability[];
  reactsTo?: (PlayKind | 'any')[];
  target?: 'enemySlot';
}

export interface CardDef {
  id: string;
  name: string;
  faction: Faction | 'tech' | WorldFactionId;
  type: CardType;
  cost: number;
  strain: number;
  slot?: SlotType;
  attack: number;
  armor: number;
  /** Grafts only: a small HP pool of its own (roughly 2-4), chipped by `graftDamage` ops. A graft with
   * integrity reduced to 0 is destroyed, independent of the Specimen's own Strain/rejection. */
  integrity?: number;
  text: string;
  signature: boolean;
  /** A Mastery Signature: locked until every Faction achievement of its Build / World Faction is done (UI-side unlock). */
  mastery?: boolean;
  /** The synergy engines this card belongs to (shown as keywords; bots and auto-fill keep engines together). */
  engines?: EngineTag[];
  effect: CardEffect;
  budgetNote: string;
}

export interface TreeNode {
  id: string;
  name: string;
  text: string;
  params: Record<string, number | string | boolean>;
  /** Gates every param on this node: with no cond it's always active, matching the old flat-sum behavior. */
  cond?: Cond;
}

export interface TreeRow {
  id: string;
  name: string;
  nodes: TreeNode[];
}

/** A loadout item: pick one Chip from your chosen World Faction before a match. Its tree is the *only*
 * source of skill nodes in the game now - Builds carry no tree of their own. */
export interface ChipDef {
  id: string;
  name: string;
  text: string;
  worldFaction: WorldFactionId;
  tree: TreeRow[]; // exactly 2 rows of exactly 2 nodes each
}

export interface EvolutionDef {
  id: string;
  name: string;
  text: string;
  condition: { metric: string; target: number; label: string };
  effects: Record<string, number | boolean>;
}

// ---------- Game state ----------
export interface CardInstance {
  uid: string;
  cardId: string;
}

/** How a card ended up in the discard pile. */
export type DiscardReason =
  | 'played' // a spent Serum / Toxin / Sabotage / Protocol
  | 'negated'
  | 'noRoom' // a graft with nowhere to go
  | 'replaced' // a graft overwritten by a new one in its slot
  | 'cycled'
  | 'burned' // drawn into a full hand
  | 'discarded' // a random discard effect
  | 'rejected' // ejected at the Strain check
  | 'destroyed' // Integrity reached 0
  | 'severed'
  | 'necrosed';

export interface DiscardEntry extends CardInstance {
  why: DiscardReason;
  /** For a graft that left the board: the slot it was in. */
  slot?: SlotId;
  round: number;
  /** What caused it, when something did (a card name, "Clash wear"). */
  by?: string;
}

export interface AttachedGraft {
  uid: string;
  cardId: string;
  slot: SlotId;
  strain: number;
  seq: number;
  faceDown: boolean;
  poisoned: number; // rounds remaining
  disabled: number; // rounds remaining
  /** Strain a face-down graft saved by sleeping; it is added when the graft wakes. */
  dormantStrain?: number;
  /** The round it was attached, so a graft that has slept through a round can ambush when woken. */
  sleptSince?: number;
  /** Strain checks this graft has survived unrejected. Only Signature grafts turn this into a stat bonus
   * (see `veterancy` in config), so it is tracked for every graft but only spent by the ones that use it. */
  roundsSurvived: number;
  /** Current integrity (its own small HP pool). Reaching 0 destroys the graft. */
  integrity: number;
  /** Engine abilities fired this round, by ability index (for their per-round caps). Reset each round. */
  fired?: Record<number, number>;
}

export interface PlayerStats {
  damageDealt: number;
  damageTaken: number;
  damageBlocked: number;
  strainVented: number;
  rejectionsSuffered: number;
  maxStrain: number;
  graftsPlayed: number;
  cardsPlayed: number;
  hpHealed: number;
  /** Numb / Fever you put on the opponent (applications, refreshes included). */
  numbDealt: number;
  feverDealt: number;
  /** Enemy slots you necrosed. */
  necrosisDealt: number;
  /** Energy the opponent actually lost to your drains (including carried-over drains paid next round). */
  energyDrained: number;
  /** Engine payoff abilities that fired (see Ability.perRound). */
  engineFires: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  faction: Faction;
  worldFaction: WorldFactionId;
  chip: string;
  isBot: boolean;
  loadout: string[];
  hp: number;
  strain: number;
  energy: number;
  bank: number;
  /** Energy drained after this round's actions ended (Clash, Strain check): taken from next round's refill. */
  energyDebt: number;
  deck: CardInstance[];
  hand: CardInstance[];
  /** Newest last. A cycled card stays private to its owner (see publicDiscard). */
  discard: DiscardEntry[];
  slots: SlotId[];
  grafts: AttachedGraft[];
  stance: Stance | null;
  stanceHistory: Stance[];
  hold: boolean;
  cycledThisRound: number;
  attachedThisRound: number;
  attachedLastRound: boolean;
  rejectedThisRound: boolean;
  mulliganDecided: boolean;
  mulliganUsed: boolean;
  feintUsed: boolean;
  valveUsed: boolean;
  firstGraftDone: boolean;
  tempAttack: number;
  tempArmor: number;
  evolution: string | null;
  evolutionOptions: string[];
  /** Bot tier for a bot player (see PlayerSetup.ai). */
  ai: BotTier;
  /** See PlayerSetup.ventMalus. */
  ventMalus: number;
  /** This Specimen's max HP (config.specimen.hp unless Lineage scars lowered it). */
  maxHp: number;
  /** Lineage mutations: work like extra Chip nodes (see sumLoadoutParam). */
  mutations: string[];
  stats: PlayerStats;
  /** Rounds remaining of a bleed-out. */
  bleed: number;
  /** Bleed intensity: each tick deals bleedDamage x stacks. Re-applying Bleed adds a stack (up to
   * config.status.bleedMaxStacks) and refreshes the duration; stacks clear when Bleed ends or is purged. */
  bleedStacks: number;
  /** Rounds remaining during which this player's Protocols cannot be played. */
  numb: number;
  /** Rounds remaining during which this player's grafts cost 1 more Energy. */
  fever: number;
  /** Slots that cannot be refilled yet, each with the rounds remaining before they heal over. */
  necrosis: Partial<Record<SlotId, number>>;
}

export interface PendingPlay {
  player: PlayerId;
  card: CardInstance;
  slot?: SlotId;
  target?: SlotId;
  faceDown?: boolean;
  negated: boolean;
  reflected: boolean;
  /** Set only when this is a Protocol played via REACT: the play (or earlier Protocol) it answers, so its
   * own ops (negate, reflect, a target-slot lookup) act on the thing being answered, not on itself. */
  against?: PendingPlay;
}

export interface ReactionWindow {
  reactor: PlayerId;
  play: PendingPlay;
}

export type LogKind = 'round' | 'stance' | 'play' | 'damage' | 'strain' | 'reject' | 'evolve' | 'heal' | 'end' | 'info' | 'hit' | 'wear';

export interface LogEntry {
  n: number;
  round: number;
  kind: LogKind;
  player: PlayerId | null;
  text: string;
  amount?: number;
}

/**
 * A card the players can see being played. `cardId` is the truth; use publicPlay() (view.ts) to get the
 * version a given viewer is allowed to see. Cycled cards are never recorded by name (the discard stays private).
 */
export interface PlayRecord {
  n: number;
  round: number;
  player: PlayerId;
  kind: 'play' | 'react' | 'cycle' | 'valve';
  uid: string;
  cardId?: string;
  /** A Dormant graft played face-down: hidden from the opponent until it is revealed. */
  faceDown?: boolean;
  slot?: SlotId;
  target?: SlotId;
  negated?: boolean;
  /** A Protocol turned this play back on its caster. */
  reflected?: boolean;
  /** For a Protocol ('react'): the uid of the play it answered (look it up in `plays`). */
  against?: string;
}

export interface RoundSnapshot {
  round: number;
  hp: [number, number];
  strain: [number, number];
}

export interface MatchResult {
  winner: PlayerId | null;
  reason: string;
}

export type Phase = 'mulligan' | 'stance' | 'feint' | 'actions' | 'evolve' | 'over';

export interface GameState {
  config: Config;
  seed: number;
  rng: number;
  round: number;
  phase: Phase;
  players: [PlayerState, PlayerState];
  stanceResult: { winner: PlayerId | null } | null;
  initiative: PlayerId;
  lastInitiative: PlayerId;
  turn: PlayerId;
  passStreak: number;
  actionCount: number;
  window: ReactionWindow | null;
  /** LIFO chain of not-yet-resolved plays: index 0 is the original play, later entries are Protocols
   * reacting to the one below them. The top (last) entry is always what `window` currently asks about. */
  stack: PendingPlay[];
  feintQueue: PlayerId[];
  evoQueue: PlayerId[];
  result: MatchResult | null;
  log: LogEntry[];
  history: Action[];
  plays: PlayRecord[];
  snapshots: RoundSnapshot[];
  lastError: string | null;
  uidCounter: number;
  graftSeq: number;
  /** True from the end of the actions phase until the next round's Energy refill, so drains that land
   * then (Clash, Strain check, rejection triggers) carry over to next round instead of vanishing. */
  actionsClosed: boolean;
}

// ---------- Setup ----------
export interface PlayerSetup {
  name: string;
  faction: Faction;
  worldFaction: WorldFactionId;
  chip: string;
  deck: string[];
  loadout: string[];
  isBot?: boolean;
  /** Bot tier (Game Modes): 'basic' heuristic (default), 'reader' (reads stance history, plays around Toxins,
   * bluffs with face-down grafts) or 'search' (Monte Carlo tree search). */
  ai?: BotTier;
  /** Starts the match already evolved into this form (a Tower rule twist). */
  startEvolution?: string;
  /** Every vent this player makes is this much smaller, never below 1 (a Tower rule twist). */
  ventMalus?: number;
  /** Skip the deck-building rules for this player (the Tower's final boss uses every pool). */
  unrestricted?: boolean;
  /** Lineage scars and mutations: a lower max HP, graft slots that are gone, permanent mutations. */
  maxHp?: number;
  lostSlots?: SlotId[];
  mutations?: string[];
  /** Containment Breach carry-over: start the match on this HP (≤ max HP) and with this much Strain. */
  startHp?: number;
  startStrain?: number;
  /** Grafts already attached at the start (face-up, in the first free matching slot), adding their Strain. */
  startGrafts?: string[];
  /** Deal the deck in the given order, first card on top, with no shuffle (the tutorial match). A
   * mulligan still reshuffles. */
  stackedDeck?: boolean;
}

export type BotTier = 'basic' | 'reader' | 'search';

export interface MatchSetup {
  seed: number;
  players: [PlayerSetup, PlayerSetup];
  config?: DeepPartial<Config>;
}

// ---------- Actions ----------
export type Action =
  | { type: 'MULLIGAN'; player: PlayerId; mulligan: boolean }
  | { type: 'PICK_STANCE'; player: PlayerId; stance: Stance }
  | { type: 'AUTO_STANCE'; player: PlayerId }
  | { type: 'FEINT'; player: PlayerId; stance: Stance | null }
  | { type: 'PLAY_CARD'; player: PlayerId; uid: string; slot?: SlotId; target?: SlotId; faceDown?: boolean }
  | { type: 'CYCLE'; player: PlayerId; uid: string; mode: 'vent' | 'draw' }
  | { type: 'REVEAL'; player: PlayerId; slot: SlotId }
  | { type: 'HOLD'; player: PlayerId }
  | { type: 'PASS'; player: PlayerId }
  | { type: 'REACT'; player: PlayerId; uid?: string; ability?: 'pressureValve' }
  | { type: 'DECLINE_REACTION'; player: PlayerId }
  | { type: 'CHOOSE_EVOLUTION'; player: PlayerId; id: string | null };
