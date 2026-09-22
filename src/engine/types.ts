import type configJson from '../data/config.json';

export type Config = typeof configJson;
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type PlayerId = 0 | 1;
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export type Faction = 'predator' | 'parasite' | 'bastion';
export const FACTIONS: Faction[] = ['predator', 'parasite', 'bastion'];
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
};

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
  | { op: 'sabotage'; mode: 'sever' | 'poison' | 'disable'; rounds?: number; pick?: 'chosen' | 'random' | 'best' }
  | { op: 'reveal' }
  | { op: 'negate' }
  | { op: 'reflect' }
  | { op: 'mod'; stat: 'attack' | 'armor'; amount: number; per?: { what: 'grafts' | 'strain' | 'oppStrain' | 'missingHp'; div: number } };

export type Trigger = 'passive' | 'onAttach' | 'onRoundStart' | 'onStrainCheck' | 'onDealDamage' | 'onTakeDamage' | 'onReject';

export type Ability = { trigger: Trigger; cond?: Cond; ops: Op[] };

export interface CardEffect {
  ops?: Op[];
  abilities?: Ability[];
  reactsTo?: (PlayKind | 'any')[];
  target?: 'enemySlot';
}

export interface CardDef {
  id: string;
  name: string;
  faction: Faction | 'tech';
  type: CardType;
  cost: number;
  strain: number;
  slot?: SlotType;
  attack: number;
  armor: number;
  text: string;
  signature: boolean;
  effect: CardEffect;
  budgetNote: string;
}

export interface TreeNode {
  id: string;
  name: string;
  text: string;
  params: Record<string, number | string | boolean>;
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
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  faction: Faction;
  isBot: boolean;
  loadout: string[];
  hp: number;
  strain: number;
  energy: number;
  bank: number;
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
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
  stats: PlayerStats;
}

export interface PendingPlay {
  player: PlayerId;
  card: CardInstance;
  slot?: SlotId;
  target?: SlotId;
  faceDown?: boolean;
  negated: boolean;
  reflected: boolean;
}

export interface ReactionWindow {
  reactor: PlayerId;
  play: PendingPlay;
}

export type LogKind = 'round' | 'stance' | 'play' | 'damage' | 'strain' | 'reject' | 'evolve' | 'heal' | 'end' | 'info' | 'hit';

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
}

// ---------- Setup ----------
export interface PlayerSetup {
  name: string;
  faction: Faction;
  deck: string[];
  loadout: string[];
  isBot?: boolean;
}

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
  | { type: 'CHOOSE_EVOLUTION'; player: PlayerId; id: string };
