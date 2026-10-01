// The story layer: flavour for everything, Archive records that unlock from play (and can all be reached),
// Z as the Tower's and Lineage's final boss, the Unregistered Handler on her floors, and Breach left alone.
import { describe, expect, it } from 'vitest';
import { CARDS, CHIPS, chipsFor, defaultConfig } from '../src/engine';
import { startBreach, waveMatch } from '../src/ui/breach';
import { FLOOR_FOR_MATCH, lineageMatch, startLineage } from '../src/ui/lineage';
import { CARD_FLAVOR, CHIP_FLAVOR, encounterLines, EVOLUTION_FLAVOR, FRAGMENTS, fragmentText, OPERATIVE_NAME, recruiterOf, unlockedFragments, Z_NAME } from '../src/ui/lore';
import { floorMatch, OPERATIVE_FLOORS, startProgress, TOWER_FLOORS } from '../src/ui/modes';
import type { Progress } from '../src/ui/modes';
import type { MatchRecord } from '../src/ui/storage';

const ENGINES = ['frenzy', 'feed', 'pressure', 'hemorrhage', 'doubleDose', 'starvation', 'renewal', 'carrion', 'overload', 'fortress', 'dissolve', 'silence', 'necropolis', 'cleanse', 'overkill', 'brood', 'endurance', 'rust', 'feverBurn', 'grave', 'ward'];
const FORMS = Object.values(defaultConfig.evolutions as Record<string, { id: string }[]>).flat().map((d) => d.id);

/** A minimal match record: only the fields the Archive reads. */
function rec(over: { result?: 'win' | 'loss'; faction?: string; world?: string; opp?: string; engines?: string[]; evolution?: string | null } = {}): MatchRecord {
  return {
    at: 0,
    result: over.result ?? 'win',
    reason: '',
    rounds: 6,
    me: { faction: over.faction ?? 'predator', worldFaction: over.world ?? 'corrosion', chip: 'acidFang', evolution: over.evolution ?? null, engineFiresBy: Object.fromEntries((over.engines ?? []).map((e) => [e, 1])) },
    opp: { faction: 'bastion', worldFaction: 'aegis', chip: 'ironclad', evolution: null, hpLeft: 0, name: over.opp ?? 'Floor 3' },
  } as unknown as MatchRecord;
}

describe('Flavour text', () => {
  it('every card, Chip and evolution has one, and nothing else does', () => {
    expect(Object.keys(CARD_FLAVOR).sort()).toEqual(CARDS.map((c) => c.id).sort());
    expect(Object.keys(CHIP_FLAVOR).sort()).toEqual(CHIPS.map((c) => c.id).sort());
    expect(Object.keys(EVOLUTION_FLAVOR).sort()).toEqual([...FORMS].sort());
    for (const t of [...Object.values(CARD_FLAVOR), ...Object.values(CHIP_FLAVOR), ...Object.values(EVOLUTION_FLAVOR)]) expect(t.trim().length).toBeGreaterThan(10);
  });
});

describe('The Archive', () => {
  it('has unique records, and every record it depends on exists', () => {
    const ids = FRAGMENTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FRAGMENTS) if (f.unlock.kind === 'all') for (const d of f.unlock.ids) expect(ids, `${f.id} needs ${d}`).toContain(d);
  });

  it('a new save holds only the first record', () => {
    expect([...unlockedFragments([], null)]).toEqual(['intake']);
  });

  it('records unlock from play: faction wins, engines, Tower floors, meeting and beating Z', () => {
    const p = { ...startProgress('predator', 'corrosion', chipsFor('corrosion')[0].id), tower: { floor: 21, best: 20, checkpoint: 20 } } as Progress;
    const got = unlockedFragments([rec({ world: 'aegis', engines: ['cleanse'] }), rec({ result: 'loss', opp: Z_NAME })], p);
    expect(got.has('found_aegis')).toBe(true);
    expect(got.has('found_corrosion')).toBe(false);
    expect(got.has('shift_assay')).toBe(true);
    expect(got.has('offshoots')).toBe(true); // Tower floor 20
    expect(got.has('gradient')).toBe(false); // floor 35
    expect(got.has('z_clearing')).toBe(true); // met Z
    expect(got.has('z_settled')).toBe(false); // but lost
  });

  it('the Unregistered Handler reveals a little more each time you meet her', () => {
    const meet = (n: number) => unlockedFragments(Array.from({ length: n }, () => rec({ opp: OPERATIVE_NAME })), null);
    expect(meet(1).has('op_1')).toBe(true);
    expect(meet(1).has('op_2')).toBe(false);
    expect(meet(3).has('op_3')).toBe(true);
    expect(encounterLines(OPERATIVE_NAME, 0)!.before).not.toBe(encounterLines(OPERATIVE_NAME, 2)!.before);
    expect(encounterLines(OPERATIVE_NAME, 9)).toEqual(encounterLines(OPERATIVE_NAME, 2)); // the last lines repeat
    expect(encounterLines('Floor 3', 0)).toBeNull();
    // Faction bosses and Lineage Matriarchs speak for their World Faction.
    expect(encounterLines('Boss: Predator / Aegis', 0, 'aegis')?.before).toMatch(/Aegis champion/);
    expect(encounterLines('Matriarch of the Vesk Line', 0, 'hollow')?.before).toMatch(/Hollow champion/);
    expect(encounterLines('Floor 3', 0, 'hollow')).toBeNull();
    // She and Z also wait in the Tower: meeting them there is not a Lineage match.
    expect(meet(3).has('handler_1')).toBe(false);
    expect(unlockedFragments([rec({ opp: 'Pale Leech of Vesk' })], null).has('handler_1')).toBe(true);
  });

  it('every record can be recovered, the last one included', () => {
    const rs = [
      ...['corrosion', 'aegis', 'miasma', 'hollow'].map((w) => rec({ world: w })),
      rec({ engines: ENGINES }),
      ...FORMS.map((f) => rec({ evolution: f })),
      ...Array.from({ length: 3 }, () => rec({ opp: OPERATIVE_NAME })),
      rec({ opp: Z_NAME }),
      ...Array.from({ length: 8 }, (_, i) => rec({ opp: 'Pale Leech of Vesk', result: i % 2 ? 'win' : 'loss' })),
      ...Array.from({ length: 30 }, () => rec()),
    ];
    const p = { ...startProgress('predator', 'corrosion', chipsFor('corrosion')[0].id), tower: { floor: 50, best: TOWER_FLOORS, checkpoint: 50 }, lineagesCompleted: 1, dailyWins: 21 } as Progress;
    const got = unlockedFragments(rs, p);
    expect(FRAGMENTS.filter((f) => !got.has(f.id)).map((f) => f.id)).toEqual([]);
  });
});

describe('The recruiter', () => {
  it('each save gets one of the four World Factions, fixed by when it was created', () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => recruiterOf(1_700_000_000_000 + i * 7919)));
    expect(seen.size).toBe(4);
    expect(recruiterOf(1_712_345_678_901)).toBe(recruiterOf(1_712_345_678_901));
  });

  it('records with a clue carry one for every faction, and the clue replaces the placeholder', () => {
    const withClues = FRAGMENTS.filter((f) => f.text.includes('{clue}'));
    expect(withClues.map((f) => f.id).sort()).toEqual(['recruit', 'recruiter_answer']);
    for (const f of withClues) {
      expect(Object.keys(f.clues ?? {}).sort()).toEqual(['aegis', 'corrosion', 'hollow', 'miasma']);
      for (const w of ['aegis', 'corrosion', 'hollow', 'miasma'] as const) {
        const t = fragmentText(f, w);
        expect(t).not.toContain('{clue}');
        expect(t).toContain(f.clues![w]);
        // A clue hints; it never names the faction.
        expect(f.clues![w].toLowerCase()).not.toContain(w);
      }
    }
  });
});

describe('Z and the Unregistered Handler', () => {
  const me = startProgress('predator', 'corrosion', chipsFor('corrosion')[0].id).deck;
  it('Z is the Tower\'s last floor and the last Lineage match', () => {
    expect(floorMatch(TOWER_FLOORS, 7, me, 'You').players[1].name).toBe(Z_NAME);
    const l = { ...startLineage(startProgress('predator', 'corrosion', chipsFor('corrosion')[0].id), 'Line'), match: FLOOR_FOR_MATCH.length };
    expect(lineageMatch(l, 'You').players[1].name).toBe(Z_NAME);
  });

  it('the Unregistered Handler waits on her Tower floors, two of which Lineage also visits, as a Hollow Specimen', () => {
    for (const f of OPERATIVE_FLOORS) {
      const bot = floorMatch(f, 11, me, 'You').players[1];
      expect(bot.name).toBe(OPERATIVE_NAME);
      expect(bot.worldFaction).toBe('hollow');
    }
    const lineageHits = FLOOR_FOR_MATCH.map((f, i) => [f, i + 1] as const).filter(([f]) => OPERATIVE_FLOORS.includes(f));
    expect(lineageHits.length).toBeGreaterThanOrEqual(2);
    const l = { ...startLineage(startProgress('predator', 'corrosion', chipsFor('corrosion')[0].id), 'Line'), match: lineageHits[0][1] };
    expect(lineageMatch(l, 'You').players[1].name).toBe(OPERATIVE_NAME);
    expect(floorMatch(21, 11, me, 'You').players[1].name).not.toBe(OPERATIVE_NAME);
  });

  it('Containment Breach stays wave survival: no Z, no Handler, only escapees', () => {
    const run = startBreach(me);
    for (let w = 1; w <= 30; w++) {
      const name = waveMatch({ ...run, wave: w }, 'You').players[1].name;
      expect(name).toBe(`Escapee ${w}`);
    }
  });
});
