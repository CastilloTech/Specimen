// Mutating rule implementations. Every function here receives an immer draft (or any
// mutable GameState) and is only called from the reducer.
import { ambushOf, cardOf } from './data';
import { nextInt, shuffleInPlace } from './rng';
import {
  beats,
  computeStats,
  engineAmp,
  condOk,
  evoFlag,
  evoNum,
  evolutionDefs,
  evolutionTarget,
  graftStrain,
  hasNode,
  metricValue,
  momentum,
  overclockBonus,
  sumLoadoutParam,
  veteranRank,
  zoneOf,
} from './stats';
import type { Ability, AttachedGraft, CardDef, CardInstance, DiscardReason, EngineId, GameState, LogKind, Op, PendingPlay, PlayerId, PlayerState, PlayRecord, SlotId, Trigger } from './types';
import { other } from './types';

export const SLOT_LABEL: Record<SlotId, string> = {
  head: 'Head',
  limbA: 'Limb A',
  limbB: 'Limb B',
  organ: 'Organ',
  organB: 'Organ B',
  nerve: 'Nerve',
};

export const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function logMsg(s: GameState, kind: LogKind, player: PlayerId | null, text: string, amount?: number): void {
  s.log.push({ n: s.log.length, round: s.round, kind, player, text, amount });
}

const name = (s: GameState, p: PlayerId) => s.players[p].name;

// ---------- Primitive mutations ----------
/** Put a card in its owner's discard pile, remembering how and when it got there. */
export function toDiscard(s: GameState, pl: PlayerState, c: CardInstance, why: DiscardReason, by?: string): void {
  const slot = (c as { slot?: SlotId }).slot;
  pl.discard.push({ uid: c.uid, cardId: c.cardId, why, round: s.round, ...(by ? { by } : {}), ...(slot ? { slot } : {}) });
}

/** Draws up to n cards. A card drawn into a full hand (config.match.maxHand) is burned: discarded face-up. */
export function drawCards(s: GameState, p: PlayerId, n: number): number {
  const pl = s.players[p];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const c = pl.deck.pop();
    if (!c) break;
    if (pl.hand.length >= s.config.match.maxHand) {
      toDiscard(s, pl, c, 'burned');
      logMsg(s, 'info', p, `${pl.name}'s hand is full (${s.config.match.maxHand}): ${cardOf(c.cardId).name} is burned.`);
      continue;
    }
    pl.hand.push(c);
    drawn++;
  }
  return drawn;
}

export function heal(s: GameState, p: PlayerId, amount: number, source: string): number {
  const pl = s.players[p];
  const actual = Math.max(0, Math.min(amount, pl.maxHp - pl.hp));
  if (actual > 0) {
    pl.hp += actual;
    pl.stats.hpHealed += actual;
    logMsg(s, 'heal', p, `${pl.name} heals ${actual} (${source}).`, actual);
  }
  return actual;
}

/** Direct damage that ignores armor. `by` is credited with the damage (null = self-inflicted). */
export function hurt(s: GameState, victim: PlayerId, amount: number, by: PlayerId | null, source: string): number {
  if (amount <= 0) return 0;
  const pl = s.players[victim];
  pl.hp = Math.max(0, pl.hp - amount);
  pl.stats.damageTaken += amount;
  if (by !== null && by !== victim) s.players[by].stats.damageDealt += amount;
  logMsg(s, 'damage', victim, `${pl.name} takes ${amount} damage (${source}).`, amount);
  return amount;
}

export function addStrain(s: GameState, p: PlayerId, amount: number): void {
  if (amount <= 0) return;
  const pl = s.players[p];
  pl.strain += amount;
  pl.stats.maxStrain = Math.max(pl.stats.maxStrain, pl.strain);
  // Engine events (Frenzy, Feed).
  fireTrigger(s, p, 'onGainStrain');
  fireTrigger(s, other(p), 'onOppGainStrain');
}

/** Voluntary venting (counts toward Carapace). Returns the Strain actually removed. */
export function vent(s: GameState, p: PlayerId, amount: number): number {
  const pl = s.players[p];
  // A Tower rule twist: this player vents less (never below 1 for a real vent).
  const eff = pl.ventMalus > 0 && amount > 0 ? Math.max(1, amount - pl.ventMalus) : amount;
  const actual = Math.max(0, Math.min(eff, pl.strain));
  pl.strain -= actual;
  pl.stats.strainVented += actual;
  if (actual > 0) fireTrigger(s, p, 'onVent'); // engine event (Pressure)
  return actual;
}

// ---------- End of match ----------
function snapshot(s: GameState): void {
  const last = s.snapshots[s.snapshots.length - 1];
  const snap = { round: s.round, hp: [s.players[0].hp, s.players[1].hp] as [number, number], strain: [s.players[0].strain, s.players[1].strain] as [number, number] };
  if (last && last.round === s.round) s.snapshots[s.snapshots.length - 1] = snap;
  else s.snapshots.push(snap);
}

export function endMatch(s: GameState, winner: PlayerId | null, reason: string): void {
  s.phase = 'over';
  s.window = null;
  s.result = { winner, reason };
  snapshot(s);
  logMsg(s, 'end', winner, winner === null ? `Draw — ${reason}` : `${name(s, winner)} wins — ${reason}`);
}

export function endIfDead(s: GameState): boolean {
  if (s.phase === 'over') return true;
  const [a, b] = s.players;
  if (a.hp > 0 && b.hp > 0) return false;
  if (a.hp <= 0 && b.hp <= 0) {
    if (s.config.match.koTiebreak && a.strain !== b.strain) endMatch(s, a.strain < b.strain ? 0 : 1, `both Specimens reached 0 HP together; lower Strain wins (${a.strain} vs ${b.strain})`);
    else if (s.config.match.koTiebreak && a.stats.damageDealt !== b.stats.damageDealt) endMatch(s, a.stats.damageDealt > b.stats.damageDealt ? 0 : 1, `both Specimens reached 0 HP together; more total damage dealt wins (${a.stats.damageDealt} vs ${b.stats.damageDealt})`);
    else endMatch(s, null, 'both Specimens reached 0 HP at the same time');
  }
  else if (a.hp <= 0) endMatch(s, 1, `${a.name}'s Specimen reached 0 HP`);
  else endMatch(s, 0, `${b.name}'s Specimen reached 0 HP`);
  return true;
}

// ---------- Ops ----------
export interface OpCtx {
  caster: PlayerId;
  victim: PlayerId;
  play?: PendingPlay;
  source: string;
}

function pickGraft(s: GameState, victim: PlayerId, pick: 'random' | 'best' | 'engine'): AttachedGraft | undefined {
  let gs = s.players[victim].grafts;
  if (!gs.length) return undefined;
  if (pick === 'random') return gs[nextInt(s, gs.length)];
  // 'engine' (a jammer): the awake graft that is a payoff of the most engines; any graft if none is.
  if (pick === 'engine') {
    const payoffs = (g: AttachedGraft) => (g.faceDown ? 0 : (cardOf(g.cardId).engines ?? []).filter((t) => t.role === 'payoff').length);
    const top = Math.max(...gs.map(payoffs));
    if (top > 0) gs = gs.filter((g) => payoffs(g) === top);
  }
  return [...gs].sort((a, b) => {
    const ca = cardOf(a.cardId);
    const cb = cardOf(b.cardId);
    return cb.attack + cb.armor - (ca.attack + ca.armor) || b.strain - a.strain;
  })[0];
}

/** Append to the public play history (what each player can see being played). */
export function recordPlay(s: GameState, rec: Omit<PlayRecord, 'n' | 'round'>): void {
  s.plays.push({ n: s.plays.length, round: s.round, ...rec });
}

/** A card that stops being face-down becomes visible in the play history too. */
export function markRevealed(s: GameState, uid: string): void {
  for (const r of s.plays) if (r.uid === uid) r.faceDown = false;
}

/**
 * A face-down (Dormant) graft is asleep: no stats, no abilities. It wakes when its owner chooses to (`voluntary`),
 * or when the opponent forces it (Scanner Probe, Sabotage). Waking adds the Strain it saved by sleeping, fires its
 * on-attach text, and, if the owner chose it and the graft has slept through at least one round, Ambush.
 */
export function revealGraft(s: GameState, p: PlayerId, g: AttachedGraft, voluntary = false): void {
  if (!g.faceDown) return;
  const pl = s.players[p];
  g.faceDown = false;
  markRevealed(s, g.uid);
  const card = cardOf(g.cardId);
  logMsg(s, 'info', p, voluntary ? `${pl.name} wakes the graft in ${SLOT_LABEL[g.slot]}: ${card.name}.` : `${pl.name}'s face-down graft in ${SLOT_LABEL[g.slot]} is forced awake: ${card.name}.`);
  const debt = g.dormantStrain ?? 0;
  if (debt > 0) {
    g.strain += debt;
    addStrain(s, p, debt);
    logMsg(s, 'strain', p, `${card.name} wakes and adds the ${debt} Strain it saved.`, debt);
  }
  if (voluntary && (g.sleptSince ?? s.round) < s.round) ambush(s, p);
  fireAbilities(s, p, g, 'onAttach');
}

/** Ambush: the faction-specific burst for waking a graft on purpose after it has slept a round. */
export function ambush(s: GameState, p: PlayerId): void {
  const pl = s.players[p];
  const a = ambushOf(s.config, pl.faction);
  const parts: string[] = [];
  if (a.attack) {
    pl.tempAttack += a.attack;
    parts.push(`+${a.attack} attack`);
  }
  if (a.armor) {
    pl.tempArmor += a.armor;
    parts.push(`+${a.armor} armor`);
  }
  if (a.heal) {
    const h = heal(s, p, a.heal, 'Ambush');
    if (h > 0) parts.push(`heals ${h}`);
  }
  if (a.oppStrain) {
    addStrain(s, other(p), a.oppStrain);
    parts.push(`${s.players[other(p)].name} gains ${a.oppStrain} Strain`);
  }
  if (a.draw) {
    const n = drawCards(s, p, a.draw);
    if (n > 0) parts.push(`draws ${n}`);
  }
  logMsg(s, 'info', p, `AMBUSH: ${pl.name} ${parts.join(', ')} this round.`);
}
function sabotage(s: GameState, ctx: OpCtx, op: Extract<Op, { op: 'sabotage' }>): void {
  const victim = s.players[ctx.victim];
  const g = (op.pick ?? 'chosen') === 'chosen' ? victim.grafts.find((x) => x.slot === ctx.play?.target) : pickGraft(s, ctx.victim, op.pick as 'random' | 'best' | 'engine');
  if (!g) {
    logMsg(s, 'play', ctx.caster, `${ctx.source} finds no graft to target.`);
    return;
  }
  revealGraft(s, ctx.victim, g);
  const card = cardOf(g.cardId);
  const cfg = s.config.sabotage;
  const caster = s.players[ctx.caster];
  if (op.mode === 'sever') {
    destroyGraft(s, victim, g, 'severed', ctx.source);
    logMsg(s, 'play', ctx.caster, `${ctx.source} severs ${victim.name}'s ${card.name} from ${SLOT_LABEL[g.slot]}.`);
    const h = sumLoadoutParam(s, caster, 'severHeal');
    if (h > 0) heal(s, ctx.caster, h, 'a Sever');
  } else if (op.mode === 'poison') {
    g.poisoned = Math.max(g.poisoned, (op.rounds ?? cfg.poisonRounds) + sumLoadoutParam(s, caster, 'poisonRoundsBonus'));
    logMsg(s, 'play', ctx.caster, `${ctx.source} poisons ${victim.name}'s ${card.name}: it gives 0 stats for ${g.poisoned} round(s).`);
  } else if (op.mode === 'disable') {
    g.disabled = Math.max(g.disabled, (op.rounds ?? cfg.disableRounds) + sumLoadoutParam(s, caster, 'disableRoundsBonus'));
    logMsg(s, 'play', ctx.caster, `${ctx.source} disables ${victim.name}'s ${card.name}: its text is off for ${g.disabled} round(s).`);
  } else {
    // necrosis: sever the graft, and the empty slot itself cannot be refilled for a while.
    destroyGraft(s, victim, g, 'necrosed', ctx.source);
    const rounds = (op.rounds ?? cfg.necrosisRounds) + sumLoadoutParam(s, caster, 'necrosisRoundsBonus');
    victim.necrosis[g.slot] = Math.max(victim.necrosis[g.slot] ?? 0, rounds);
    if (ctx.caster !== ctx.victim) caster.stats.necrosisDealt++;
    logMsg(s, 'play', ctx.caster, `${ctx.source} necroses ${victim.name}'s ${card.name} from ${SLOT_LABEL[g.slot]}: the slot cannot be refilled for ${rounds} round(s).`);
    const v = sumLoadoutParam(s, caster, 'necrosisVent');
    if (v > 0) {
      const vented = vent(s, ctx.caster, v);
      if (vented > 0) logMsg(s, 'strain', ctx.caster, `${caster.name} vents ${vented} Strain (necrosis).`, -vented);
    }
    onGraftKilled(s, ctx.caster);
  }
}

/** The mechanical part of a graft leaving the board via Integrity loss: filter it out, discard it, and
 * remove its Strain if severRemovesStrain. Callers do their own logging and onGraftKilled call, in that
 * order, so log ordering stays exactly as it was before this was extracted. */
function destroyGraft(s: GameState, victim: PlayerState, g: AttachedGraft, why: 'destroyed' | 'severed' | 'necrosed', by: string): void {
  victim.grafts = victim.grafts.filter((x) => x !== g);
  toDiscard(s, victim, g, why, by);
  if (s.config.strain.severRemovesStrain) victim.strain = Math.max(0, victim.strain - g.strain);
}

/** Chips a graft's own small integrity pool (bypasses armor); destroys it at 0, separate from rejection. */
function graftDamage(s: GameState, ctx: OpCtx, op: Extract<Op, { op: 'graftDamage' }>): void {
  const victim = s.players[ctx.victim];
  // A played Sabotage hits its chosen target; a graft's ability hits the most worn-down awake enemy graft.
  const g = ctx.play ? victim.grafts.find((x) => x.slot === ctx.play?.target) : [...victim.grafts].filter((x) => !x.faceDown).sort((a, b) => a.integrity - b.integrity)[0];
  if (!g) {
    logMsg(s, 'play', ctx.caster, `${ctx.source} finds no graft to target.`);
    return;
  }
  revealGraft(s, ctx.victim, g);
  const card = cardOf(g.cardId);
  const caster = s.players[ctx.caster];
  const amount = Math.max(0, op.amount + sumLoadoutParam(s, caster, 'graftDamageBonus') - sumLoadoutParam(s, victim, 'graftDamageReduction'));
  g.integrity -= amount;
  if (g.integrity <= 0) {
    destroyGraft(s, victim, g, 'destroyed', ctx.source);
    logMsg(s, 'wear', ctx.caster, `${ctx.source} destroys ${victim.name}'s ${card.name} in ${SLOT_LABEL[g.slot]} (integrity depleted).`);
  } else {
    logMsg(s, 'wear', ctx.caster, `${ctx.source} hits ${victim.name}'s ${card.name} for ${amount} integrity (${g.integrity} left).`);
  }
  if (amount > 0) fireTrigger(s, ctx.caster, 'onWear'); // engine event (Dissolve)
  if (g.integrity <= 0) onGraftKilled(s, ctx.caster);
}

/** Clash damage itself now also wears down Integrity, not just Sabotage cards: some of a hit's force lands
 * on the graft absorbing it. Reuses the same graftDamageBonus/Reduction hooks as the `graftDamage` op, so
 * those nodes matter every round, not only when a Sabotage card happens to be drawn. */
function chipIntegrityFromClash(s: GameState, casterId: PlayerId, victimId: PlayerId, damage: number): void {
  const divisor = s.config.integrity.clashDamageDivisor;
  if (!divisor || damage <= 0) return;
  // Rounded up, so every damaging hit wears at least 1: flooring made most 1-3 damage hits wear nothing.
  const base = Math.ceil(damage / divisor);
  const victim = s.players[victimId];
  const caster = s.players[casterId];
  const awake = victim.grafts.filter((g) => !g.faceDown);
  if (!awake.length) return;
  const slotOrder = s.config.slots as string[];
  const g = [...awake].sort((a, b) => b.integrity - a.integrity || slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot))[0];
  const amount = Math.max(0, base + sumLoadoutParam(s, caster, 'graftDamageBonus') - sumLoadoutParam(s, victim, 'graftDamageReduction'));
  if (amount <= 0) return;
  revealGraft(s, victimId, g);
  const card = cardOf(g.cardId);
  g.integrity -= amount;
  if (g.integrity <= 0) {
    destroyGraft(s, victim, g, 'destroyed', 'Clash wear');
    logMsg(s, 'wear', casterId, `Clash wears down ${victim.name}'s ${card.name} in ${SLOT_LABEL[g.slot]}: it is destroyed (integrity depleted).`);
  } else {
    logMsg(s, 'wear', casterId, `Clash wears ${amount} integrity off ${victim.name}'s ${card.name} (${g.integrity} left).`);
  }
  // Clash wear is automatic, so it does not fire Dissolve (onWear): only cards and abilities do.
  if (g.integrity <= 0) onGraftKilled(s, casterId);
}

/** Chip nodes that pay off destroying a graft (via graftDamage, Clash wear, necrosis, or Sever). */
function onGraftKilled(s: GameState, casterId: PlayerId): void {
  const caster = s.players[casterId];
  const h = sumLoadoutParam(s, caster, 'killHeal');
  if (h > 0) heal(s, casterId, h, 'a graft kill');
  const st = sumLoadoutParam(s, caster, 'killStrain');
  if (st > 0) {
    addStrain(s, other(casterId), st);
    logMsg(s, 'strain', other(casterId), `${name(s, other(casterId))} gains ${st} Strain (a graft kill).`, st);
  }
  const ih = sumLoadoutParam(s, caster, 'killIntegrityHeal');
  if (ih > 0) runOps(s, [{ op: 'integrityHeal', amount: ih }], { caster: casterId, victim: other(casterId), source: 'a graft kill' });
  const dr = sumLoadoutParam(s, caster, 'killDraw');
  if (dr > 0) {
    const n = drawCards(s, casterId, dr);
    if (n > 0) logMsg(s, 'info', casterId, `${caster.name} draws ${n} card(s) (a graft kill).`);
  }
  fireTrigger(s, casterId, 'onKill'); // engine event (Carrion)
}

function applyStatus(s: GameState, ctx: OpCtx, op: Extract<Op, { op: 'status' }>): void {
  const cfg = s.config.status;
  const caster = s.players[ctx.caster];
  const t = s.players[(op.who ?? 'opp') === 'self' ? ctx.caster : ctx.victim];
  const hadIt = t[op.kind] > 0;
  if (op.kind === 'bleed') {
    // Stacking: a fresh Bleed starts at 1 stack; each re-application adds one (up to the cap) and refreshes it.
    t.bleedStacks = hadIt ? Math.min(Math.max(1, cfg.bleedMaxStacks), t.bleedStacks + 1) : 1;
    t.bleed = Math.max(t.bleed, (op.rounds ?? cfg.bleedRounds) + sumLoadoutParam(s, caster, 'bleedRoundsBonus'));
    const stacks = t.bleedStacks > 1 ? ` x${t.bleedStacks} (${cfg.bleedDamage * t.bleedStacks} damage a round)` : '';
    logMsg(s, 'strain', t.id, `${ctx.source}: ${t.name} is bleeding for ${t.bleed} round(s)${stacks}.`);
  } else if (op.kind === 'numb') {
    if (t.id !== caster.id) caster.stats.numbDealt++;
    t.numb = Math.max(t.numb, (op.rounds ?? cfg.numbRounds) + sumLoadoutParam(s, caster, 'numbRoundsBonus'));
    logMsg(s, 'info', t.id, `${ctx.source}: ${t.name} is numbed and cannot play Protocols for ${t.numb} round(s).`);
  } else {
    if (t.id !== caster.id) caster.stats.feverDealt++;
    t.fever = Math.max(t.fever, (op.rounds ?? cfg.feverRounds) + sumLoadoutParam(s, caster, 'feverRoundsBonus'));
    logMsg(s, 'info', t.id, `${ctx.source}: ${t.name}'s grafts cost ${cfg.feverCostIncrease} more Energy for ${t.fever} round(s) (Fever).`);
  }
  // Infect (Parasite's Build trait): a fresh affliction also loads Strain, so status-heavy World Factions feed
  // Parasite's Strain engine instead of diluting it. Refreshing a status the opponent already has does not.
  const infect = cfg.parasiteInfectStrain;
  if (infect > 0 && !hadIt && t.id !== caster.id && caster.faction === 'parasite') {
    addStrain(s, t.id, infect);
    logMsg(s, 'strain', t.id, `Infect: ${t.name} gains ${infect} Strain from the fresh affliction.`, infect);
  }
}

function purge(s: GameState, ctx: OpCtx, op: Extract<Op, { op: 'purge' }>): void {
  const self = (op.who ?? 'self') === 'self';
  const t = s.players[self ? ctx.caster : ctx.victim];
  t.bleed = 0;
  t.bleedStacks = 0;
  t.numb = 0;
  t.fever = 0;
  t.necrosis = {};
  logMsg(s, 'info', t.id, `${ctx.source}: ${t.name}'s statuses are purged.`);
  if (self) {
    const h = sumLoadoutParam(s, t, 'purgeHeal');
    if (h > 0) heal(s, t.id, h, 'Purge');
    const v = sumLoadoutParam(s, t, 'purgeVent');
    if (v > 0) {
      const vented = vent(s, t.id, v);
      if (vented > 0) logMsg(s, 'strain', t.id, `${t.name} vents ${vented} Strain (Purge).`, -vented);
    }
    const ih = sumLoadoutParam(s, t, 'purgeIntegrityHeal');
    if (ih > 0) runOps(s, [{ op: 'integrityHeal', amount: ih }], { caster: t.id, victim: other(t.id), source: 'Purge' });
    fireTrigger(s, t.id, 'onPurge'); // engine event (Cleanse)
  }
}

/** Heals integrity on every graft the caster controls (not just awake ones - matches integrityRegen and
 * the cards' own "every graft you control" text), capped at each graft's own max + flatIntegrity. */
function integrityHeal(s: GameState, ctx: OpCtx, op: Extract<Op, { op: 'integrityHeal' }>): void {
  const pl = s.players[ctx.caster];
  const bonus = sumLoadoutParam(s, pl, 'flatIntegrity');
  let healed = 0;
  for (const g of pl.grafts) {
    const cap = (cardOf(g.cardId).integrity ?? s.config.integrity.default) + bonus;
    const before = g.integrity;
    g.integrity = Math.min(cap, g.integrity + op.amount);
    healed += g.integrity - before;
  }
  if (healed > 0) {
    logMsg(s, 'info', ctx.caster, `${ctx.source}: ${pl.name} heals ${healed} integrity across their grafts.`);
    fireTrigger(s, ctx.caster, 'onRepair'); // engine event (Renewal)
  }
}

export function runOps(s: GameState, ops: Op[], ctx: OpCtx): void {
  const pid = (w: 'self' | 'opp' | undefined, def: 'self' | 'opp'): PlayerId => ((w ?? def) === 'self' ? ctx.caster : ctx.victim);
  for (const op of ops) {
    if (s.phase === 'over') return;
    switch (op.op) {
      case 'heal':
        heal(s, ctx.caster, op.amount, ctx.source);
        break;
      case 'damage': {
        const t = pid(op.who, 'opp');
        hurt(s, t, op.amount, t === ctx.caster ? null : ctx.caster, ctx.source);
        break;
      }
      case 'strain': {
        const t = pid(op.who, 'opp');
        addStrain(s, t, op.amount);
        if (op.amount > 0) logMsg(s, 'strain', t, `${name(s, t)} gains ${op.amount} Strain (${ctx.source}).`, op.amount);
        break;
      }
      case 'vent': {
        const v = vent(s, ctx.caster, op.amount);
        if (v > 0) logMsg(s, 'strain', ctx.caster, `${name(s, ctx.caster)} vents ${v} Strain (${ctx.source}).`, -v);
        break;
      }
      case 'draw': {
        const n = drawCards(s, ctx.caster, op.amount);
        logMsg(s, 'info', ctx.caster, `${name(s, ctx.caster)} draws ${n} card(s) (${ctx.source}).`);
        break;
      }
      case 'discard': {
        const t = pid(op.who, 'opp');
        const pl = s.players[t];
        for (let i = 0; i < op.amount && pl.hand.length; i++) toDiscard(s, pl, pl.hand.splice(nextInt(s, pl.hand.length), 1)[0], 'discarded', ctx.source);
        logMsg(s, 'info', t, `${pl.name} discards ${op.amount} random card(s) (${ctx.source}).`);
        break;
      }
      case 'energy':
        s.players[ctx.caster].energy += op.amount;
        logMsg(s, 'info', ctx.caster, `${name(s, ctx.caster)} gains ${op.amount} Energy (${ctx.source}).`);
        break;
      case 'drain': {
        const pl = s.players[ctx.victim];
        if (s.actionsClosed) {
          // This round's Energy is already spent or about to be reset, so the drain comes off next round's refill.
          pl.energyDebt += op.amount;
          logMsg(s, 'info', ctx.victim, `${pl.name} will lose ${op.amount} Energy next round (${ctx.source}).`);
        } else {
          const lost = Math.min(op.amount, pl.energy);
          pl.energy -= lost;
          if (ctx.caster !== ctx.victim) s.players[ctx.caster].stats.energyDrained += lost;
          logMsg(s, 'info', ctx.victim, lost > 0 ? `${pl.name} loses ${lost} Energy (${ctx.source}).` : `${pl.name} has no Energy left to lose (${ctx.source}).`);
        }
        if (ctx.caster !== ctx.victim) fireTrigger(s, ctx.caster, 'onDrain'); // engine event (Starvation)
        break;
      }
      case 'buff': {
        const t = s.players[pid(op.who, 'self')];
        if (op.stat === 'attack') t.tempAttack += op.amount;
        else t.tempArmor += op.amount;
        logMsg(s, 'info', t.id, `${t.name} gets ${op.amount >= 0 ? '+' : ''}${op.amount} ${op.stat} this round (${ctx.source}).`);
        break;
      }
      case 'sabotage':
        sabotage(s, ctx, op);
        break;
      case 'reveal': {
        const g = s.players[ctx.victim].grafts.find((x) => x.slot === ctx.play?.target);
        if (g) revealGraft(s, ctx.victim, g);
        break;
      }
      case 'negate':
        if (ctx.play) ctx.play.negated = true;
        break;
      case 'reflect':
        if (ctx.play) ctx.play.reflected = true;
        break;
      case 'mod':
        break; // passive only, evaluated in computeStats
      case 'graftDamage':
        graftDamage(s, ctx, op);
        break;
      case 'status':
        applyStatus(s, ctx, op);
        break;
      case 'purge':
        purge(s, ctx, op);
        break;
      case 'integrityHeal':
        integrityHeal(s, ctx, op);
        break;
    }
  }
}

export function fireAbilities(s: GameState, p: PlayerId, g: AttachedGraft, trigger: Trigger): void {
  if (g.disabled > 0 || g.faceDown) return; // a sleeping graft does nothing
  const card = cardOf(g.cardId);
  (card.effect.abilities ?? ([] as Ability[])).forEach((ab, i) => {
    if (ab.trigger !== trigger || !condOk(s, s.players[p], ab.cond)) return;
    if (ab.perRound) {
      // Engine payoffs fire a limited number of times per round.
      const fired = (g.fired ??= {});
      if ((fired[i] ?? 0) >= ab.perRound) return;
      fired[i] = (fired[i] ?? 0) + 1;
    }
    // An engine payoff firing: counted per engine, and logged with the graft so the board can show it.
    const engine = trigger === 'onAttach' ? null : engineOfAbility(card, ab);
    if (engine) {
      const st = s.players[p].stats;
      st.engineFires++;
      st.engineFiresBy[engine] = (st.engineFiresBy[engine] ?? 0) + 1;
      s.log.push({ n: s.log.length, round: s.round, kind: 'engine', player: p, text: `⚙ ${card.name} fires.`, uid: g.uid, engine });
    }
    // Amplify (a Chip's engine node): +N to the payoff's main number. Not on attach effects.
    const amp = trigger === 'onAttach' ? 0 : engineAmp(s, s.players[p], card);
    let ops = ab.ops;
    if (amp > 0) {
      const k = ops.findIndex((o) => 'amount' in o);
      if (k >= 0) ops = ops.map((o, j) => (j === k ? ({ ...o, amount: (o as { amount: number }).amount + amp } as typeof o) : o));
    }
    runOps(s, ops, { caster: p, victim: other(p), source: card.name });
  });
}

/** Which engine a payoff ability belongs to: its card's only payoff engine, or (a Mastery card, a payoff of
 * three) the one its trigger or condition belongs to. Null for abilities that are not engine payoffs. */
const TRIGGER_ENGINE: Partial<Record<Trigger, EngineId>> = {
  onGainStrain: 'frenzy',
  onOppGainStrain: 'feed',
  onVent: 'pressure',
  onDrain: 'starvation',
  onRepair: 'renewal',
  onKill: 'carrion',
  onOppReject: 'overload',
  onBlock: 'fortress',
  onWear: 'dissolve',
  onPurge: 'cleanse',
  onBigHit: 'overkill',
  onAttachGraft: 'brood',
  onOppFeverGraft: 'feverBurn',
  onProtocol: 'ward',
};
const COND_ENGINE: Record<string, EngineId> = { oppStatusesAtLeast: 'doubleDose', discardAtLeast: 'grave', graftsAtLeast: 'endurance', oppHas: 'silence', oppEnergyAtMost: 'starvation' };
export function engineOfAbility(card: CardDef, ab: Ability): EngineId | null {
  const payoffs = (card.engines ?? []).filter((t) => t.role === 'payoff').map((t) => t.id);
  if (!payoffs.length || ab.trigger === 'passive') return null;
  // An engine event or engine condition names the engine; otherwise a capped ability on a single-engine payoff is
  // that engine's. (An uncapped, unconditional ability, like a round-start heal, is not an engine firing.)
  const byTrigger = TRIGGER_ENGINE[ab.trigger];
  if (byTrigger && payoffs.includes(byTrigger)) return byTrigger;
  for (const k of Object.keys(ab.cond ?? {})) if (COND_ENGINE[k] && payoffs.includes(COND_ENGINE[k])) return COND_ENGINE[k];
  if (payoffs.length === 1 && (ab.perRound || ab.cond)) return payoffs[0];
  return null;
}

// Engine events can set each other off (a vent that damages, damage that strains...). Per-round caps bound
// every loop anyway; this depth limit is a second guard so a chain never recurses deeply.
let triggerDepth = 0;
const MAX_TRIGGER_DEPTH = 4;

export function fireTrigger(s: GameState, p: PlayerId, trigger: Trigger): void {
  if (triggerDepth >= MAX_TRIGGER_DEPTH) return;
  triggerDepth++;
  try {
    for (const g of [...s.players[p].grafts]) {
      if (s.phase === 'over') return;
      fireAbilities(s, p, g, trigger);
    }
  } finally {
    triggerDepth--;
  }
}

// ---------- Playing cards ----------
export function attachGraft(s: GameState, p: PlayerId, card: CardInstance, slot: SlotId, faceDown: boolean): void {
  const pl = s.players[p];
  const def = cardOf(card.cardId);
  const strain = graftStrain(pl, def);
  const quiet = faceDown ? Math.min(strain, s.config.dormant.quietStrain) : 0; // a sleeping graft is quieter; the rest comes on waking
  const g: AttachedGraft = {
    uid: card.uid,
    cardId: card.cardId,
    slot,
    strain: strain - quiet,
    seq: ++s.graftSeq,
    faceDown,
    poisoned: 0,
    disabled: 0,
    dormantStrain: quiet,
    sleptSince: s.round,
    roundsSurvived: 0,
    integrity: (def.integrity ?? s.config.integrity.default) + sumLoadoutParam(s, pl, 'flatIntegrity'),
  };
  pl.grafts.push(g);
  pl.firstGraftDone = true;
  pl.attachedThisRound++;
  pl.stats.graftsPlayed++;
  addStrain(s, p, g.strain);
  logMsg(s, 'play', p, faceDown ? `${pl.name} attaches a face-down graft to ${SLOT_LABEL[slot]} (+${g.strain} Strain).` : `${pl.name} attaches ${def.name} to ${SLOT_LABEL[slot]} (+${g.strain} Strain).`);
  fireAbilities(s, p, g, 'onAttach');
  fireTrigger(s, p, 'onAttachGraft'); // engine event (Brood)
  if (pl.fever > 0) fireTrigger(s, other(p), 'onOppFeverGraft'); // engine event (Fever burn)
}

export function resolvePlay(s: GameState, play: PendingPlay): void {
  const p = play.player;
  const pl = s.players[p];
  const def = cardOf(play.card.cardId);
  if (play.negated) {
    toDiscard(s, pl, play.card, 'negated');
    logMsg(s, 'play', p, `${def.name} is negated.`);
    for (const r of s.plays) if (r.uid === play.card.uid) r.negated = true;
    markRevealed(s, play.card.uid); // a negated card is spent in public
    return;
  }
  if (def.type === 'graft') {
    if (!play.slot) {
      toDiscard(s, pl, play.card, 'noRoom');
      logMsg(s, 'play', p, `${def.name} has no room and is discarded.`);
      return;
    }
    const old = pl.grafts.find((g) => g.slot === play.slot);
    if (old && s.config.replace.enabled) {
      // Overgrowth: the new graft replaces the old one, which is discarded along with the Strain it had added.
      pl.grafts = pl.grafts.filter((g) => g !== old);
      toDiscard(s, pl, old, 'replaced', def.name);
      markRevealed(s, old.uid);
      pl.strain = Math.max(0, pl.strain - old.strain);
      logMsg(s, 'play', p, `${pl.name} replaces ${cardOf(old.cardId).name} in ${SLOT_LABEL[old.slot]} (-${old.strain} Strain).`);
    } else if (old) {
      toDiscard(s, pl, play.card, 'noRoom');
      logMsg(s, 'play', p, `${def.name} has no room and is discarded.`);
      return;
    }
    attachGraft(s, p, play.card, play.slot, !!play.faceDown);
    return;
  }
  const victim = play.reflected ? p : other(p);
  addStrain(s, p, def.strain);
  if (def.strain > 0) logMsg(s, 'strain', p, `${pl.name} gains ${def.strain} Strain (${def.name}).`, def.strain);
  if (play.reflected) {
    logMsg(s, 'play', p, `${def.name} is reflected back at ${pl.name}!`);
    for (const r of s.plays) if (r.uid === play.card.uid) r.reflected = true;
  }
  // A Protocol reacting to something (play.against set) points its ops at what it answered, not at itself.
  runOps(s, def.effect.ops ?? [], { caster: p, victim, play: play.against ?? play, source: def.name });
  if (def.type === 'toxin') {
    const drain = evoNum(s, pl, 'toxinDrain');
    if (drain > 0) hurt(s, victim, drain, victim === p ? null : p, `${def.name} drains`);
  }
  toDiscard(s, pl, play.card, 'played');
}

// ---------- Round flow ----------
export function beginRound(s: GameState): void {
  const cfg = s.config;
  s.round++;
  logMsg(s, 'round', null, `Round ${s.round}`);
  for (const pl of s.players) {
    pl.hold = false;
    pl.cycledThisRound = 0;
    pl.stance = null;
    pl.rejectedThisRound = false;
    pl.attachedThisRound = 0;
    pl.tempAttack = 0;
    pl.tempArmor = 0;
    for (const g of pl.grafts) g.fired = {}; // engine abilities' per-round caps start fresh
  }
  for (const pl of s.players) {
    const late = s.round >= cfg.match.lateDrawFromRound ? cfg.match.lateDraw : 0; // the late game is card-starved, so draw more
    const firstRoundBonus = s.round === 1 ? sumLoadoutParam(s, pl, 'firstDrawRoundBonus') : 0;
    drawCards(s, pl.id, cfg.match.drawPerRound + late + firstRoundBonus);
    if (late > 0 && s.round === cfg.match.lateDrawFromRound) logMsg(s, 'info', pl.id, `Late game: ${pl.name} now draws ${cfg.match.drawPerRound + late} cards a round.`);
    // energyRampBonus fires exactly on the round the floor (energy.min) stops naturally binding, so round 2
    // does not tie round 1's floored value - a one-round plateau, not a curve reshape.
    const ramp = s.round === cfg.energy.min ? cfg.match.energyRampBonus : 0;
    pl.energy = Math.max(cfg.energy.min, Math.min(s.round, cfg.energy.cap)) + ramp + (cfg.features.energyBanking ? pl.bank : 0);
    pl.bank = 0;
    if (!pl.attachedLastRound) {
      const v = vent(s, pl.id, cfg.strain.ventPerRound);
      if (v > 0) logMsg(s, 'strain', pl.id, `${pl.name} vents ${v} Strain (no graft last round).`, -v);
    }
    const regen = sumLoadoutParam(s, pl, 'integrityRegen');
    if (regen > 0) {
      let healed = 0;
      for (const g of pl.grafts) {
        const before = g.integrity;
        g.integrity = Math.min((cardOf(g.cardId).integrity ?? cfg.integrity.default) + sumLoadoutParam(s, pl, 'flatIntegrity'), g.integrity + regen);
        healed += g.integrity - before;
      }
      if (healed > 0) fireTrigger(s, pl.id, 'onRepair'); // engine event (Renewal)
    }
  }
  // Comeback: the Specimen that has taken well more damage this match draws extra and gets a little extra
  // Energy, so an early lead does not decide the match alone. Damage counts from each Specimen's own starting
  // HP, so a smaller Specimen (a lower max HP, or HP carried in from an earlier fight) isn't "behind" just
  // for being smaller.
  const [pa, pb] = s.players;
  const start = s.snapshots[0]?.hp ?? [pa.maxHp, pb.maxHp];
  const lostA = start[0] - pa.hp;
  const lostB = start[1] - pb.hp;
  if ((cfg.match.catchUpDraw > 0 || cfg.match.catchUpEnergy > 0) && Math.abs(lostA - lostB) >= cfg.match.catchUpHpGap) {
    const trailing = lostA > lostB ? pa : pb;
    const n = drawCards(s, trailing.id, cfg.match.catchUpDraw);
    if (cfg.match.catchUpEnergy > 0) trailing.energy += cfg.match.catchUpEnergy;
    const extraEnergy = cfg.match.catchUpEnergy > 0 ? `, +${cfg.match.catchUpEnergy} Energy` : '';
    if (n > 0 || cfg.match.catchUpEnergy > 0) logMsg(s, 'info', trailing.id, `Second wind: ${trailing.name} has taken ${Math.abs(lostA - lostB)} more damage and draws ${n} extra card(s)${extraEnergy}.`);
  }
  // Drains that landed after last round's actions come off the fresh Energy now.
  s.actionsClosed = false;
  for (const pl of s.players) {
    if (pl.energyDebt <= 0) continue;
    const lost = Math.min(pl.energyDebt, pl.energy);
    pl.energy -= lost;
    s.players[other(pl.id)].stats.energyDrained += lost; // a debt only ever comes from the opponent's drains
    logMsg(s, 'info', pl.id, `${pl.name} starts the round ${lost} Energy down (drained last round).`);
    pl.energyDebt = 0;
  }
  if (s.round >= cfg.match.meltdownFromRound) {
    for (const pl of s.players) addStrain(s, pl.id, cfg.match.meltdownStrain);
    logMsg(s, 'strain', null, `Meltdown! Both Specimens gain ${cfg.match.meltdownStrain} Strain.`, cfg.match.meltdownStrain);
  }
  for (const pl of s.players) fireTrigger(s, pl.id, 'onRoundStart');
  if (endIfDead(s)) return;
  s.phase = 'stance';
  s.stanceResult = null;
}

const STANCE_NAME = { aggress: 'Aggress', adapt: 'Adapt', fortify: 'Fortify' } as const;

/** Called once both stances are picked (and any Feint decisions are done). */
export function resolveStances(s: GameState): void {
  const [a, b] = s.players;
  const sa = a.stance!;
  const sb = b.stance!;
  a.stanceHistory.push(sa);
  b.stanceHistory.push(sb);
  const winner: PlayerId | null = beats(sa, sb) ? 0 : beats(sb, sa) ? 1 : null;
  s.stanceResult = { winner };
  logMsg(s, 'stance', null, `Stances revealed: ${a.name} ${STANCE_NAME[sa]}, ${b.name} ${STANCE_NAME[sb]}. ${winner === null ? 'Tie.' : `${name(s, winner)} wins the stance.`}`);
  s.initiative = winner ?? other(s.lastInitiative);
  s.lastInitiative = s.initiative;
  if (s.round === 1 && s.config.match.secondMoverEnergy > 0) {
    const second = s.players[other(s.initiative)];
    second.energy += s.config.match.secondMoverEnergy;
    logMsg(s, 'info', second.id, `${second.name} acts second in round 1 and gets ${s.config.match.secondMoverEnergy} extra Energy.`);
  }
  if (s.round === 1 && s.config.match.secondMoverDraw > 0) {
    const second = s.players[other(s.initiative)];
    const n = drawCards(s, second.id, s.config.match.secondMoverDraw);
    if (n > 0) logMsg(s, 'info', second.id, `${second.name} acts second in round 1 and draws ${n} extra card(s).`);
  }
  s.phase = 'actions';
  s.turn = s.initiative;
  s.passStreak = 0;
  s.actionCount = 0;
  s.window = null;
  s.feintQueue = [];
  logMsg(s, 'info', s.initiative, `${name(s, s.initiative)} acts first.`);
}

export function afterStancesPicked(s: GameState): void {
  const [a, b] = s.players;
  if (a.stance === b.stance) {
    const order: PlayerId[] = [other(s.lastInitiative), s.lastInitiative];
    s.feintQueue = order.filter((p) => hasNode(s.players[p], 'feint') && !s.players[p].feintUsed);
    if (s.feintQueue.length) {
      s.phase = 'feint';
      logMsg(s, 'stance', null, `Stances tie on ${STANCE_NAME[a.stance!]}. ${name(s, s.feintQueue[0])} may Feint.`);
      return;
    }
  }
  resolveStances(s);
}

// ---------- Clash ----------
interface ClashResult {
  damage: number;
  prevented: number;
  notes: string[];
}

function clashDamage(s: GameState, atk: PlayerId): ClashResult {
  const cfg = s.config;
  const A = s.players[atk];
  const D = s.players[other(atk)];
  const notes: string[] = [];
  if (A.hold) return { damage: 0, prevented: 0, notes: ['holding'] };
  const sa = A.stance!;
  const sd = D.stance!;
  const stA = computeStats(s, A);
  const stD = computeStats(s, D);
  let mods = 0;
  if (zoneOf(s, A) === 'overclocked') {
    const b = overclockBonus(s, A);
    mods += b;
    notes.push(`+${b} Overclocked`);
  }
  const mom = momentum(s, A) ? cfg.stances.momentumBonus : 0;
  const aWins = beats(sa, sd);
  if (aWins && sa === 'aggress') {
    mods += cfg.stances.aggressBeatsAdaptBonus + mom;
    notes.push(`+${cfg.stances.aggressBeatsAdaptBonus + mom} Aggress`);
  }
  if (aWins && sa === 'adapt' && mom) {
    mods += mom;
    notes.push(`+${mom} momentum`);
  }
  let armor = stD.armor;
  if (aWins && sa === 'adapt') {
    armor = 0;
    notes.push('ignores armor');
  }
  const raw = Math.max(0, stA.attack + mods);
  let dmg = Math.max(0, raw - armor);
  let prevented = raw - dmg;
  if (sd === 'fortify' && sa === 'aggress' && !evoFlag(s, A, 'ignoreFortifyHalving')) {
    const halved = Math.floor(dmg / cfg.stances.fortifyDamageDivisor);
    prevented += dmg - halved;
    dmg = halved;
    notes.push('halved by Fortify');
  }
  return { damage: dmg, prevented, notes };
}

/**
 * What the coming Clash would do if it happened now: the HP each Specimen would lose (after armor, stances,
 * Fortify counters and Clash heals), from a throwaway copy of the state. Plays still to come can change it.
 */
export function previewClash(s: GameState): [number, number] {
  // Copy without the match's history (log, actions, plays): it grows all match long and the Clash only
  // appends to it, so leaving it out makes the copy several times cheaper late in a match.
  const c = JSON.parse(JSON.stringify({ ...s, log: [], history: [], plays: [] })) as GameState;
  const before = [c.players[0].hp, c.players[1].hp];
  clash(c);
  return [Math.max(0, before[0] - c.players[0].hp), Math.max(0, before[1] - c.players[1].hp)];
}

export function clash(s: GameState): void {
  const cfg = s.config;
  const r0 = clashDamage(s, 0);
  const r1 = clashDamage(s, 1);
  const res = [r0, r1];
  const counters: [number, number] = [0, 0]; // counter damage dealt BY player i
  const heals: [number, number] = [0, 0];
  for (const i of [0, 1] as PlayerId[]) {
    const D = s.players[i];
    const A = s.players[other(i)];
    // D fortifies against A's Aggress: block succeeds
    if (D.stance === 'fortify' && A.stance === 'aggress') {
      counters[i] = cfg.stances.fortifyCounterDamage + (momentum(s, D) ? cfg.stances.momentumBonus : 0);
    }
  }
  const dealt: [number, number] = [0, 0];
  for (const i of [0, 1] as PlayerId[]) {
    const target = other(i);
    const r = res[i];
    dealt[i] = r.damage;
    const T = s.players[target];
    T.hp = Math.max(0, T.hp - r.damage);
    T.stats.damageTaken += r.damage;
    s.players[i].stats.damageDealt += r.damage;
    T.stats.damageBlocked += r.prevented;
    const note = r.notes.length ? ` (${r.notes.join(', ')})` : '';
    if (r.notes[0] === 'holding') logMsg(s, 'damage', target, `${name(s, i)} holds and deals no Clash damage.`);
    else logMsg(s, r.damage >= cfg.ui.bigHitThreshold ? 'hit' : 'damage', target, `Clash: ${name(s, i)} hits ${name(s, target)} for ${r.damage}${note}.`, r.damage);
  }
  for (const i of [0, 1] as PlayerId[]) {
    if (counters[i] > 0) hurt(s, other(i), counters[i], i, 'Fortify counter');
    if (heals[i] > 0) heal(s, i, heals[i], 'Siphon');
  }
  if (endIfDead(s)) return;
  // Clash also wears down Integrity: combine everything a side took this round (main exchange + Fortify
  // counter, always from the same opponent) into one chip, rather than flooring twice and often rounding to 0.
  for (const p of [0, 1] as PlayerId[]) {
    const taken = res[other(p)].damage + counters[other(p)];
    if (taken > 0) chipIntegrityFromClash(s, other(p), p, taken);
  }
  for (const i of [0, 1] as PlayerId[]) {
    if (dealt[i] > 0) fireTrigger(s, i, 'onDealDamage');
    if (dealt[other(i)] > 0) fireTrigger(s, i, 'onTakeDamage');
    // Engine event (Fortress): i's armor stopped a big chunk of the other side's hit.
    if (res[other(i)].prevented >= cfg.engines.blockThreshold) fireTrigger(s, i, 'onBlock');
    // Engine event (Overkill): i landed a big hit.
    if (dealt[i] >= cfg.engines.bigHitThreshold) fireTrigger(s, i, 'onBigHit');
  }
  endIfDead(s);
}

// ---------- Strain check ----------
export function rejectGraft(s: GameState, p: PlayerId): boolean {
  const pl = s.players[p];
  if (!pl.grafts.length) {
    // Nothing to eject, but the Specimen still rejects: it counts for evolution conditions (Hive Host, Frenzy)
    // and stats. Graft-based effects (Burnout, Feedback, Hive Host's heal) need an actual ejected graft.
    pl.stats.rejectionsSuffered++;
    pl.rejectedThisRound = true;
    logMsg(s, 'reject', p, `REJECTION: ${pl.name} has no graft to eject, but the Specimen still rejects.`);
    return false;
  }
  const g = [...pl.grafts].sort((a, b) => b.strain - a.strain || b.seq - a.seq)[0];
  const card = cardOf(g.cardId);
  pl.grafts = pl.grafts.filter((x) => x !== g);
  toDiscard(s, pl, g, 'rejected', 'Strain check');
  markRevealed(s, g.uid); // an ejected graft is shown to everyone
  pl.strain = Math.max(0, pl.strain - g.strain);
  pl.stats.rejectionsSuffered++;
  pl.rejectedThisRound = true;
  logMsg(s, 'reject', p, `REJECTION: ${pl.name} ejects ${card.name} from ${SLOT_LABEL[g.slot]} (-${g.strain} Strain).`, g.strain);
  if (g.disabled <= 0 && !g.faceDown) {
    for (const ab of card.effect.abilities ?? []) {
      if (ab.trigger === 'onReject' && condOk(s, pl, ab.cond)) runOps(s, ab.ops, { caster: p, victim: other(p), source: card.name });
    }
  }
  const opp = s.players[other(p)];
  const hh = evoNum(s, opp, 'healOnOppReject');
  if (hh > 0) heal(s, other(p), hh, 'Hive Host');
  fireTrigger(s, other(p), 'onOppReject'); // engine event (Overload)
  return true;
}

export function evolve(s: GameState, p: PlayerId, id: string): void {
  const pl = s.players[p];
  const def = evolutionDefs(s, pl).find((d) => d.id === id)!;
  pl.evolution = id;
  pl.evolutionOptions = [];
  logMsg(s, 'evolve', p, `EVOLUTION: ${pl.name} evolves into ${def.name}!`);
}

export function finishRound(s: GameState): void {
  for (const pl of s.players) {
    for (const g of pl.grafts) {
      if (g.poisoned > 0) g.poisoned--;
      if (g.disabled > 0) g.disabled--;
    }
    if (pl.numb > 0) pl.numb--;
    if (pl.fever > 0) pl.fever--;
    for (const slot of Object.keys(pl.necrosis) as SlotId[]) {
      const left = (pl.necrosis[slot] ?? 0) - 1;
      if (left > 0) pl.necrosis[slot] = left;
      else delete pl.necrosis[slot];
    }
    pl.tempAttack = 0;
    pl.tempArmor = 0;
    pl.bank = s.config.features.energyBanking ? Math.min(pl.energy, s.config.energy.bankMax) : 0;
    pl.attachedLastRound = pl.attachedThisRound > 0;
  }
  snapshot(s);
  if (s.round >= s.config.match.maxRounds) {
    const [a, b] = s.players;
    if (a.hp !== b.hp) endMatch(s, a.hp > b.hp ? 0 : 1, `higher HP after round ${s.round} (${a.hp} vs ${b.hp})`);
    else if (a.strain !== b.strain) endMatch(s, a.strain < b.strain ? 0 : 1, `equal HP; lower Strain wins (${a.strain} vs ${b.strain})`);
    else endMatch(s, null, 'equal HP and equal Strain');
    return;
  }
  beginRound(s);
}

export function strainCheck(s: GameState): void {
  const cfg = s.config;
  const T = cfg.strain.threshold;
  const ids: PlayerId[] = [0, 1];
  // Bleed: bleedDamage per stack each round while it lasts, ticking down independent of Strain.
  for (const p of ids) {
    const pl = s.players[p];
    if (pl.bleed <= 0) continue;
    hurt(s, p, cfg.status.bleedDamage * Math.max(1, pl.bleedStacks), null, 'Bleed');
    pl.bleed--;
    if (pl.bleed === 0) pl.bleedStacks = 0;
  }
  if (endIfDead(s)) return;
  // 1. Overclock self-damage
  for (const p of ids) {
    const pl = s.players[p];
    if (zoneOf(s, pl) !== 'overclocked') continue;
    hurt(s, p, cfg.strain.overclockSelfDamage, null, 'Overclocked');
  }
  if (endIfDead(s)) return;
  // 2. Venting (Fortify, Hold)
  for (const p of ids) {
    const pl = s.players[p];
    let amount = 0;
    if (pl.stance === 'fortify') amount += Math.max(cfg.strain.fortifyVent, evoNum(s, pl, 'fortifyVent')) + (momentum(s, pl) ? cfg.stances.momentumBonus : 0);
    if (pl.hold) amount += cfg.strain.holdVent + sumLoadoutParam(s, pl, 'holdVentBonus');
    if (amount > 0) {
      const v = vent(s, p, amount);
      if (v > 0) logMsg(s, 'strain', p, `${pl.name} vents ${v} Strain.`, -v);
    }
  }
  // 3. Rejection (decided simultaneously)
  const rejecting = ids.filter((p) => s.players[p].strain > T);
  for (const p of rejecting) rejectGraft(s, p);
  if (endIfDead(s)) return;
  // 3a. Integration (Z): a Specimen that is not settled (Overclocked or worse) loses its most worn-down awake
  // graft into Z, which heals. Staying Stable is the only defence.
  for (const p of ids) {
    const pl = s.players[p];
    if (!pl.integrates) continue;
    const o = s.players[other(p)];
    if (zoneOf(s, o) === 'stable') continue;
    const g = [...o.grafts].filter((x) => !x.faceDown).sort((a, b) => a.integrity - b.integrity || b.seq - a.seq)[0];
    if (!g) continue;
    const card = cardOf(g.cardId);
    destroyGraft(s, o, g, 'destroyed', pl.name);
    const h = heal(s, p, cfg.z.integrateHeal, 'integration');
    logMsg(s, 'wear', p, `${pl.name} integrates ${o.name}'s ${card.name}: their Specimen was not settled${h > 0 ? ` (${pl.name} heals ${h})` : ''}.`);
  }
  // 3b. End-of-check text (graft "Strain check" abilities)
  for (const p of ids) {
    const pl = s.players[p];
    fireTrigger(s, p, 'onStrainCheck');
    // Veterancy: any graft still attached survived this check. Only Signature grafts spend it (see computeStats),
    // but every graft counts so a graft that starts as a tech slot and gets replaced never confuses the count.
    for (const g of pl.grafts) {
      g.roundsSurvived++;
      const def = cardOf(g.cardId);
      const rank = veteranRank(s, pl, g);
      const was = veteranRank(s, pl, { cardId: g.cardId, roundsSurvived: g.roundsSurvived - 1 });
      if (rank === 1 && was === 0) logMsg(s, 'info', p, `Veterancy: ${def.name} has held on through ${g.roundsSurvived} Strain checks and hardens (+${cfg.veterancy.signatureAttackBonus} attack).`);
      if (rank === 2 && was < 2) logMsg(s, 'info', p, `Elite: ${def.name} has held on through ${g.roundsSurvived} Strain checks and becomes Elite (+${cfg.veterancy.eliteAttackBonus} more attack, +${cfg.veterancy.eliteArmorBonus} armor).`);
    }
  }
  if (endIfDead(s)) return;
  // 4. Evolution triggers (decided simultaneously). Meeting a condition is always offered as a choice: evolve
  // now, or hold off (the same or a newly-met condition is offered again at the next Strain check).
  const eligible = ids.map((p) => {
    const pl = s.players[p];
    if (pl.evolution) return [] as string[];
    return evolutionDefs(s, pl)
      .filter((d) => metricValue(s, pl, d.condition.metric) >= evolutionTarget(pl, d))
      .map((d) => d.id);
  });
  s.evoQueue = [];
  // Deferred choice: the offer stands (and play goes on) until the player evolves, declines, or the next
  // Strain check re-reads the conditions. Otherwise the match pauses in the 'evolve' phase for the choice.
  const deferred = cfg.evolution.deferredChoice;
  for (const p of ids) {
    const pl = s.players[p];
    const was = pl.evolutionOptions.join(',');
    if (deferred && !pl.evolution) pl.evolutionOptions = eligible[p];
    if (!eligible[p].length) continue;
    pl.evolutionOptions = eligible[p];
    if (!deferred) s.evoQueue.push(p);
    else if (was === eligible[p].join(',')) continue; // still on offer: no need to announce it again
    if (eligible[p].length > 1) logMsg(s, 'evolve', p, `${name(s, p)} meets both evolution conditions: choose one, or hold off.`);
    else {
      const def = evolutionDefs(s, pl).find((d) => d.id === eligible[p][0])!;
      logMsg(s, 'evolve', p, `${name(s, p)}'s condition for ${def.name} is met: evolve now, or hold off?`);
    }
  }
  if (s.evoQueue.length) {
    s.phase = 'evolve';
    return;
  }
  finishRound(s);
}

export function shuffleDeck(s: GameState, p: PlayerId): void {
  shuffleInPlace(s, s.players[p].deck);
}
