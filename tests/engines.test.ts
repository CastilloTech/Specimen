// Synergy engines, wave 1: each engine's event fires its payoffs, per-round caps hold and reset, and the
// conditions and scaling behave. Uses the real engine cards by id.
import { describe, expect, it } from 'vitest';
import { CARD_MAP, CARDS, CHIPS, computeStats } from '../src/engine';
import type { EngineId, GameState } from '../src/engine';
import { addStrain, fireTrigger, runOps, vent } from '../src/engine/rules';
import { arena, attached, edit, endRound, hands, setEnergy, setHp, setStrain } from './kit';

const act = (s: GameState, fn: (d: GameState) => void) => edit(s, fn);
/** An engine card's per-round cap and first op amount, read from the data so tuning doesn't break tests. */
const capOf = (id: string, ability = 0) => CARD_MAP[id].effect.abilities![ability].perRound!;
const amountOf = (id: string, ability = 0) => (CARD_MAP[id].effect.abilities![ability].ops[0] as { amount: number }).amount;
const hp = (s: GameState, p: 0 | 1) => s.players[p].hp;

describe('Pressure (Bastion): venting deals damage', () => {
  it('Exhaust Bladder deals 1 per vent, up to its cap each round, and resets next round', () => {
    let s = attached(arena('bastion', 'predator'), 0, 'bast_exhaust_bladder', 'limbA');
    s = setStrain(s, 0, 9);
    const before = hp(s, 1);
    const cap = capOf('bast_exhaust_bladder');
    for (let i = 0; i < cap + 2; i++) s = act(s, (d) => void vent(d, 0, 1));
    expect(hp(s, 1)).toBe(before - cap * amountOf('bast_exhaust_bladder'));
    s = endRound(hands(s)); // into the next round: the cap resets
    s = setStrain(s, 0, 6);
    const b2 = hp(s, 1);
    s = act(s, (d) => void vent(d, 0, 1));
    expect(hp(s, 1)).toBe(b2 - 1);
  });

  it('Relief Spiracle turns gaining Strain into a vent (up to its cap), which sets off the Bladder', () => {
    let s = attached(attached(arena('bastion', 'predator'), 0, 'bast_relief_spiracle', 'nerve'), 0, 'bast_exhaust_bladder', 'limbA');
    s = setStrain(s, 0, 2);
    const before = hp(s, 1);
    const cap = capOf('bast_relief_spiracle');
    for (let i = 0; i < cap; i++) s = act(s, (d) => addStrain(d, 0, 2)); // +2, the Spiracle vents 1, the Bladder hits
    expect(s.players[0].strain).toBe(2 + cap);
    expect(hp(s, 1)).toBe(before - cap);
    s = act(s, (d) => addStrain(d, 0, 2)); // the Spiracle is spent for this round
    expect(s.players[0].strain).toBe(4 + cap);
    expect(hp(s, 1)).toBe(before - cap);
  });
});

describe('Frenzy (Predator): gaining your own Strain', () => {
  it('Frenzy Gland adds attack only while Overclocked, up to its cap', () => {
    let s = attached(arena('predator', 'bastion'), 0, 'pred_frenzy_gland', 'nerve');
    s = setStrain(s, 0, 2); // Stable: no effect
    s = act(s, (d) => addStrain(d, 0, 1));
    expect(s.players[0].tempAttack).toBe(0);
    s = setStrain(s, 0, 7); // Overclocked
    const cap = capOf('pred_frenzy_gland');
    for (let i = 0; i < cap + 1; i++) s = act(s, (d) => addStrain(d, 0, 1));
    expect(s.players[0].tempAttack).toBe(cap * amountOf('pred_frenzy_gland'));
    expect(s.players[0].stats.engineFires).toBe(cap);
  });

  it('Seething Maw deals damage per Strain gain, up to its cap', () => {
    let s = attached(arena('predator', 'bastion'), 0, 'pred_seething_maw', 'head');
    const before = hp(s, 1);
    const cap = capOf('pred_seething_maw');
    for (let i = 0; i < cap + 1; i++) s = act(s, (d) => addStrain(d, 0, 1));
    expect(hp(s, 1)).toBe(before - cap * amountOf('pred_seething_maw'));
  });
});

describe('Feed (Parasite): the opponent gaining Strain', () => {
  it('Siphon Sac heals each time the opponent gains Strain, up to its cap; your own Strain does nothing', () => {
    let s = attached(arena('parasite', 'bastion'), 0, 'para_siphon_sac', 'organ');
    s = setHp(s, 0, 20);
    s = act(s, (d) => addStrain(d, 0, 1));
    expect(hp(s, 0)).toBe(20);
    const cap = capOf('para_siphon_sac');
    for (let i = 0; i < cap + 2; i++) s = act(s, (d) => addStrain(d, 1, 1));
    expect(hp(s, 0)).toBe(20 + cap * amountOf('para_siphon_sac'));
  });
});

describe('Hemorrhage (Corrosion): Bleed stacks', () => {
  it('Hemorrhage Fang gains attack per Bleed stack on the opponent', () => {
    let s = attached(arena('predator', 'bastion'), 0, 'cor_hemorrhage_fang', 'limbA');
    const base = computeStats(s, s.players[0]).attack;
    s = act(s, (d) => {
      d.players[1].bleed = 2;
      d.players[1].bleedStacks = 2;
    });
    expect(computeStats(s, s.players[0]).attack).toBe(base + 2 * amountOf('cor_hemorrhage_fang', 1));
  });

  it('Lacerate applies two stacks at once', () => {
    let s = arena('predator', 'bastion', ['aggress', 'aggress'], { status: { bleedMaxStacks: 2 } }); // the kit pins 1 stack
    s = act(s, (d) => runOps(d, [{ op: 'status', kind: 'bleed' }, { op: 'status', kind: 'bleed' }], { caster: 0, victim: 1, source: 'Lacerate' }));
    expect(s.players[1].bleedStacks).toBe(2);
  });
});

describe('Double dose (Miasma): two statuses at once', () => {
  it('Choking Nexus strains the opponent at round start only while they have 2+ statuses', () => {
    let s = attached(arena('predator', 'bastion'), 0, 'mia_choking_nexus', 'organ');
    s = act(s, (d) => {
      d.players[1].numb = 3;
    });
    const one = endRound(hands(s)).players[1].strain;
    s = act(s, (d) => {
      d.players[1].numb = 3;
      d.players[1].fever = 3;
    });
    const two = endRound(hands(s)).players[1].strain;
    expect(two - one).toBe(amountOf('mia_choking_nexus', 1));
  });
});

describe('Starvation (Hollow): draining Energy', () => {
  it('Hunger Tap hits per drain up to its cap; Famine Maw strains an opponent drained low', () => {
    let s = attached(attached(arena('predator', 'bastion'), 0, 'hol_hunger_tap', 'nerve'), 0, 'hol_famine_maw', 'head');
    const low = CARD_MAP.hol_famine_maw.effect.abilities![1].cond!.oppEnergyAtMost!;
    s = setEnergy(s, 1, low + 2);
    const before = { hp: hp(s, 1), strain: s.players[1].strain };
    const drain = () => (s = act(s, (d) => runOps(d, [{ op: 'drain', amount: 1 }], { caster: 0, victim: 1, source: 't' })));
    drain(); // one above the Maw's line: the Tap hits, the Maw does nothing
    expect(hp(s, 1)).toBe(before.hp - 1);
    expect(s.players[1].strain).toBe(before.strain);
    drain(); // down to the Maw's line
    expect(hp(s, 1)).toBe(before.hp - 2);
    expect(s.players[1].strain).toBe(before.strain + amountOf('hol_famine_maw', 1));
    const cap = capOf('hol_hunger_tap', 1);
    for (let i = 2; i < cap + 2; i++) drain();
    expect(hp(s, 1)).toBe(before.hp - cap); // capped
  });
});

describe('Renewal (Aegis): repairing Integrity', () => {
  it('Mending Carapace gives armor whenever a graft is repaired; a repair that heals nothing does not count', () => {
    let s = attached(arena('bastion', 'predator'), 0, 'aeg_mending_carapace', 'limbA', { integrity: 1 });
    const gain = amountOf('aeg_mending_carapace', 1);
    s = act(s, (d) => runOps(d, [{ op: 'integrityHeal', amount: 1 }], { caster: 0, victim: 1, source: 't' }));
    expect(s.players[0].tempArmor).toBe(gain);
    s = act(s, (d) => {
      d.players[0].grafts[0].integrity = CARD_MAP.aeg_mending_carapace.integrity!; // full: nothing to repair
    });
    s = act(s, (d) => runOps(d, [{ op: 'integrityHeal', amount: 1 }], { caster: 0, victim: 1, source: 't' }));
    expect(s.players[0].tempArmor).toBe(gain);
  });
});

describe('Wave 2 engine events', () => {
  it('Carrion: destroying an enemy graft fires onKill (Carrion Jaws heals), once a round', () => {
    let s = attached(attached(arena('predator', 'bastion'), 0, 'pred_carrion_jaws', 'head'), 1, 'bast_scale_patch', 'limbA', { integrity: 1 });
    s = attached(s, 1, 'bast_shell_limb', 'limbB', { integrity: 1 });
    s = setHp(s, 0, 20);
    const kill = () => (s = act(s, (d) => runOps(d, [{ op: 'graftDamage', amount: 1 }], { caster: 0, victim: 1, source: 't' }))); // an ability hit: the weakest graft
    kill();
    expect(s.players[1].grafts).toHaveLength(1);
    expect(hp(s, 0)).toBe(20 + amountOf('pred_carrion_jaws'));
    kill(); // a second kill this round: capped
    expect(s.players[1].grafts).toHaveLength(0);
    expect(hp(s, 0)).toBe(20 + amountOf('pred_carrion_jaws'));
  });

  it("an ability's Integrity damage hits the most worn-down awake enemy graft (Flensing Hook), and wear fires onWear (Dissolving Maw)", () => {
    let s = attached(arena('predator', 'bastion'), 0, 'cor_dissolving_maw', 'head');
    s = attached(attached(s, 1, 'bast_bone_helm', 'head', { integrity: 3 }), 1, 'bast_shell_limb', 'limbA', { integrity: 2 });
    const strain = s.players[1].strain;
    s = act(s, (d) => runOps(d, [{ op: 'graftDamage', amount: 1 }], { caster: 0, victim: 1, source: 't' }));
    expect(s.players[1].grafts.find((g) => g.cardId === 'bast_shell_limb')!.integrity).toBe(1);
    expect(s.players[1].grafts.find((g) => g.cardId === 'bast_bone_helm')!.integrity).toBe(3);
    expect(s.players[1].strain).toBe(strain + amountOf('cor_dissolving_maw', 1));
  });

  it('Overload: the opponent rejecting a graft fires onOppReject (Rupture Sac draws 2)', async () => {
    const { rejectGraft } = await import('../src/engine/rules');
    let s = attached(attached(arena('parasite', 'bastion'), 0, 'para_rupture_sac', 'limbA'), 1, 'bast_bone_helm', 'head');
    const hand = s.players[0].hand.length;
    s = act(s, (d) => void rejectGraft(d, 1));
    expect(s.players[0].hand.length).toBe(hand + amountOf('para_rupture_sac'));
  });

  it('Fortress: blocking a big hit in the Clash fires onBlock (Riposte Plating hits back)', () => {
    // Bastion armor vs a small Predator attack: set armor high with a temp buff so the block is certain.
    let s = attached(arena('bastion', 'predator'), 0, 'bast_riposte_plating', 'limbA');
    s = attached(s, 1, 'pred_maw_crown', 'head');
    s = act(s, (d) => {
      d.players[0].tempArmor = 10;
    });
    const before = hp(s, 1);
    s = endRound(s);
    expect(s.log.some((l) => /Riposte Plating/.test(l.text))).toBe(true);
    expect(hp(s, 1)).toBeLessThan(before);
  });

  it('Silence: payoffs switch on while the opponent is numbed (Muffling Ganglion)', () => {
    let s = attached(arena('predator', 'bastion'), 0, 'mia_muffling_ganglion', 'nerve');
    const base = computeStats(s, s.players[0]).attack;
    s = act(s, (d) => {
      d.players[1].numb = 2;
    });
    expect(computeStats(s, s.players[0]).attack).toBe(base + amountOf('mia_muffling_ganglion', 1));
  });

  it('Necropolis: payoffs grow with each enemy slot locked by Necrosis (Ossuary Crown)', () => {
    let s = attached(arena('predator', 'bastion'), 0, 'hol_ossuary_crown', 'head');
    const base = computeStats(s, s.players[0]).attack;
    s = act(s, (d) => {
      d.players[1].necrosis = { head: 2, limbA: 1 };
    });
    expect(computeStats(s, s.players[0]).attack).toBe(base + 2 * amountOf('hol_ossuary_crown', 1));
  });

  it('Cleanse: Purging yourself fires onPurge (Cleansing Crest heals), even with nothing to remove', () => {
    let s = attached(arena('bastion', 'predator'), 0, 'aeg_cleansing_crest', 'head');
    s = setHp(s, 0, 20);
    s = act(s, (d) => runOps(d, [{ op: 'purge' }], { caster: 0, victim: 1, source: 't' }));
    expect(hp(s, 0)).toBe(20 + amountOf('aeg_cleansing_crest'));
  });
});

describe('Wave 3 engine events', () => {
  it('Overkill: a big Clash hit fires onBigHit (Goring Spur strains the opponent)', () => {
    let s = attached(arena('predator', 'bastion'), 0, 'pred_goring_spur', 'limbA');
    s = act(s, (d) => {
      d.players[0].tempAttack = 12; // a certain big hit
    });
    const strain = s.players[1].strain;
    s = endRound(s);
    expect(s.log.some((l) => /Goring Spur/.test(l.text))).toBe(true);
    expect(s.players[1].strain).toBeGreaterThanOrEqual(strain + amountOf('pred_goring_spur') - s.config.strain.ventPerRound);
  });

  it('Brood: attaching a graft fires onAttachGraft (Spawning Pit heals), and Swarm Ganglion counts grafts', async () => {
    const { attachGraft } = await import('../src/engine/rules');
    let s = attached(arena('parasite', 'bastion'), 0, 'para_spawning_pit', 'organ');
    s = setHp(s, 0, 20);
    s = act(s, (d) => attachGraft(d, 0, { uid: 'l1', cardId: 'para_brood_larva' }, 'limbA', false));
    expect(hp(s, 0)).toBe(20 + amountOf('para_spawning_pit'));
    s = act(s, (d) => {
      d.players[0].grafts = d.players[0].grafts.filter((g) => g.cardId !== 'para_brood_larva');
    });
    s = attached(s, 0, 'para_swarm_ganglion', 'nerve');
    const one = computeStats(s, s.players[0]).attack;
    s = attached(attached(s, 0, 'para_brood_larva', 'limbA'), 0, 'para_symbiotic_node', 'limbB');
    expect(computeStats(s, s.players[0]).attack).toBeGreaterThan(one);
  });

  it('Endurance: grafts that survived 2+ Strain checks add armor (Ancient Plating)', () => {
    let s = attached(arena('bastion', 'predator'), 0, 'bast_ancient_plating', 'limbA');
    s = attached(s, 0, 'bast_reflex_ganglion', 'nerve', { roundsSurvived: 2 });
    const two = computeStats(s, s.players[0]).armor;
    s = act(s, (d) => {
      d.players[0].grafts[0].roundsSurvived = 3;
    });
    expect(computeStats(s, s.players[0]).armor).toBe(two + 1);
  });

  it('Rust: worn enemy grafts add attack (Rust Bloom)', () => {
    let s = attached(arena('predator', 'bastion'), 0, 'cor_rust_bloom', 'organ');
    s = attached(attached(s, 1, 'bast_bone_helm', 'head'), 1, 'bast_shell_limb', 'limbA');
    const base = computeStats(s, s.players[0]).attack;
    s = act(s, (d) => {
      d.players[1].grafts[0].integrity = 1;
      d.players[1].grafts[1].integrity = 1;
    });
    expect(computeStats(s, s.players[0]).attack).toBe(base + 2);
  });

  it('Fever burn: the opponent grafting while Fevered fires onOppFeverGraft (Fever Tick)', async () => {
    const { attachGraft } = await import('../src/engine/rules');
    let s = attached(arena('predator', 'bastion'), 0, 'mia_fever_tick', 'limbA');
    s = act(s, (d) => {
      d.players[1].fever = 2;
    });
    const before = s.players[1].strain;
    s = act(s, (d) => attachGraft(d, 1, { uid: 'x1', cardId: 'bast_bone_helm' }, 'head', false));
    expect(s.players[1].strain).toBe(before + CARD_MAP.bast_bone_helm.strain + amountOf('mia_fever_tick', 1));
  });

  it('Grave: your discard pile adds attack (Charnel Limb, +1 per 4 cards)', () => {
    let s = attached(arena('predator', 'bastion'), 0, 'hol_charnel_limb', 'limbA');
    const base = computeStats(s, s.players[0]).attack;
    s = act(s, (d) => {
      for (let i = 0; i < 8; i++) d.players[0].discard.push({ uid: `d${i}`, cardId: 'hol_null_serum', why: 'played', round: 1 });
    });
    expect(computeStats(s, s.players[0]).attack).toBe(base + 2);
  });

  it('Amplify: a Chip engine node adds +1 to that engine\'s payoffs, triggered or passive', () => {
    // Triggered: Exhaust Bladder is not a World Faction engine, so use Warding Sigil (Ward) with the Ward node.
    let s = attached(arena('bastion', 'predator'), 0, 'aeg_warding_sigil', 'limbA');
    s = act(s, (d) => {
      d.players[0].loadout = ['reflexWard'];
    });
    s = act(s, (d) => fireTrigger(d, 0, 'onProtocol'));
    expect(s.players[0].tempArmor).toBe(amountOf('aeg_warding_sigil') + 1);
    // Passive: Rust Bloom with the Rust node.
    let r = attached(arena('predator', 'bastion'), 0, 'cor_rust_bloom', 'organ');
    r = attached(r, 1, 'bast_bone_helm', 'head', { integrity: 1 });
    const plain = computeStats(r, r.players[0]).attack;
    r = act(r, (d) => {
      d.players[0].loadout = ['oxidize'];
    });
    expect(computeStats(r, r.players[0]).attack).toBe(plain + 1);
  });

  it('every Mastery card is a payoff of all three of its identity\'s engines, and every Chip backs a different one', () => {
    for (const c of CARDS.filter((x) => x.mastery)) {
      const engines = CARDS.filter((x) => x.faction === c.faction && !x.mastery).flatMap((x) => (x.engines ?? []).map((t) => t.id));
      const own = new Set(engines);
      expect(own.size, c.faction).toBe(3);
      expect(new Set((c.engines ?? []).filter((t) => t.role === 'payoff').map((t) => t.id)), c.id).toEqual(own);
    }
    for (const wf of ['corrosion', 'aegis', 'miasma', 'hollow'] as const) {
      const boosted = CHIPS.filter((ch) => ch.worldFaction === wf).map((ch) => ch.tree.flatMap((r) => r.nodes.flatMap((n) => Object.keys(n.params))).find((k) => k.startsWith('engine_')));
      expect(new Set(boosted).size, wf).toBe(3);
      for (const k of boosted) expect(CARDS.some((x) => x.faction === wf && x.engines?.some((t) => `engine_${t.id}` === k)), `${wf} ${k}`).toBe(true);
    }
  });
});

describe('Engine data', () => {
  const ENGINES: EngineId[] = ['frenzy', 'feed', 'pressure', 'hemorrhage', 'doubleDose', 'starvation', 'renewal', 'carrion', 'overload', 'fortress', 'dissolve', 'silence', 'necropolis', 'cleanse', 'overkill', 'brood', 'endurance', 'rust', 'feverBurn', 'grave', 'ward'];
  it('every engine has at least one payoff and three enablers, all from one identity (plus Tech enablers)', () => {
    for (const e of ENGINES) {
      const cards = CARDS.filter((c) => c.engines?.some((t) => t.id === e));
      const payoffs = cards.filter((c) => c.engines!.some((t) => t.id === e && t.role === 'payoff'));
      const enablers = cards.filter((c) => c.engines!.some((t) => t.id === e && t.role === 'enabler'));
      expect(payoffs.length, e).toBeGreaterThanOrEqual(1);
      expect(enablers.length, e).toBeGreaterThanOrEqual(3);
      expect(new Set(cards.filter((c) => c.faction !== 'tech').map((c) => c.faction)).size, `${e} spans one identity`).toBe(1);
    }
  });

  it('every triggered engine payoff is capped per round', () => {
    const engineTriggers = new Set(['onGainStrain', 'onOppGainStrain', 'onVent', 'onDrain', 'onRepair', 'onKill', 'onOppReject', 'onBlock', 'onWear', 'onPurge', 'onBigHit', 'onAttachGraft', 'onOppFeverGraft', 'onProtocol']);
    for (const c of CARDS) for (const a of c.effect.abilities ?? []) if (engineTriggers.has(a.trigger)) expect(a.perRound, `${c.id} ${a.trigger}`).toBeGreaterThan(0);
  });
});
