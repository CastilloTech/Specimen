import type { GameState } from '../../engine';
import { ambushText, STANCES } from '../../engine';
import { STANCE_META } from '../meta';
import type { Keybinds } from '../storage';
import { KEY_ACTIONS, keyLabel } from '../storage';

/** A one-screen rules reminder, built from the live config so the numbers are always right. */
export function HelpSheet({ state, keybinds, onClose }: { state: GameState; keybinds: Keybinds; onClose: () => void }) {
  const KEYS: [string, string][] = [
    ...KEY_ACTIONS.map((a): [string, string] => [keyLabel(keybinds[a.id]), `${a.label}: ${a.hint}`]),
    ['1 / 2 / 3', 'Aggress / Adapt / Fortify (always works)'],
    ['1 - 9', 'Select that card in your hand'],
    ['Esc', 'Cancel / close'],
  ];
  const c = state.config;
  const T = c.strain.threshold;
  const stable = Math.floor(T * c.strain.stableMaxRatio);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-2" onClick={onClose} role="dialog" aria-label="Rules help">
      <div className="pop scroll-thin max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-panel p-4 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-lg font-bold">Quick rules</h2>
          <button onClick={onClose} className="ml-auto rounded-md border border-line px-2 py-1 text-xs text-ink2 hover:border-mute">
            Close (Esc)
          </button>
        </div>

        <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-accent">Stances (secret, then revealed)</h3>
        <div className="mt-1 grid gap-1.5 sm:grid-cols-3">
          {STANCES.map((st) => (
            <div key={st} className="rounded-lg bg-black/25 p-2 text-xs">
              <div className="font-bold">
                {STANCE_META[st].glyph} {STANCE_META[st].name} <span className="font-normal text-mute">beats {STANCE_META[st].beats}</span>
              </div>
              <div className="text-ink2">{STANCE_META[st].text}</div>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-mute">The winner acts first. On a tie the player who acted second last round goes first. You get {c.timers.stanceSeconds}s to pick; once both stances are revealed you get {c.timers.actionSeconds}s per action to look over the board and plan your round.</p>

        <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-accent">Strain</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink2">
          <li>Grafts add Strain. 0-{stable} is Stable, {stable + 1}-{T} is Overclocked (+{c.strain.overclockClashBonus} Clash damage, but you take {c.strain.overclockSelfDamage} a round), above {T} the Specimen rejects: your highest-Strain graft is ejected at the round's Strain check.</li>
          <li>You vent {c.strain.ventPerRound} Strain when you did not graft last round. Fortify vents {c.strain.fortifyVent}.</li>
          <li>From round {c.match.meltdownFromRound} Meltdown adds {c.match.meltdownStrain} Strain to both Specimens every round.</li>
          <li>
            Hold: skip your own Clash damage this round for +{c.strain.holdArmor} armor (reduces what you take too) and venting {c.strain.holdVent} Strain right away. You can still play cards afterward; only the Clash damage is given up.
          </li>
        </ul>

        <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-accent">Energy, cards and grafts</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink2">
          <li>Energy equals the round number, at least {c.energy.min} and at most {c.energy.cap}, and does not carry over. You draw {c.match.drawPerRound} card a round, and {c.match.drawPerRound + c.match.lateDraw} from round {c.match.lateDrawFromRound}.</li>
          {c.match.catchUpDraw > 0 && (
            <li>Second wind: if you are {c.match.catchUpHpGap}+ HP behind at the start of a round, you draw {c.match.catchUpDraw} extra card{c.match.catchUpDraw === 1 ? '' : 's'}{c.match.catchUpEnergy > 0 ? ` and gain ${c.match.catchUpEnergy} extra Energy` : ''}.</li>
          )}
          <li>Your hand holds at most {c.match.maxHand} cards. A card drawn into a full hand is burned (discarded), so play or Cycle cards rather than hoarding them.</li>
          {c.replace.enabled && <li>Playing a graft on an occupied slot replaces it for {c.replace.extraCost} extra Energy (the old graft leaves with its Strain).</li>}
          <li>Face-down grafts are asleep: no stats or text, {c.dormant.quietStrain} less Strain until they wake. Waking one on purpose after it has slept a round gives an Ambush for that round: Predator {ambushText(c, 'predator')}; Parasite {ambushText(c, 'parasite')}; Bastion {ambushText(c, 'bastion')}. Scanner Probe and Sabotage wake them by force, with no Ambush.</li>
        </ul>

        <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-accent">Integrity and statuses</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink2">
          <li>Every graft also has its own small Integrity pool (usually {c.integrity.default}), separate from your own HP and Strain. Some cards chip a specific graft's Integrity directly (bypassing armor); at 0 it is destroyed, which is not a rejection.</li>
          {c.integrity.clashDamageDivisor > 0 && (
            <li>Clash wear: whenever you take Clash damage, your awake graft with the most Integrity loses 1 Integrity per {c.integrity.clashDamageDivisor} damage taken (rounded up, so any hit wears at least 1). The ⬢ badge turns amber when worn and red at 1.</li>
          )}
          <li>Bleed: {c.status.bleedDamage} damage at the start of each round while it lasts.</li>
          <li>Numb: Protocols cannot be played while it lasts.</li>
          <li>Fever: grafts cost {c.status.feverCostIncrease} more Energy while it lasts.</li>
          <li>Necrosis: the slot a destroyed graft was in cannot be refilled for a few rounds.</li>
          <li>A Purge-style effect clears your own Bleed, Numb, Fever and Necrosis at once.</li>
          {c.status.parasiteInfectStrain > 0 && (
            <li>Infect (Parasite Build): whenever a Parasite gives the opponent a Bleed, Numb or Fever they did not already have, the opponent also gains {c.status.parasiteInfectStrain} Strain.</li>
          )}
        </ul>

        <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-accent">Evolution</h3>
        <p className="mt-1 text-xs text-ink2">
          Each Specimen evolves once, permanently, into one of its two forms. Meeting a form's condition always offers a choice: evolve now, or hold off — you'll be offered again at the next Strain check if it (or the other form) still qualifies. The bars under each player show progress, and a banner announces the form and what it gives when someone evolves.
        </p>

        {c.match.koTiebreak && <p className="mt-2 text-[11px] text-mute">If both Specimens reach 0 HP together, the lower Strain wins, then the player who dealt more damage.</p>}

        <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-accent">Keyboard</h3>
        <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
          {KEYS.map(([k, v]) => (
            <div key={`${k}${v}`} className="flex gap-2">
              <span className="w-16 shrink-0 font-mono text-accent">{k}</span>
              <span className="text-ink2">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
