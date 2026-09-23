// Mutating rule implementations. Every function here receives an immer draft (or any
// mutable GameState) and is only called from the reducer.
import { ambushOf, cardOf } from './data';
import { nextInt, shuffleInPlace } from './rng';
import {
  beats,
  computeStats,
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
  zoneOf,
} from './stats';
import type { Ability, AttachedGraft, CardInstance, GameState, LogKind, Op, PendingPlay, PlayerId, PlayRecord, SlotId, Trigger } from './types';
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
export function drawCards(s: GameState, p: PlayerId, n: number): number {
  const pl = s.players[p];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const c = pl.deck.pop();
    if (!c) break;
    pl.hand.push(c);
    drawn++;
  }
  return drawn;
}

export function heal(s: GameState, p: PlayerId, amount: number, source: string): number {
  const pl = s.players[p];
  const actual = Math.max(0, Math.min(amount, s.config.specimen.hp - pl.hp));
  if (actual > 0) {
    pl.hp += actual;
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
}

/** Voluntary venting (counts toward Carapace). Returns the Strain actually removed. */
export function vent(s: GameState, p: PlayerId, amount: number): number {
  const pl = s.players[p];
  const actual = Math.max(0, Math.min(amount, pl.strain));
  pl.strain -= actual;
  pl.stats.strainVented += actual;
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

function pickGraft(s: GameState, victim: PlayerId, pick: 'random' | 'best'): AttachedGraft | undefined {
  const gs = s.players[victim].grafts;
  if (!gs.length) return undefined;
  if (pick === 'random') return gs[nextInt(s, gs.length)];
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
  const g = (op.pick ?? 'chosen') === 'chosen' ? victim.grafts.find((x) => x.slot === ctx.play?.target) : pickGraft(s, ctx.victim, op.pick as 'random' | 'best');
  if (!g) {
    logMsg(s, 'play', ctx.caster, `${ctx.source} finds no graft to target.`);
    return;
  }
  revealGraft(s, ctx.victim, g);
  const card = cardOf(g.cardId);
  const cfg = s.config.sabotage;
  if (op.mode === 'sever') {
    victim.grafts = victim.grafts.filter((x) => x !== g);
    victim.discard.push({ uid: g.uid, cardId: g.cardId });
    if (s.config.strain.severRemovesStrain) victim.strain = Math.max(0, victim.strain - g.strain);
    logMsg(s, 'play', ctx.caster, `${ctx.source} severs ${victim.name}'s ${card.name} from ${SLOT_LABEL[g.slot]}.`);
  } else if (op.mode === 'poison') {
    g.poisoned = Math.max(g.poisoned, op.rounds ?? cfg.poisonRounds);
    logMsg(s, 'play', ctx.caster, `${ctx.source} poisons ${victim.name}'s ${card.name}: it gives 0 stats for ${g.poisoned} round(s).`);
  } else if (op.mode === 'disable') {
    g.disabled = Math.max(g.disabled, op.rounds ?? cfg.disableRounds);
    logMsg(s, 'play', ctx.caster, `${ctx.source} disables ${victim.name}'s ${card.name}: its text is off for ${g.disabled} round(s).`);
  } else {
    // necrosis: sever the graft, and the empty slot itself cannot be refilled for a while.
    victim.grafts = victim.grafts.filter((x) => x !== g);
    victim.discard.push({ uid: g.uid, cardId: g.cardId });
    if (s.config.strain.severRemovesStrain) victim.strain = Math.max(0, victim.strain - g.strain);
    const caster = s.players[ctx.caster];
    const rounds = (op.rounds ?? cfg.necrosisRounds) + sumLoadoutParam(caster, 'necrosisRoundsBonus');
    victim.necrosis[g.slot] = Math.max(victim.necrosis[g.slot] ?? 0, rounds);
    logMsg(s, 'play', ctx.caster, `${ctx.source} necroses ${victim.name}'s ${card.name} from ${SLOT_LABEL[g.slot]}: the slot cannot be refilled for ${rounds} round(s).`);
    onGraftKilled(s, ctx.caster);
  }
}

/** Chips a graft's own small integrity pool (bypasses armor); destroys it at 0, separate from rejection. */
function graftDamage(s: GameState, ctx: OpCtx, op: Extract<Op, { op: 'graftDamage' }>): void {
  const victim = s.players[ctx.victim];
  const g = victim.grafts.find((x) => x.slot === ctx.play?.target);
  if (!g) {
    logMsg(s, 'play', ctx.caster, `${ctx.source} finds no graft to target.`);
    return;
  }
  revealGraft(s, ctx.victim, g);
  const card = cardOf(g.cardId);
  const caster = s.players[ctx.caster];
  const amount = Math.max(0, op.amount + sumLoadoutParam(caster, 'graftDamageBonus') - sumLoadoutParam(victim, 'graftDamageReduction'));
  g.integrity -= amount;
  if (g.integrity <= 0) {
    victim.grafts = victim.grafts.filter((x) => x !== g);
    victim.discard.push({ uid: g.uid, cardId: g.cardId });
    if (s.config.strain.severRemovesStrain) victim.strain = Math.max(0, victim.strain - g.strain);
    logMsg(s, 'play', ctx.caster, `${ctx.source} destroys ${victim.name}'s ${card.name} in ${SLOT_LABEL[g.slot]} (integrity depleted).`);
    onGraftKilled(s, ctx.caster);
  } else {
    logMsg(s, 'play', ctx.caster, `${ctx.source} hits ${victim.name}'s ${card.name} for ${amount} integrity (${g.integrity} left).`);
  }
}

/** Corrosion/Hollow chip nodes that pay off destroying a graft (via graftDamage or necrosis). */
function onGraftKilled(s: GameState, casterId: PlayerId): void {
  const caster = s.players[casterId];
  const h = sumLoadoutParam(caster, 'killHeal');
  if (h > 0) heal(s, casterId, h, 'a graft kill');
  const st = sumLoadoutParam(caster, 'killStrain');
  if (st > 0) {
    addStrain(s, other(casterId), st);
    logMsg(s, 'strain', other(casterId), `${name(s, other(casterId))} gains ${st} Strain (a graft kill).`, st);
  }
}

function applyStatus(s: GameState, ctx: OpCtx, op: Extract<Op, { op: 'status' }>): void {
  const cfg = s.config.status;
  const caster = s.players[ctx.caster];
  const t = s.players[(op.who ?? 'opp') === 'self' ? ctx.caster : ctx.victim];
  if (op.kind === 'bleed') {
    t.bleed = Math.max(t.bleed, (op.rounds ?? cfg.bleedRounds) + sumLoadoutParam(caster, 'bleedRoundsBonus'));
    logMsg(s, 'strain', t.id, `${ctx.source}: ${t.name} is bleeding for ${t.bleed} round(s).`);
  } else if (op.kind === 'numb') {
    t.numb = Math.max(t.numb, (op.rounds ?? cfg.numbRounds) + sumLoadoutParam(caster, 'numbRoundsBonus'));
    logMsg(s, 'info', t.id, `${ctx.source}: ${t.name} is numbed and cannot play Protocols for ${t.numb} round(s).`);
  } else {
    t.fever = Math.max(t.fever, (op.rounds ?? cfg.feverRounds) + sumLoadoutParam(caster, 'feverRoundsBonus'));
    logMsg(s, 'info', t.id, `${ctx.source}: ${t.name}'s grafts cost 1 more Energy for ${t.fever} round(s) (Fever).`);
  }
}

function purge(s: GameState, ctx: OpCtx, op: Extract<Op, { op: 'purge' }>): void {
  const self = (op.who ?? 'self') === 'self';
  const t = s.players[self ? ctx.caster : ctx.victim];
  t.bleed = 0;
  t.numb = 0;
  t.fever = 0;
  t.necrosis = {};
  logMsg(s, 'info', t.id, `${ctx.source}: ${t.name}'s statuses are purged.`);
  if (self) {
    const h = sumLoadoutParam(t, 'purgeHeal');
    if (h > 0) heal(s, t.id, h, 'Purge');
    const v = sumLoadoutParam(t, 'purgeVent');
    if (v > 0) {
      const vented = vent(s, t.id, v);
      if (vented > 0) logMsg(s, 'strain', t.id, `${t.name} vents ${vented} Strain (Purge).`, -vented);
    }
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
        for (let i = 0; i < op.amount && pl.hand.length; i++) pl.discard.push(pl.hand.splice(nextInt(s, pl.hand.length), 1)[0]);
        logMsg(s, 'info', t, `${pl.name} discards ${op.amount} random card(s) (${ctx.source}).`);
        break;
      }
      case 'energy':
        s.players[ctx.caster].energy += op.amount;
        logMsg(s, 'info', ctx.caster, `${name(s, ctx.caster)} gains ${op.amount} Energy (${ctx.source}).`);
        break;
      case 'drain': {
        const pl = s.players[ctx.victim];
        pl.energy = Math.max(0, pl.energy - op.amount);
        logMsg(s, 'info', ctx.victim, `${pl.name} loses ${op.amount} Energy (${ctx.source}).`);
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
    }
  }
}

export function fireAbilities(s: GameState, p: PlayerId, g: AttachedGraft, trigger: Trigger): void {
  if (g.disabled > 0 || g.faceDown) return; // a sleeping graft does nothing
  const card = cardOf(g.cardId);
  for (const ab of card.effect.abilities ?? ([] as Ability[])) {
    if (ab.trigger !== trigger || !condOk(s, s.players[p], ab.cond)) continue;
    runOps(s, ab.ops, { caster: p, victim: other(p), source: card.name });
  }
}

export function fireTrigger(s: GameState, p: PlayerId, trigger: Trigger): void {
  for (const g of [...s.players[p].grafts]) {
    if (s.phase === 'over') return;
    fireAbilities(s, p, g, trigger);
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
    integrity: (def.integrity ?? s.config.integrity.default) + sumLoadoutParam(pl, 'flatIntegrity'),
  };
  pl.grafts.push(g);
  pl.firstGraftDone = true;
  pl.attachedThisRound++;
  pl.stats.graftsPlayed++;
  addStrain(s, p, g.strain);
  logMsg(s, 'play', p, faceDown ? `${pl.name} attaches a face-down graft to ${SLOT_LABEL[slot]} (+${g.strain} Strain).` : `${pl.name} attaches ${def.name} to ${SLOT_LABEL[slot]} (+${g.strain} Strain).`);
  fireAbilities(s, p, g, 'onAttach');
}

export function resolvePlay(s: GameState, play: PendingPlay): void {
  const p = play.player;
  const pl = s.players[p];
  const def = cardOf(play.card.cardId);
  if (play.negated) {
    pl.discard.push(play.card);
    logMsg(s, 'play', p, `${def.name} is negated.`);
    for (const r of s.plays) if (r.uid === play.card.uid) r.negated = true;
    markRevealed(s, play.card.uid); // a negated card is spent in public
    return;
  }
  if (def.type === 'graft') {
    if (!play.slot) {
      pl.discard.push(play.card);
      logMsg(s, 'play', p, `${def.name} has no room and is discarded.`);
      return;
    }
    const old = pl.grafts.find((g) => g.slot === play.slot);
    if (old && s.config.replace.enabled) {
      // Overgrowth: the new graft replaces the old one, which is discarded along with the Strain it had added.
      pl.grafts = pl.grafts.filter((g) => g !== old);
      pl.discard.push({ uid: old.uid, cardId: old.cardId });
      markRevealed(s, old.uid);
      pl.strain = Math.max(0, pl.strain - old.strain);
      logMsg(s, 'play', p, `${pl.name} replaces ${cardOf(old.cardId).name} in ${SLOT_LABEL[old.slot]} (-${old.strain} Strain).`);
    } else if (old) {
      pl.discard.push(play.card);
      logMsg(s, 'play', p, `${def.name} has no room and is discarded.`);
      return;
    }
    attachGraft(s, p, play.card, play.slot, !!play.faceDown);
    return;
  }
  const victim = play.reflected ? p : other(p);
  addStrain(s, p, def.strain);
  if (def.strain > 0) logMsg(s, 'strain', p, `${pl.name} gains ${def.strain} Strain (${def.name}).`, def.strain);
  if (play.reflected) logMsg(s, 'play', p, `${def.name} is reflected back at ${pl.name}!`);
  // A Protocol reacting to something (play.against set) points its ops at what it answered, not at itself.
  runOps(s, def.effect.ops ?? [], { caster: p, victim, play: play.against ?? play, source: def.name });
  if (def.type === 'toxin') {
    const drain = evoNum(s, pl, 'toxinDrain');
    if (drain > 0) hurt(s, victim, drain, victim === p ? null : p, `${def.name} drains`);
  }
  pl.discard.push(play.card);
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
    pl.stanceGuess = null;
    pl.rejectedThisRound = false;
    pl.attachedThisRound = 0;
    pl.tempAttack = 0;
    pl.tempArmor = 0;
  }
  for (const pl of s.players) {
    const late = s.round >= cfg.match.lateDrawFromRound ? cfg.match.lateDraw : 0; // the late game is card-starved, so draw more
    drawCards(s, pl.id, cfg.match.drawPerRound + late);
    if (late > 0 && s.round === cfg.match.lateDrawFromRound) logMsg(s, 'info', pl.id, `Late game: ${pl.name} now draws ${cfg.match.drawPerRound + late} cards a round.`);
    pl.energy = Math.max(cfg.energy.min, Math.min(s.round, cfg.energy.cap)) + (cfg.features.energyBanking ? pl.bank : 0);
    pl.bank = 0;
    if (!pl.attachedLastRound) {
      const v = vent(s, pl.id, cfg.strain.ventPerRound);
      if (v > 0) logMsg(s, 'strain', pl.id, `${pl.name} vents ${v} Strain (no graft last round).`, -v);
    }
    const regen = sumLoadoutParam(pl, 'integrityRegen');
    if (regen > 0) for (const g of pl.grafts) g.integrity = Math.min((cardOf(g.cardId).integrity ?? cfg.integrity.default) + sumLoadoutParam(pl, 'flatIntegrity'), g.integrity + regen);
  }
  // Comeback draw: the Specimen that is well behind on HP draws extra, so an early lead does not decide the match alone.
  const [pa, pb] = s.players;
  if (cfg.match.catchUpDraw > 0 && Math.abs(pa.hp - pb.hp) >= cfg.match.catchUpHpGap) {
    const trailing = pa.hp < pb.hp ? pa : pb;
    const n = drawCards(s, trailing.id, cfg.match.catchUpDraw);
    if (n > 0) logMsg(s, 'info', trailing.id, `Second wind: ${trailing.name} is ${Math.abs(pa.hp - pb.hp)} HP behind and draws ${n} extra card(s).`);
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
  // A stance call: predicting the opponent's stance alongside your own pick. Right pays off in attack,
  // wrong costs Strain, and not calling is always safe - so it is a bet, not a free read.
  for (const pl of s.players) {
    if (pl.stanceGuess === null) continue;
    const opp = s.players[other(pl.id)];
    if (pl.stanceGuess === opp.stance) {
      const n = s.config.stances.callBonus;
      pl.tempAttack += n;
      logMsg(s, 'info', pl.id, `Call: ${pl.name} correctly calls ${STANCE_NAME[opp.stance!]} and gets +${n} attack this round.`);
    } else {
      const n = s.config.stances.callPenalty;
      addStrain(s, pl.id, n);
      logMsg(s, 'strain', pl.id, `Call: ${pl.name} calls ${STANCE_NAME[pl.stanceGuess]} but ${opp.name} picked ${STANCE_NAME[opp.stance!]} - ${pl.name} gains ${n} Strain.`, n);
    }
  }
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
  for (const i of [0, 1] as PlayerId[]) {
    if (dealt[i] > 0) fireTrigger(s, i, 'onDealDamage');
    if (dealt[other(i)] > 0) fireTrigger(s, i, 'onTakeDamage');
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
  pl.discard.push({ uid: g.uid, cardId: g.cardId });
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
  // Bleed: 1 damage per round while it lasts, ticking down independent of Strain.
  for (const p of ids) {
    const pl = s.players[p];
    if (pl.bleed <= 0) continue;
    hurt(s, p, cfg.status.bleedDamage, null, 'Bleed');
    pl.bleed--;
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
    if (pl.hold) amount += cfg.strain.holdVent;
    if (amount > 0) {
      const v = vent(s, p, amount);
      if (v > 0) logMsg(s, 'strain', p, `${pl.name} vents ${v} Strain.`, -v);
    }
  }
  // 3. Rejection (decided simultaneously)
  const rejecting = ids.filter((p) => s.players[p].strain > T);
  for (const p of rejecting) rejectGraft(s, p);
  if (endIfDead(s)) return;
  // 3b. End-of-check text (graft "Strain check" abilities)
  for (const p of ids) {
    const pl = s.players[p];
    fireTrigger(s, p, 'onStrainCheck');
    // Veterancy: any graft still attached survived this check. Only Signature grafts spend it (see computeStats),
    // but every graft counts so a graft that starts as a tech slot and gets replaced never confuses the count.
    for (const g of pl.grafts) {
      g.roundsSurvived++;
      const def = cardOf(g.cardId);
      if (def.signature && g.roundsSurvived === cfg.veterancy.signatureThreshold) {
        logMsg(s, 'info', p, `Veterancy: ${def.name} has held on through ${g.roundsSurvived} Strain checks and hardens (+${cfg.veterancy.signatureAttackBonus} attack).`);
      }
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
  for (const p of ids) {
    if (!eligible[p].length) continue;
    const pl = s.players[p];
    pl.evolutionOptions = eligible[p];
    s.evoQueue.push(p);
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
