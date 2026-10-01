// Heuristic bot. Uses only information a player could see: its own hand and the
// public board (face-down enemy grafts expose their slot and Strain only).
import { budgetOf } from './budget';
import { cardOf } from './data';
import { legalPlays, reactionOptions } from './reducer';
import type { makeRng } from './rng';
import { cardCost, computeStats, graftStrain, nodeParam } from './stats';
import type { Action, AttachedGraft, CardDef, GameState, PlayerId, Stance } from './types';
import { other, STANCES } from './types';
import { readerAction, searchAction } from './botTiers';

type Rng = ReturnType<typeof makeRng>;

const COUNTER: Record<Stance, Stance> = { aggress: 'fortify', adapt: 'aggress', fortify: 'adapt' };

function cardValue(s: GameState, c: CardDef): number {
  const r = budgetOf(c, s.config);
  return r.stats + r.text;
}

/** Value of an enemy graft as visible to the bot. */
function visibleGraftValue(s: GameState, g: AttachedGraft): number {
  if (g.faceDown) return g.strain * 1.5 + 1; // stats hidden: Strain is the only clue
  return cardValue(s, cardOf(g.cardId));
}

function weightedPick<T>(rng: Rng, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng.float() * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function pickStance(s: GameState, p: PlayerId, rng: Rng): Stance {
  const pl = s.players[p];
  const opp = s.players[other(p)];
  const last = opp.stanceHistory[opp.stanceHistory.length - 1];
  const base = s.config.bot.stanceBaseWeights[pl.faction];
  const weights = STANCES.map((st) => base[st] * (last && COUNTER[last] === st ? s.config.bot.stanceCounterWeight : 1));
  return weightedPick(rng, STANCES, weights);
}

/** Toxins the opponent has played this match (public information). */
export function oppToxinsPlayed(s: GameState, p: PlayerId): number {
  return s.plays.filter((r) => r.player === other(p) && r.cardId && cardOf(r.cardId).type === 'toxin').length;
}

/** How far below the Rejection threshold the bot keeps its Strain when grafting (per-faction override). */
function strainMargin(s: GameState, p: PlayerId): number {
  const byFaction = s.config.bot.graftStrainMarginByFaction as Record<string, number | undefined>;
  const base = byFaction[s.players[p].faction] ?? s.config.bot.graftStrainMargin;
  return base;
}

/** Face-down (Dormant) habits: higher tiers bluff more, with pricier grafts and later in the match. */
function dormantHabits(s: GameState, p: PlayerId) {
  const b = s.config.bot;
  return s.players[p].ai === 'basic' ? { chance: b.dormantChance, maxCost: b.dormantMaxCost, maxRound: b.dormantMaxRound } : { chance: 0.5, maxCost: 4, maxRound: 6 };
}

// ---------- Scoring plays ----------
/**
 * Synergy engines: a card is worth more when the other half of its engine is already on the board or in hand
 * (a payoff with enablers, an enabler with payoffs; the board counts more than the hand). Capped, so an
 * engine piece is never played over a clearly better card just for the tag. Also used by deck auto-fill.
 */
export function engineSynergy(def: CardDef, board: string[], hand: string[]): number {
  if (!def.engines?.length) return 0;
  let bonus = 0;
  for (const t of def.engines) {
    const partner = (id: string) => cardOf(id).engines?.some((x) => x.id === t.id && (t.role === 'enabler' ? x.role === 'payoff' : true)) ?? false;
    const onBoard = board.filter(partner).length;
    const inHand = hand.filter(partner).length;
    bonus += Math.min(3, onBoard * 1 + inHand * 0.5) * (t.role === 'payoff' ? 0.9 : 0.6);
  }
  return bonus;
}

function scorePlay(s: GameState, p: PlayerId, a: Extract<Action, { type: 'PLAY_CARD' }>): number {
  const base = scorePlayBase(s, p, a);
  if (base < 0) return base;
  const pl = s.players[p];
  const card = pl.hand.find((c) => c.uid === a.uid)!;
  const others = pl.hand.filter((c) => c.uid !== a.uid).map((c) => c.cardId);
  const def = cardOf(card.cardId);
  const board = pl.grafts.filter((g) => !g.faceDown && !g.disabled).map((g) => g.cardId);
  return base + engineSynergy(def, board, others) + engineSequencing(s, p, def, board, others);
}

/** Order an engine combo: a payoff graft goes down before the one-shot enablers that set it off, and an
 * enabler held back for a payoff the bot can afford to play first (then it fires straight away). */
function engineSequencing(s: GameState, p: PlayerId, def: CardDef, board: string[], hand: string[]): number {
  const pl = s.players[p];
  const payoffOf = (id: string, e: string) => cardOf(id).engines?.some((t) => t.id === e && t.role === 'payoff') ?? false;
  const oneShot = (id: string) => cardOf(id).type !== 'graft';
  let adj = 0;
  for (const t of def.engines ?? []) {
    if (t.role === 'payoff' && def.type === 'graft') {
      if (hand.some((id) => oneShot(id) && cardOf(id).engines?.some((x) => x.id === t.id && x.role === 'enabler'))) adj += 1;
    } else if (t.role === 'enabler' && def.type !== 'graft') {
      if (board.some((id) => payoffOf(id, t.id))) adj += 1.2;
      else if (hand.some((id) => cardOf(id).type === 'graft' && payoffOf(id, t.id) && cardCost(s, pl, cardOf(id)) <= pl.energy)) adj -= 2;
    }
  }
  return adj;
}

function scorePlayBase(s: GameState, p: PlayerId, a: Extract<Action, { type: 'PLAY_CARD' }>): number {
  const pl = s.players[p];
  const opp = s.players[other(p)];
  const cfg = s.config;
  const T = cfg.strain.threshold;
  const card = pl.hand.find((c) => c.uid === a.uid)!;
  const def = cardOf(card.cardId);
  if (pl.strain + def.strain > T + 2 && def.type !== 'graft') return -1; // don't bury ourselves for a serum
  switch (def.type) {
    case 'graft': {
      const st = graftStrain(pl, def);
      const quiet = a.faceDown ? Math.min(st, cfg.dormant.quietStrain) : 0;
      const old = pl.grafts.find((g) => g.slot === a.slot); // an occupied slot means replacing the graft there
      if (pl.strain - (old?.strain ?? 0) + st - quiet > T - strainMargin(s, p)) return -1;
      const v = cardValue(s, def);
      // Sleeping costs tempo (no stats until it wakes), so face-down is only chosen here when face-up would not fit.
      const sleep = a.faceDown ? 1.5 : 0;
      if (old) {
        const gain = v - cardValue(s, cardOf(old.cardId));
        return gain >= 2 ? 1.5 + gain - sleep : -1; // only replace for a clear upgrade
      }
      return 2 + v - sleep;
    }
    case 'toxin': {
      const amt = (def.effect.ops ?? []).reduce((n, o) => n + (o.op === 'strain' && o.who !== 'self' ? o.amount : 0), 0);
      if ((def.effect.ops ?? []).some((o) => o.op === 'status' && o.who !== 'self')) return 5; // Bleed/Fever: worth it on its own
      // A Toxin that destroys a random enemy graft (Marrow Blight): worth it when there is something to hit.
      // A jammer: worth it against an engine payoff on the board.
      if ((def.effect.ops ?? []).some((o) => o.op === 'sabotage' && o.pick === 'engine')) {
        const live = opp.grafts.some((g) => !g.faceDown && !g.disabled && cardOf(g.cardId).engines?.some((t) => t.role === 'payoff'));
        return live ? 6 : opp.grafts.some((g) => !g.faceDown) ? 1 : -1;
      }
      if ((def.effect.ops ?? []).some((o) => o.op === 'sabotage')) return opp.grafts.some((g) => !g.faceDown) ? 4 + Math.min(3, opp.grafts.length) * 0.5 : -1;
      if (opp.strain >= cfg.bot.toxinOppStrain || opp.strain + amt > T) return 6 + amt;
      return -1;
    }
    case 'sabotage': {
      const g = opp.grafts.find((x) => x.slot === a.target);
      if (!g) return -1;
      if ((def.effect.ops ?? []).some((o) => o.op === 'graftDamage')) {
        const dmg = (def.effect.ops ?? []).reduce((n, o) => n + (o.op === 'graftDamage' ? o.amount : 0), 0);
        // A face-down graft's true integrity isn't public information; only a revealed graft's is used to judge a kill.
        const kill = !g.faceDown && dmg >= g.integrity;
        return kill ? 2 + visibleGraftValue(s, g) : 1 + dmg * 0.6;
      }
      const mode = (def.effect.ops ?? []).find((o) => o.op === 'sabotage');
      const mult = mode && mode.op === 'sabotage' ? (mode.mode === 'sever' || mode.mode === 'necrosis' ? 1 : mode.mode === 'poison' ? 0.85 : 0.7) : 0.5;
      const v = visibleGraftValue(s, g) * mult;
      return v >= 3 ? 2 + v : -1;
    }
    case 'serum': {
      let score = 0;
      const myStats = computeStats(s, pl);
      const oppStats = computeStats(s, opp);
      for (const op of def.effect.ops ?? []) {
        switch (op.op) {
          case 'heal':
            if (pl.maxHp - pl.hp >= Math.ceil(op.amount * 0.7)) score += op.amount * 0.7;
            break;
          case 'vent':
            if (pl.strain >= 5) score += Math.min(op.amount, pl.strain) * 1.2 + 0.6;
            break;
          case 'draw':
            if (pl.hand.length <= 6 && s.round <= 6) score += op.amount * 1.4;
            break;
          case 'energy':
            if (pl.hand.length >= 3 && pl.energy <= 4) score += 1.5;
            break;
          case 'damage':
            if (op.who !== 'self') score += op.amount * 0.75;
            break;
          case 'buff':
            if (op.who === 'opp') score += Math.min(oppStats.armor, -op.amount) * 0.6 * (myStats.attack > 0 ? 1 : 0);
            else if (op.stat === 'attack') score += op.amount * 0.5;
            else score += Math.min(op.amount, Math.max(0, oppStats.attack - myStats.armor)) * 0.4;
            break;
          case 'strain':
            if (op.who !== 'self') score += op.amount * 0.5;
            break;
          case 'reveal':
            score += 3.5; // only offered against a face-down graft: it wakes early and pays the Strain it saved
            break;
          case 'purge':
            if (op.who !== 'opp' && (pl.bleed > 0 || pl.numb > 0 || pl.fever > 0 || Object.keys(pl.necrosis).length > 0)) score += 3;
            break;
          default:
            break;
        }
      }
      return score >= 1.5 ? score : -1;
    }
    default:
      return -1;
  }
}

function deadness(s: GameState, p: PlayerId, def: CardDef): number {
  const pl = s.players[p];
  if (def.type === 'graft') {
    const free = pl.slots.some((sl) => s.config.slotTypes[sl] === def.slot && !pl.grafts.some((g) => g.slot === sl));
    if (!free) return 1;
    if (pl.strain + graftStrain(pl, def) > s.config.strain.threshold - strainMargin(s, p)) return 0.6;
  }
  if (def.type === 'toxin' && s.players[other(p)].strain < 4) return 0.3;
  if (def.effect.target === 'enemySlot' && !s.players[other(p)].grafts.length) return 0.4;
  return 0;
}

export function botMainAction(s: GameState, p: PlayerId, rng: Rng): Action {
  const pl = s.players[p];
  const opp = s.players[other(p)];
  // A sleeping graft wakes once it can ambush (it has slept a round) and the Strain it saved fits under the margin.
  const T = s.config.strain.threshold;
  const waking = pl.grafts.find((g) => g.faceDown && (g.sleptSince ?? s.round) < s.round && pl.strain + (g.dormantStrain ?? 0) <= T - strainMargin(s, p));
  if (waking) return { type: 'REVEAL', player: p, slot: waking.slot };
  const plays = legalPlays(s, p).filter((a): a is Extract<Action, { type: 'PLAY_CARD' }> => a.type === 'PLAY_CARD');
  // One candidate per (card, slot, target, face-up or face-down)
  const seen = new Set<string>();
  let best: Action | null = null;
  let bestScore = 0;
  for (const a of plays) {
    const key = `${a.uid}:${a.slot ?? ''}:${a.target ?? ''}:${a.faceDown ? 'd' : 'u'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sc = scorePlay(s, p, a) + rng.float() * 0.01;
    if (sc > bestScore) {
      bestScore = sc;
      best = a;
    }
  }
  if (best && best.type === 'PLAY_CARD') {
    const def = cardOf(pl.hand.find((c) => c.uid === best!.uid)!.cardId);
    // Sleep cheap grafts on purpose (the audit's best simple rule: they cost little to leave idle) so they can wake later with an Ambush.
    const dh = dormantHabits(s, p);
    const dormant = def.type === 'graft' && !best.faceDown && def.cost <= dh.maxCost && s.round <= dh.maxRound && rng.float() < dh.chance;
    const wantFace = dormant && plays.some((a) => a.uid === best!.uid && a.slot === (best as { slot?: string }).slot && a.faceDown);
    return wantFace ? { ...best, faceDown: true } : best;
  }
  // Nothing worth playing: try to cycle a dead card
  if (s.config.features.cycling && pl.cycledThisRound < s.config.cycle.perRound && pl.hand.length) {
    const ranked = pl.hand.map((c) => ({ c, d: deadness(s, p, cardOf(c.cardId)) })).sort((x, y) => y.d - x.d);
    if (ranked[0].d >= 0.6) return { type: 'CYCLE', player: p, uid: ranked[0].c.uid, mode: pl.strain >= 6 ? 'vent' : 'draw' };
  }
  if (!pl.hold) {
    // Hold gives up this round's own Clash damage for some armor (reduces incoming damage) and Strain relief.
    // Worth it when there is little to lose (weak attack) and something real to gain (a hit worth blunting, or
    // high Strain), more so when low on HP.
    const cfg = s.config;
    const myStats = computeStats(s, pl);
    const oppStats = computeStats(s, opp);
    const holdVent = cfg.strain.holdVent + nodeParam(pl, 'heatSink', 'vent');
    const incoming = Math.max(0, oppStats.attack - myStats.armor);
    const blocked = Math.min(incoming, cfg.strain.holdArmor);
    const defenseValue = blocked * (pl.hp <= 14 ? 2 : 1.2);
    const strainValue = holdVent * (pl.strain >= 6 ? 1.4 : 0.4);
    if (defenseValue + strainValue > myStats.attack * 0.85 + 0.5) return { type: 'HOLD', player: p };
  }
  return { type: 'PASS', player: p };
}

export function botReaction(s: GameState, p: PlayerId): Action {
  const w = s.window!;
  const pl = s.players[p];
  const opp = s.players[other(p)];
  const T = s.config.strain.threshold;
  const kind = cardOf(w.play.card.cardId).type;
  let best: Action | null = null;
  let bestScore = 1.5;
  for (const a of reactionOptions(s, p, w.play)) {
    if (a.type !== 'REACT') continue;
    let score = 0;
    if (a.ability === 'pressureValve') score = pl.strain >= T - 2 ? 4 : 0;
    else {
      const def = cardOf(pl.hand.find((c) => c.uid === a.uid)!.cardId);
      for (const op of def.effect.ops ?? []) {
        switch (op.op) {
          case 'negate':
            score += kind === 'toxin' || kind === 'sabotage' ? 6 : kind === 'graft' ? 3 : 1;
            break;
          case 'reflect':
            score += 7;
            break;
          case 'strain':
            if (op.who !== 'self') score += opp.strain + op.amount >= 7 ? op.amount * 1.3 : op.amount * 0.4;
            break;
          case 'damage':
            if (op.who !== 'self') score += op.amount * (opp.hp <= 12 ? 0.9 : 0.55);
            break;
          case 'buff':
            // Armor (or attack) this round is worth close to its face value. This used to be capped at a
            // crude, stance-blind pre-Clash damage guess (ignoring Adapt/Fortify's modifiers and any graft
            // the opponent had not played yet), which badly undervalued defensive reactions like Brace for
            // Impact - raising a card's own armor amount barely moved its win rate because of that cap.
            if (op.who !== 'opp') score += op.amount * 0.6;
            break;
          case 'drain':
            score += opp.energy >= 2 ? op.amount * 1.3 : 0;
            break;
          case 'vent':
            score += pl.strain >= 7 ? op.amount * 1.4 : 0;
            break;
          case 'status':
            if (op.who !== 'self') {
              // Another Bleed on a bleeding opponent adds a stack (more damage every tick) until the cap.
              const bleedValue = opp.bleed > 0 ? (opp.bleedStacks < s.config.status.bleedMaxStacks ? 3 : 1) : 2.5;
              score += op.kind === 'numb' ? 3 : op.kind === 'bleed' ? bleedValue : 2;
            }
            break;
          default:
            break;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best ?? { type: 'DECLINE_REACTION', player: p };
}

/** Decide the next action for player p, whatever the phase requires, at the player's bot tier. */
/** With the deferred evolution choice, a bot takes an offered form at its next decision. */
function deferredEvolution(s: GameState, p: PlayerId, rng: Rng): Action | null {
  const pl = s.players[p];
  if (!s.config.evolution.deferredChoice || !pl.evolutionOptions.length || s.phase === 'mulligan' || s.phase === 'over') return null;
  return { type: 'CHOOSE_EVOLUTION', player: p, id: rng.pick(pl.evolutionOptions) };
}

export function botAction(s: GameState, p: PlayerId, rng: Rng): Action {
  const evo = deferredEvolution(s, p, rng);
  if (evo) return evo;
  const tier = s.players[p].ai;
  if (tier === 'reader') return readerAction(s, p, rng);
  if (tier === 'search') return searchAction(s, p, rng);
  return basicAction(s, p, rng);
}

/** The prototype heuristic bot (tier 'basic'), also the rollout policy of the search bot. */
export function basicAction(s: GameState, p: PlayerId, rng: Rng): Action {
  const pl = s.players[p];
  const evo = deferredEvolution(s, p, rng);
  if (evo) return evo;
  switch (s.phase) {
    case 'mulligan': {
      const playable = pl.hand.filter((c) => {
        const d = cardOf(c.cardId);
        return d.type === 'graft' && d.cost <= 3;
      }).length;
      return { type: 'MULLIGAN', player: p, mulligan: playable < s.config.bot.mulliganIfPlayableGraftsBelow };
    }
    case 'stance':
      return { type: 'PICK_STANCE', player: p, stance: pickStance(s, p, rng) };
    case 'feint': {
      const opp = s.players[other(p)];
      return { type: 'FEINT', player: p, stance: COUNTER[opp.stance!] };
    }
    case 'evolve':
      return { type: 'CHOOSE_EVOLUTION', player: p, id: rng.pick(pl.evolutionOptions) };
    case 'actions':
      return s.window ? botReaction(s, p) : botMainAction(s, p, rng);
    default:
      throw new Error('Match is over');
  }
}
