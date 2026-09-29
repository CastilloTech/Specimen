import { chipRows, chipsFor, starterDeck } from '../engine';
import type { MatchSetup } from '../engine';

// The tutorial: a first match against a gentle bot, with a coach that explains each part of a round as it
// comes up. Your deck is stacked so the opening hand has cheap grafts to learn on.

const KEY = 'specimen.tutorialDone';
export const TUTORIAL_BOT_HP = 24;

export const tutorialDone = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
};
export const setTutorialDone = (done = true) => {
  try {
    if (done) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* not remembered this time */
  }
};

/** Your cards in the order you draw them: an opening hand of cheap grafts, a Toxin and a Serum. */
const TOP = ['pred_predator_eye', 'pred_bone_spur', 'pred_bile_spit', 'pred_blood_rush', 'pred_razor_talon', 'pred_maw_crown', 'pred_furnace_heart', 'cor_festering_wound', 'tech_pierce', 'cor_pitted_hide'];

export function tutorialSetup(name: string): MatchSetup {
  const base = starterDeck('predator', 'corrosion');
  const rest = [...base];
  for (const id of TOP) rest.splice(rest.indexOf(id), 1);
  const chip = chipsFor('corrosion')[0].id;
  const botChip = chipsFor('aegis')[0].id;
  return {
    seed: 20260928,
    // No Second wind: it compares raw HP, so the smaller training Specimen would get it every round.
    config: { match: { catchUpDraw: 0, catchUpEnergy: 0 } },
    players: [
      { name, faction: 'predator', worldFaction: 'corrosion', chip, loadout: chipRows(chip).map((r) => r.nodes[0].id), deck: [...TOP.filter((id) => base.includes(id)), ...rest], stackedDeck: true },
      { name: 'Training Specimen', faction: 'bastion', worldFaction: 'aegis', chip: botChip, loadout: chipRows(botChip).map((r) => r.nodes[0].id), deck: starterDeck('bastion', 'aegis'), isBot: true, ai: 'basic', maxHp: TUTORIAL_BOT_HP },
    ],
  };
}
