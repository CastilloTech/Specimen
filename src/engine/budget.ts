// Card power budget: target = 1.5 x Strain + 1 + Cost (1 attack = 1 pt, 1 armor = 1 pt).
// Text effects are priced from config.budget so the estimate is reproducible.
import type { Ability, CardDef, Config, Op } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;

export function opPoints(op: Op, cfg: Config): number {
  const p = cfg.budget.prices;
  switch (op.op) {
    case 'heal':
      return p.heal * op.amount;
    case 'damage':
      return (op.who === 'self' ? -1 : 1) * p.damage * op.amount;
    case 'strain':
      return (op.who === 'self' ? p.strainSelf : p.strainOpp) * op.amount;
    case 'vent':
      return p.vent * op.amount;
    case 'draw':
      return p.draw * op.amount;
    case 'discard':
      return (op.who === 'self' ? -1 : 1) * p.discard * op.amount;
    case 'energy':
      return p.energy * op.amount;
    case 'drain':
      return p.drain * op.amount;
    case 'buff':
      return (op.who === 'opp' ? -1 : 1) * p.buff * op.amount;
    case 'sabotage':
      return p[op.mode] * (op.pick === 'random' ? 0.5 : op.pick === 'best' ? 0.8 : 1);
    case 'reveal':
      return p.reveal;
    case 'negate':
      return p.negate;
    case 'reflect':
      return p.reflect;
    case 'mod': {
      let mult = 1;
      if (op.per) mult = op.per.what === 'grafts' ? 2 : op.per.what === 'missingHp' ? 1 : 6 / Math.max(1, op.per.div);
      return p.mod * op.amount * mult;
    }
  }
}

function abilityPoints(a: Ability, cfg: Config): number {
  const ops = a.ops.reduce((n, o) => n + opPoints(o, cfg), 0);
  const trig = cfg.budget.triggerMultipliers[a.trigger] ?? 1;
  return ops * trig * (a.cond ? cfg.budget.conditionMultiplier : 1);
}

export function textPoints(card: CardDef, cfg: Config): number {
  const eff = card.effect;
  let pts = (eff.abilities ?? []).reduce((n, a) => n + abilityPoints(a, cfg), 0);
  const instant = (eff.ops ?? []).reduce((n, o) => n + opPoints(o, cfg), 0);
  pts += card.type === 'protocol' ? instant * cfg.budget.protocolMultiplier : instant;
  return r2(pts);
}

export interface BudgetReport {
  target: number;
  stats: number;
  text: number;
  total: number;
  diff: number;
  ok: boolean;
}

export function budgetOf(card: CardDef, cfg: Config): BudgetReport {
  const b = cfg.budget;
  const target = r2(b.strainPoints * card.strain + b.base + b.costPoints * card.cost + (card.signature ? b.signatureBonus : 0));
  const stats = card.attack + card.armor;
  const text = textPoints(card, cfg);
  const total = r2(stats + text);
  const diff = r2(total - target);
  return { target, stats, text, total, diff, ok: Math.abs(diff) <= b.tolerance };
}

export function budgetNote(card: CardDef, cfg: Config): string {
  const r = budgetOf(card, cfg);
  const b = cfg.budget;
  const sig = card.signature ? ` + ${b.signatureBonus} signature` : '';
  return `target ${r.target} (${b.strainPoints}x${card.strain} strain + ${b.base} + ${card.cost} cost${sig}); stats ${r.stats} (${card.attack} atk, ${card.armor} armor) + text ~${r.text} = ${r.total} (${r.diff >= 0 ? '+' : ''}${r.diff})`;
}
