// Engine upgrades: payoff firings are logged per graft and counted per engine, evolved forms amplify an
// engine, the Engine Jammer targets payoffs, the bot sequences combos, and Auto-fill can build around an engine.
import { describe, expect, it } from 'vitest';
import { botMainAction, CARD_MAP, CARDS, defaultConfig, FACTIONS } from '../src/engine';
import type { GameState } from '../src/engine';
import { engineOfAbility, runOps, vent } from '../src/engine/rules';
import { makeRng } from '../src/engine/rng';
import { autoFill } from '../src/ui/deckHelpers';
import { comboEngine, ENGINE_META } from '../src/ui/meta';
import { arena, attached, edit, hands, setEnergy, setStrain } from './kit';

const act = (s: GameState, fn: (d: GameState) => void) => edit(s, fn);

describe('Engine firing record', () => {
  it('logs each payoff firing with its graft and counts it per engine', () => {
    let s = attached(arena('bastion', 'predator'), 0, 'bast_exhaust_bladder', 'limbA');
    s = setStrain(s, 0, 9);
    s = act(s, (d) => void vent(d, 0, 1));
    s = act(s, (d) => void vent(d, 0, 1));
    const entries = s.log.filter((l) => l.kind === 'engine');
    expect(entries).toHaveLength(2);
    expect(entries[0].uid).toBe(s.players[0].grafts[0].uid);
    expect(entries[0].engine).toBe('pressure');
    expect(s.players[0].stats.engineFiresBy).toEqual({ pressure: 2 });
    expect(s.players[0].stats.engineFires).toBe(2);
  });

  it("attributes each of a Mastery card's triggered abilities to a different one of its engines (passives never fire)", () => {
    for (const c of CARDS.filter((x) => x.mastery)) {
      const triggered = (c.effect.abilities ?? []).filter((ab) => ab.trigger !== 'passive');
      const ids = triggered.map((ab) => engineOfAbility(c, ab));
      expect(ids.every(Boolean), c.id).toBe(true);
      expect(new Set(ids).size, c.id).toBe(triggered.length);
    }
  });

  it('does not count an uncapped, unconditional ability (a round-start repair) as an engine firing', () => {
    const c = CARD_MAP.aeg_mending_carapace;
    expect(engineOfAbility(c, c.effect.abilities![0])).toBeNull();
    expect(engineOfAbility(c, c.effect.abilities![1])).toBe('renewal');
  });
});

describe('Evolutions amplify engines', () => {
  it("every Build's two forms each amplify a different engine of that Build", () => {
    for (const f of FACTIONS) {
      const forms = (defaultConfig.evolutions as Record<string, { effects: Record<string, unknown> }[]>)[f];
      const engines = forms.map((d) => Object.keys(d.effects).filter((k) => k.startsWith('engine_')));
      for (const e of engines) {
        expect(e, f).toHaveLength(1);
        expect(ENGINE_META[e[0].slice(7) as keyof typeof ENGINE_META].owner, f).toBe(f);
      }
      expect(engines[0][0]).not.toBe(engines[1][0]);
    }
  });

  it('an evolved form with Amplify adds to its engine payoffs', () => {
    let s = attached(arena('bastion', 'predator'), 0, 'bast_exhaust_bladder', 'limbA');
    s = setStrain(s, 0, 9);
    s = act(s, (d) => {
      const form = (d.config.evolutions as unknown as Record<string, { id: string; effects: Record<string, number | boolean> }[]>).bastion[0];
      form.effects.engine_pressure = 1;
      d.players[0].evolution = form.id;
    });
    const before = s.players[1].hp;
    s = act(s, (d) => void vent(d, 0, 1));
    expect(s.players[1].hp).toBe(before - 2);
  });
});

describe('Engine Jammer', () => {
  it("disables the opponent's engine payoff graft rather than a stronger plain one", () => {
    let s = attached(arena('predator', 'bastion'), 1, 'bast_exhaust_bladder', 'limbA');
    s = attached(s, 1, 'bast_bone_helm', 'head');
    const jam = CARD_MAP.tech_engine_jammer.effect.ops!;
    s = act(s, (d) => runOps(d, jam, { caster: 0, victim: 1, source: 'Engine Jammer' }));
    expect(s.players[1].grafts.find((g) => g.cardId === 'bast_exhaust_bladder')!.disabled).toBeGreaterThan(0);
    expect(s.players[1].grafts.find((g) => g.cardId === 'bast_bone_helm')!.disabled).toBe(0);
  });
});

describe('Bot combo sequencing', () => {
  it('plays the payoff graft before the one-shot enabler that sets it off', () => {
    let s = hands(arena('predator', 'bastion'), ['cor_lacerate', 'cor_hemorrhage_fang'], []);
    s = setEnergy(s, 0, 6);
    const a = botMainAction(s, 0, makeRng(1));
    expect(a.type).toBe('PLAY_CARD');
    const uid = (a as { uid: string }).uid;
    expect(s.players[0].hand.find((c) => c.uid === uid)!.cardId).toBe('cor_hemorrhage_fang');
  });
});

describe('Building around an engine', () => {
  it('Auto-fill with a focus packs that engine\'s payoffs and enablers', () => {
    const deck = autoFill('bastion', 'corrosion', {}, () => true, undefined, 'pressure');
    const ids = Object.entries(deck).filter(([, n]) => n > 0).map(([id]) => CARD_MAP[id]);
    const tagged = (role: string) => ids.filter((c) => c.engines?.some((t) => t.id === 'pressure' && t.role === role)).length;
    expect(tagged('payoff')).toBeGreaterThanOrEqual(2);
    expect(tagged('enabler')).toBeGreaterThanOrEqual(3);
    expect(Object.values(deck).reduce((a, b) => a + b, 0)).toBe(defaultConfig.deck.size);
  });

  it('a hand enabler glows only while its payoff is awake on the board', () => {
    let s = arena('bastion', 'predator');
    expect(comboEngine(CARD_MAP.bast_relief_spiracle, s.players[0])).toBeNull();
    s = attached(s, 0, 'bast_exhaust_bladder', 'limbA');
    expect(comboEngine(CARD_MAP.bast_relief_spiracle, s.players[0])).toBe('pressure');
  });
});
