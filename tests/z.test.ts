// Z's integration: at each Strain check, an unsettled Specimen (Overclocked or worse) loses its most worn-down
// awake graft to Z. A Stable Specimen keeps everything.
import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/engine';
import { strainCheck } from '../src/engine/rules';
import { arena, attached, edit, setStrain } from './kit';

const zMatch = () => edit(arena('bastion', 'predator'), (d) => void (d.players[1].integrates = true));
const check = (s: GameState) => edit(s, (d) => strainCheck(d));

describe('Z: integration', () => {
  it('a Stable Specimen keeps its grafts', () => {
    let s = attached(attached(zMatch(), 0, 'bast_scale_patch', 'limbA', { integrity: 1 }), 0, 'bast_bone_helm', 'head');
    s = setStrain(s, 0, 2);
    s = check(s);
    expect(s.players[0].grafts).toHaveLength(2);
  });

  it('an Overclocked Specimen loses its most worn-down awake graft, and the log says why', () => {
    let s = attached(attached(zMatch(), 0, 'bast_scale_patch', 'limbA', { integrity: 1 }), 0, 'bast_bone_helm', 'head');
    s = attached(s, 0, 'bast_shell_limb', 'limbB', { integrity: 0, faceDown: true }); // asleep: never taken
    s = setStrain(s, 0, 8);
    s = check(s);
    expect(s.players[0].grafts.map((g) => g.cardId).sort()).toEqual(['bast_bone_helm', 'bast_shell_limb']);
    expect(s.log.some((l) => / integrates .*Scale Patch.*not settled/.test(l.text))).toBe(true);
  });

  it('only a player with the trait integrates', () => {
    let s = attached(arena('bastion', 'predator'), 0, 'bast_scale_patch', 'limbA');
    s = setStrain(s, 0, 8);
    s = check(s);
    expect(s.players[0].grafts).toHaveLength(1);
  });
});
