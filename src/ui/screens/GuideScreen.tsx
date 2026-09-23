import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import specimenArt from '../../assets/specimen.jpg';
import { CARD_MAP, defaultConfig, STANCES } from '../../engine';
import { CardView } from '../components/CardView';
import { FACTION_META, STANCE_META, WORLD_FACTION_META } from '../meta';
import { keyLabel, loadSettings } from '../storage';

const c = defaultConfig;

const HelpKey = () => <b className="rounded bg-black/40 px-1.5 font-mono">{keyLabel(loadSettings().keybinds.help)}</b>;
const T = c.strain.threshold;
const STABLE = Math.floor(T * c.strain.stableMaxRatio);

function StrainBar() {
  return (
    <div className="w-full max-w-sm">
      <div className="flex gap-[3px]">
        {Array.from({ length: T + 3 }, (_, k) => k + 1).map((i) => (
          <div key={i} className={`h-5 flex-1 rounded-sm ${i <= STABLE ? 'bg-stable' : i <= T ? 'bg-oc' : 'bg-rej'}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px]">
        <span className="text-emerald-300">0–{STABLE} Stable</span>
        <span className="text-amber-300">
          {STABLE + 1}–{T} Overclocked
        </span>
        <span className="text-red-300">{T + 1}+ Rejection</span>
      </div>
    </div>
  );
}

function StanceTriangle() {
  return (
    <div className="grid w-full max-w-md grid-cols-3 gap-2">
      {STANCES.map((st) => (
        <div key={st} className="rounded-xl border border-line bg-panel2 p-2 text-center">
          <div className="text-3xl">{STANCE_META[st].glyph}</div>
          <div className="font-display font-bold">{STANCE_META[st].name}</div>
          <div className="text-[11px] text-ink2">{STANCE_META[st].text}</div>
        </div>
      ))}
    </div>
  );
}

function Cards({ ids }: { ids: string[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-3 pt-2">
      {ids.filter((id) => CARD_MAP[id]).map((id) => (
        <CardView key={id} def={CARD_MAP[id]} size="sm" />
      ))}
    </div>
  );
}

function SpecimenPicture() {
  const tags: [string, string, string][] = [
    ['Head', '46%', '16%'],
    ['Nerve', '57%', '33%'],
    ['Organ', '55%', '51%'],
    ['Limb', '17%', '71%'],
    ['Limb', '82%', '66%'],
  ];
  return (
    <div className="relative aspect-square w-56 overflow-hidden rounded-[24px] border border-accent/30">
      <img src={specimenArt} alt="The Specimen" className="h-full w-full object-cover" />
      {tags.map(([t, x, y], i) => (
        <span key={i} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-cyan-200/60 bg-black/65 px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase tracking-wider text-cyan-100" style={{ left: x, top: y }}>
          {t}
        </span>
      ))}
    </div>
  );
}

interface Step {
  title: string;
  body: ReactNode;
  visual?: ReactNode;
  tip?: string;
}

const STEPS: Step[] = [
  {
    title: 'The goal',
    body: (
      <>
        <p>
          Two players, one creature each: your <b>Specimen</b>. Both start at <b>{c.specimen.hp} HP</b>. Bring the other Specimen to 0 HP to win. If nobody falls in <b>{c.match.maxRounds} rounds</b>, the higher HP wins (then the lower Strain).
        </p>
        <p>You make it stronger by attaching <b>grafts</b>, but every graft adds <b>Strain</b>, and a Specimen pushed too far rejects its grafts.</p>
      </>
    ),
    visual: <SpecimenPicture />,
  },
  {
    title: 'A round, step by step',
    body: (
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          <b>Draw.</b> You draw a card and get Energy: {c.energy.min} in the first rounds, then one more each round up to {c.energy.cap}. Unspent Energy is lost.
        </li>
        <li>
          <b>Pick a stance</b> in secret. Both are revealed together; the winner acts first.
        </li>
        <li>
          <b>Actions.</b> Take turns playing cards. Passing twice in a row ends the phase.
        </li>
        <li>
          <b>Clash.</b> Both Specimens hit each other: your attack minus their armor.
        </li>
        <li>
          <b>Strain check.</b> Over the limit? Your highest-Strain graft is ejected.
        </li>
      </ol>
    ),
    tip: 'Tap Pass when you have nothing useful left to play. The Pass button glows when nothing is playable.',
  },
  {
    title: 'Stances: a secret triangle',
    body: <p>Each round you secretly choose one of three stances. Each beats one and loses to another, like rock-paper-scissors. The one that wins also acts first. The bot remembers your last stance and tries to counter it, so mix it up.</p>,
    visual: <StanceTriangle />,
    tip: 'Against a heavily armored Specimen, Adapt ignores armor completely.',
  },
  {
    title: 'Strain: power at a price',
    body: (
      <>
        <p>
          Grafts add Strain. Stay <b className="text-emerald-300">Stable</b> and you are safe. Push into <b className="text-amber-300">Overclock</b> for +{c.strain.overclockClashBonus} Clash damage, at {c.strain.overclockSelfDamage} self-damage a round. Go past {T} and at the Strain check your Specimen <b className="text-red-300">rejects</b> its highest-Strain graft.
        </p>
        <p>
          Vent Strain by skipping a graft for a round, picking Fortify (vents {c.strain.fortifyVent}), Holding, or Cycling a card. From round {c.match.meltdownFromRound}, <b>Meltdown</b> adds {c.match.meltdownStrain} Strain to both players every round.
        </p>
      </>
    ),
    visual: <StrainBar />,
  },
  {
    title: 'Your cards',
    body: (
      <ul className="space-y-1">
        <li>
          <b className="text-emerald-300">Graft</b>: attaches to a slot (Head, Limb, Organ, Nerve). Gives attack, armor and an ability, and adds Strain.
        </li>
        <li>
          <b className="text-sky-300">Serum</b>: helps you right away (heal, vent, buff).
        </li>
        <li>
          <b className="text-violet-300">Toxin</b>: hurts or strains the opponent.
        </li>
        <li>
          <b className="text-amber-300">Protocol</b>: a reaction. You play it only when your opponent plays something.
        </li>
        <li>
          <b className="text-red-300">Sabotage</b>: targets one enemy graft.
        </li>
      </ul>
    ),
    visual: <Cards ids={['pred_maw_crown', 'pred_overclock_serum', 'pred_bile_spit', 'pred_blood_scent', 'pred_rending_claw']} />,
    tip: 'Tap a card to pick it up, then tap a glowing slot. Double-tap plays an instant card straight away.',
  },
  {
    title: 'Integrity: grafts can break',
    body: (
      <>
        <p>
          Every graft has its own small HP, <b>Integrity (⬢)</b>. Whenever you take Clash damage, your toughest graft loses a little (1 per {c.integrity.clashDamageDivisor} damage, at least 1). Some cards hit a graft's Integrity directly. At 0 it is destroyed.
        </p>
        <p>The ⬢ badge on a graft turns amber when worn and red at 1. A worn graft is a good reason to Hold, or to repair it with Aegis cards.</p>
      </>
    ),
  },
  {
    title: 'Build, World Faction and Chip',
    body: (
      <>
        <p>You bring three choices to every match:</p>
        <ul className="mt-1 space-y-1">
          <li>
            <b>Build</b>: how your Specimen handles Strain, plus half your deck and your two evolutions.{' '}
            {(Object.keys(FACTION_META) as (keyof typeof FACTION_META)[]).map((f, i) => (
              <span key={f}>
                {i > 0 && ', '}
                <span style={{ color: FACTION_META[f].color }}>{FACTION_META[f].name}</span>
              </span>
            ))}
            .
          </li>
          <li>
            <b>World Faction</b>: a second card pool with its own theme.{' '}
            {(Object.keys(WORLD_FACTION_META) as (keyof typeof WORLD_FACTION_META)[]).map((f, i) => (
              <span key={f}>
                {i > 0 && ', '}
                <span style={{ color: WORLD_FACTION_META[f].color }}>{WORLD_FACTION_META[f].name}</span>
              </span>
            ))}
            .
          </li>
          <li>
            <b>Chip</b>: a loadout item from your World Faction, with 2 rows of 2 skill nodes. You pick one node in each row.
          </li>
        </ul>
      </>
    ),
    tip: 'Any Build works with any World Faction. Try a few combinations; your Save shows which ones win for you.',
  },
  {
    title: 'Evolution',
    body: (
      <>
        <p>
          Each Build has two forms. The two bars under your HP track their conditions (for example, deal damage, or vent Strain). When one is met you choose: <b>evolve now</b> (permanent, one per match) or hold off for the other form.
        </p>
        <p>Evolving is a big boost. Steer your play toward whichever bar is closer.</p>
      </>
    ),
  },
  {
    title: "You're ready",
    body: (
      <>
        <p>
          Start with <b>Quick match</b> from the menu. Press <HelpKey /> in a match for the full rules and your key bindings (change them in Settings).
        </p>
        <p>
          Create a <b>Save</b> to keep your decks and default picks, and to see stats and tips from your own matches.
        </p>
      </>
    ),
  },
];

export function GuideScreen({ onBack, onPlay }: { onBack: () => void; onPlay: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((v) => Math.min(STEPS.length - 1, v + 1));
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <div>
          <div className="lab-label">Game guide · {i + 1} of {STEPS.length}</div>
          <h1 className="font-display text-2xl font-bold">{step.title}</h1>
        </div>
        <button onClick={onBack} className="ml-auto rounded-md border border-line px-3 py-1.5 text-sm text-ink2 hover:border-mute">
          Close
        </button>
      </div>
      <div className="flex gap-1" aria-hidden>
        {STEPS.map((_, k) => (
          <button key={k} onClick={() => setI(k)} className={`h-1.5 flex-1 rounded-full ${k <= i ? 'bg-accent' : 'bg-line'}`} tabIndex={-1} />
        ))}
      </div>
      <section key={i} className="pop lab-panel flex flex-col gap-4 rounded-2xl border border-line p-5">
        {step.visual && <div className="flex justify-center">{step.visual}</div>}
        <div className="space-y-2 text-sm leading-relaxed text-ink">{step.body}</div>
        {step.tip && <div className="rounded-lg border-l-2 border-accent bg-black/25 px-3 py-2 text-xs text-ink2">Tip: {step.tip}</div>}
      </section>
      <div className="mt-auto flex gap-2">
        <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0} className="rounded-xl bg-panel2 px-5 py-3 font-semibold disabled:opacity-40">
          Back
        </button>
        {last ? (
          <button onClick={onPlay} className="flex-1 rounded-xl bg-accent px-4 py-3 font-display font-bold text-black">
            Play a Quick match
          </button>
        ) : (
          <button onClick={() => setI((v) => v + 1)} autoFocus className="flex-1 rounded-xl bg-accent px-4 py-3 font-display font-bold text-black">
            Next
          </button>
        )}
      </div>
    </div>
  );
}
