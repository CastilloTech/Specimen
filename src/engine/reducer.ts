// The rules engine entry point: reduce(state, action) -> newState.
// Pure: no UI imports, no clocks, no Math.random. All randomness comes from state.rng.
import { produce, setAutoFreeze } from 'immer';
import { cardOf } from './data';
import {
  addStrain,
  afterStancesPicked,
  beginRound,
  clash,
  drawCards,
  endIfDead,
  evolve,
  finishRound,
  hurt,
  logMsg,
  recordPlay,
  resolvePlay,
  revealGraft,
  resolveStances,
  runOps,
  strainCheck,
  vent,
  SLOT_LABEL,
} from './rules';
import { nextInt, shuffleInPlace } from './rng';
import { canBeDormant, cardCost, hasNode, nodeParam } from './stats';
import type { Action, CardDef, GameState, PendingPlay, PlayerId, PlayKind, SlotId, Stance } from './types';
import { other, STANCES } from './types';

setAutoFreeze(false);

const MAX_ACTIONS_PER_ROUND = 120;

// ---------- Queries ----------
export function pendingPlayers(s: GameState): PlayerId[] {
  switch (s.phase) {
    case 'mulligan':
      return s.players.filter((p) => !p.mulliganDecided).map((p) => p.id);
    case 'stance':
      return s.players.filter((p) => p.stance === null).map((p) => p.id);
    case 'feint':
      return s.feintQueue.length ? [s.feintQueue[0]] : [];
    case 'actions':
      return [s.window ? s.window.reactor : s.turn];
    case 'evolve':
      return s.evoQueue.length ? [s.evoQueue[0]] : [];
    default:
      return [];
  }
}

export function protocolMatches(reactsTo: (PlayKind | 'any')[] | undefined, kind: string): boolean {
  return !!reactsTo && (reactsTo.includes('any') || reactsTo.includes(kind as PlayKind));
}

export function reactionOptions(s: GameState, reactor: PlayerId, play: PendingPlay): Action[] {
  const pl = s.players[reactor];
  const kind = cardOf(play.card.cardId).type;
  const out: Action[] = [];
  for (const c of pl.hand) {
    const def = cardOf(c.cardId);
    if (def.type !== 'protocol' || !protocolMatches(def.effect.reactsTo, kind)) continue;
    if (cardCost(s, pl, def) <= pl.energy) out.push({ type: 'REACT', player: reactor, uid: c.uid });
  }
  if (hasNode(pl, 'pressureValve') && !pl.valveUsed && pl.strain > 0) out.push({ type: 'REACT', player: reactor, ability: 'pressureValve' });
  return out;
}

/** Extra Energy for putting a graft on an occupied slot (it replaces the graft there). 0 for everything else. */
export function replaceCost(s: GameState, pl: GameState['players'][number], def: CardDef, slot: SlotId | undefined): number {
  if (def.type !== 'graft' || !slot || !s.config.replace.enabled) return 0;
  return pl.grafts.some((g) => g.slot === slot) ? s.config.replace.extraCost : 0;
}

export function legalPlays(s: GameState, p: PlayerId): Action[] {
  const pl = s.players[p];
  const opp = s.players[other(p)];
  const out: Action[] = [];
  for (const c of pl.hand) {
    const def = cardOf(c.cardId);
    if (def.type === 'protocol') continue;
    if (def.type === 'graft') {
      for (const slot of pl.slots) {
        out.push({ type: 'PLAY_CARD', player: p, uid: c.uid, slot });
        out.push({ type: 'PLAY_CARD', player: p, uid: c.uid, slot, faceDown: true });
      }
    } else if (def.effect.target === 'enemySlot') {
      for (const g of opp.grafts) out.push({ type: 'PLAY_CARD', player: p, uid: c.uid, target: g.slot });
    } else out.push({ type: 'PLAY_CARD', player: p, uid: c.uid });
  }
  return out.filter((a) => validateAction(s, a) === null);
}

// ---------- Validation ----------
export function validateAction(s: GameState, a: Action): string | null {
  if (s.phase === 'over') return 'The match is over.';
  const pl = s.players[a.player];
  switch (a.type) {
    case 'MULLIGAN':
      if (s.phase !== 'mulligan') return 'Not the mulligan phase.';
      if (pl.mulliganDecided) return 'Already decided.';
      if (a.mulligan && s.config.match.freeMulligans < 1) return 'No mulligan available.';
      return null;
    case 'PICK_STANCE':
    case 'AUTO_STANCE':
      if (s.phase !== 'stance') return 'Not the stance phase.';
      if (pl.stance !== null) return 'Stance already chosen.';
      if (a.type === 'PICK_STANCE' && !STANCES.includes(a.stance)) return 'Unknown stance.';
      return null;
    case 'FEINT':
      if (s.phase !== 'feint' || s.feintQueue[0] !== a.player) return 'Feint is not available.';
      if (a.stance !== null && !STANCES.includes(a.stance)) return 'Unknown stance.';
      return null;
    case 'CHOOSE_EVOLUTION':
      if (s.phase !== 'evolve' || s.evoQueue[0] !== a.player) return 'Not your evolution choice.';
      if (a.id !== null && !pl.evolutionOptions.includes(a.id)) return 'Not a valid evolution.';
      return null;
    case 'REACT':
    case 'DECLINE_REACTION':
      if (s.phase !== 'actions' || !s.window || s.window.reactor !== a.player) return 'No reaction window.';
      if (a.type === 'REACT') {
        if (a.ability === 'pressureValve') {
          if (!hasNode(pl, 'pressureValve') || pl.valveUsed) return 'Pressure Valve is not available.';
          return null;
        }
        const c = pl.hand.find((x) => x.uid === a.uid);
        if (!c) return 'Card not in hand.';
        const def = cardOf(c.cardId);
        if (def.type !== 'protocol') return 'Only Protocols can react.';
        if (!protocolMatches(def.effect.reactsTo, cardOf(s.window.play.card.cardId).type)) return 'That Protocol does not answer this play.';
        if (cardCost(s, pl, def) > pl.energy) return 'Not enough Energy.';
      }
      return null;
    default:
      break;
  }
  // Remaining actions are all "main phase" actions.
  if (s.phase !== 'actions') return 'Not the actions phase.';
  if (s.window) return 'Waiting for a reaction.';
  if (s.turn !== a.player) return 'Not your turn.';
  const opp = s.players[other(a.player)];
  switch (a.type) {
    case 'PASS':
      return null;
    case 'HOLD':
      return pl.hold ? 'Already holding.' : null;
    case 'REVEAL': {
      if (!s.config.features.dormant) return 'Dormant grafts are off.';
      const g = pl.grafts.find((x) => x.slot === a.slot);
      return g && g.faceDown ? null : 'No face-down graft there.';
    }
    case 'CYCLE':
      if (!s.config.features.cycling) return 'Cycling is off.';
      if (pl.cycledThisRound >= s.config.cycle.perRound) return 'Already cycled this round.';
      return pl.hand.some((c) => c.uid === a.uid) ? null : 'Card not in hand.';
    case 'PLAY_CARD': {
      const c = pl.hand.find((x) => x.uid === a.uid);
      if (!c) return 'Card not in hand.';
      const def = cardOf(c.cardId);
      if (def.type === 'protocol') return 'Protocols can only be played in response.';
      const extra = replaceCost(s, pl, def, a.slot);
      if (cardCost(s, pl, def) + extra > pl.energy) return extra > 0 ? `Replacing a graft costs ${extra} more Energy.` : 'Not enough Energy.';
      if (def.type === 'graft') {
        if (!a.slot || !pl.slots.includes(a.slot)) return 'Choose one of your slots.';
        if (s.config.slotTypes[a.slot] !== def.slot) return `${def.name} fits a ${def.slot} slot.`;
        if (pl.grafts.some((g) => g.slot === a.slot) && !s.config.replace.enabled) return 'That slot is occupied.';
        if (a.faceDown && (!s.config.features.dormant || !canBeDormant(def))) return 'This graft cannot be Dormant.';
        return null;
      }
      if (def.effect.target === 'enemySlot') {
        const g = opp.grafts.find((x) => x.slot === a.target);
        if (!g) return 'Choose an enemy graft to target.';
        if ((def.effect.ops ?? []).some((o) => o.op === 'reveal') && !g.faceDown) return 'Target a face-down graft.';
      }
      return null;
    }
    default:
      return 'Unknown action.';
  }
}

// ---------- Reducer ----------
export function reduce(state: GameState, action: Action): GameState {
  const err = validateAction(state, action);
  if (err) return state.lastError === err ? state : produce(state, (d) => void (d.lastError = err));
  return produce(state, (d) => {
    d.lastError = null;
    d.history.push(action);
    apply(d as GameState, action);
  });
}

function afterAction(s: GameState, actor: PlayerId): void {
  if (endIfDead(s)) return;
  s.turn = other(actor);
}

function endActions(s: GameState): void {
  s.window = null;
  clash(s);
  if (s.phase === 'over') return;
  strainCheck(s);
}

function openWindowOrResolve(s: GameState, play: PendingPlay): void {
  const reactor = other(play.player);
  if (reactionOptions(s, reactor, play).length) {
    s.window = { reactor, play };
    return;
  }
  resolvePlay(s, play);
  afterAction(s, play.player);
}

function apply(s: GameState, a: Action): void {
  const pl = s.players[a.player];
  switch (a.type) {
    case 'MULLIGAN': {
      pl.mulliganDecided = true;
      if (a.mulligan) {
        pl.mulliganUsed = true;
        pl.deck.push(...pl.hand);
        pl.hand = [];
        shuffleInPlace(s, pl.deck);
        drawCards(s, a.player, s.config.match.startingHand);
        logMsg(s, 'info', a.player, `${pl.name} takes a mulligan.`);
      } else logMsg(s, 'info', a.player, `${pl.name} keeps their hand.`);
      if (s.players.every((p) => p.mulliganDecided)) beginRound(s);
      return;
    }
    case 'PICK_STANCE':
    case 'AUTO_STANCE': {
      pl.stance = a.type === 'PICK_STANCE' ? a.stance : (STANCES[nextInt(s, 3)] as Stance);
      if (s.players.every((p) => p.stance !== null)) afterStancesPicked(s);
      return;
    }
    case 'FEINT': {
      s.feintQueue.shift();
      if (a.stance !== null) {
        pl.feintUsed = true;
        pl.stance = a.stance;
        logMsg(s, 'stance', a.player, `${pl.name} uses Feint and re-picks their stance.`);
        const cost = nodeParam(pl, 'feint', 'strain'); // optional price for the free stance win
        if (cost > 0) {
          addStrain(s, a.player, cost);
          logMsg(s, 'strain', a.player, `Feint: ${pl.name} gains ${cost} Strain.`, cost);
        }
        const dmg = nodeParam(pl, 'feint', 'damage');
        if (dmg > 0) hurt(s, a.player, dmg, null, 'Feint');
        s.feintQueue = [];
      }
      if (!s.feintQueue.length) resolveStances(s);
      return;
    }
    case 'CHOOSE_EVOLUTION': {
      if (a.id !== null) evolve(s, a.player, a.id);
      else logMsg(s, 'evolve', a.player, `${pl.name} holds off on evolving for now.`);
      s.evoQueue.shift();
      if (!s.evoQueue.length) finishRound(s);
      return;
    }
    case 'PLAY_CARD': {
      const idx = pl.hand.findIndex((c) => c.uid === a.uid);
      const card = pl.hand.splice(idx, 1)[0];
      const def = cardOf(card.cardId);
      pl.energy -= cardCost(s, pl, def) + replaceCost(s, pl, def, a.slot);
      pl.stats.cardsPlayed++;
      s.passStreak = 0;
      s.actionCount++;
      const faceDown = def.type === 'graft' && !!a.faceDown;
      recordPlay(s, { player: a.player, kind: 'play', uid: card.uid, cardId: card.cardId, ...(faceDown ? { faceDown: true } : {}), ...(a.slot ? { slot: a.slot } : {}), ...(a.target ? { target: a.target } : {}) });
      if (def.type !== 'graft') {
        const t = a.target ? ` targeting ${SLOT_LABEL[a.target]}` : '';
        logMsg(s, 'play', a.player, `${pl.name} plays ${def.name}${t}.`);
      }
      openWindowOrResolve(s, { player: a.player, card, slot: a.slot, target: a.target, faceDown, negated: false, reflected: false });
      return;
    }
    case 'REACT': {
      const w = s.window!;
      if (a.ability === 'pressureValve') {
        pl.valveUsed = true;
        recordPlay(s, { player: a.player, kind: 'valve', uid: 'valve' });
        const v = vent(s, a.player, nodeParam(pl, 'pressureValve', 'vent'));
        logMsg(s, 'strain', a.player, `${pl.name} uses Pressure Valve and vents ${v} Strain.`, -v);
      } else {
        const idx = pl.hand.findIndex((c) => c.uid === a.uid);
        const card = pl.hand.splice(idx, 1)[0];
        const def = cardOf(card.cardId);
        pl.energy -= cardCost(s, pl, def);
        pl.stats.cardsPlayed++;
        recordPlay(s, { player: a.player, kind: 'react', uid: card.uid, cardId: card.cardId });
        logMsg(s, 'play', a.player, `${pl.name} responds with ${def.name}.`);
        addStrain(s, a.player, def.strain);
        runOps(s, def.effect.ops ?? [], { caster: a.player, victim: other(a.player), play: w.play, source: def.name });
        pl.discard.push(card);
      }
      s.window = null;
      if (endIfDead(s)) return;
      resolvePlay(s, w.play);
      afterAction(s, w.play.player);
      return;
    }
    case 'DECLINE_REACTION': {
      const w = s.window!;
      s.window = null;
      resolvePlay(s, w.play);
      afterAction(s, w.play.player);
      return;
    }
    case 'CYCLE': {
      const idx = pl.hand.findIndex((c) => c.uid === a.uid);
      const cycled = pl.hand.splice(idx, 1)[0];
      pl.discard.push(cycled);
      recordPlay(s, { player: a.player, kind: 'cycle', uid: cycled.uid }); // the card itself stays private
      pl.cycledThisRound++;
      s.passStreak = 0;
      s.actionCount++;
      if (a.mode === 'vent') {
        const v = vent(s, a.player, s.config.cycle.ventAmount);
        logMsg(s, 'strain', a.player, `${pl.name} cycles a card to vent ${v} Strain.`, -v);
      } else {
        drawCards(s, a.player, s.config.cycle.drawAmount);
        logMsg(s, 'info', a.player, `${pl.name} cycles a card to draw.`);
      }
      afterAction(s, a.player);
      return;
    }
    case 'REVEAL': {
      const g = pl.grafts.find((x) => x.slot === a.slot)!;
      s.passStreak = 0;
      s.actionCount++;
      revealGraft(s, a.player, g, true); // wakes it: pays its saved Strain, Ambush if it has slept a round
      afterAction(s, a.player);
      return;
    }
    case 'HOLD': {
      pl.hold = true;
      pl.tempArmor += s.config.strain.holdArmor;
      s.passStreak = 0;
      s.actionCount++;
      logMsg(s, 'info', a.player, `${pl.name} declares Hold: no Clash damage this round, +${s.config.strain.holdArmor} armor.`);
      afterAction(s, a.player);
      return;
    }
    case 'PASS': {
      s.passStreak++;
      s.actionCount++;
      logMsg(s, 'info', a.player, `${pl.name} passes.`);
      if (s.passStreak >= 2 || s.actionCount >= MAX_ACTIONS_PER_ROUND) endActions(s);
      else s.turn = other(a.player);
      return;
    }
  }
}
