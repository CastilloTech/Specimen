import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import specimenArt from '../../assets/specimen.jpg';
import { CARD_MAP, defaultConfig, STANCES } from '../../engine';
import { CardDetail } from '../components/CardDetail';
import { CardView } from '../components/CardView';
import { ChipArt, Emblem } from '../components/Emblem';
import { FACTION_META, STANCE_META, WORLD_FACTION_META } from '../meta';
import { StatusIcon } from '../components/StatusFx';
import { BUILD_GUIDE } from '../comboGuide';
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
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap justify-center gap-3 pt-2">
      {ids.filter((id) => CARD_MAP[id]).map((id) => (
        <CardView key={id} def={CARD_MAP[id]} size="sm" onClick={() => setOpen(id)} />
      ))}
      {open && <CardDetail def={CARD_MAP[open]} onClose={() => setOpen(null)} />}
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

type Wf = keyof typeof WORLD_FACTION_META;
const ST = c.status;
/** Each World Faction's status effects (and Aegis's answer to them), with the icons used on the board. */
const STATUS_BY_FACTION: { wf: Wf; items: { icon: 'bleed' | 'numb' | 'fever' | 'necrosis' | 'purge' | 'drain'; color: string; name: string; text: string }[] }[] = [
  {
    wf: 'corrosion',
    items: [
      { icon: 'bleed', color: '#ef4444', name: 'Bleed', text: `${ST.bleedDamage} damage per stack at each Strain check for ${ST.bleedRounds} rounds. Bleeding again adds a stack (up to ${ST.bleedMaxStacks}) and refreshes it.` },
    ],
  },
  {
    wf: 'miasma',
    items: [
      { icon: 'numb', color: '#a78bfa', name: 'Numb', text: `No Protocols for ${ST.numbRounds} rounds: they can't answer your plays.` },
      { icon: 'fever', color: '#fb923c', name: 'Fever', text: `Their grafts cost ${ST.feverCostIncrease} more Energy for ${ST.feverRounds} rounds.` },
    ],
  },
  {
    wf: 'hollow',
    items: [
      { icon: 'necrosis', color: '#e879f9', name: 'Necrosis', text: `Destroys a graft and locks its slot: nothing can be attached there for ${c.sabotage.necrosisRounds} rounds.` },
      { icon: 'drain', color: '#38bdf8', name: 'Energy Drain', text: 'The opponent loses Energy: right away on your turn, or off their next refill when it lands during the Clash or Strain check.' },
    ],
  },
  {
    wf: 'aegis',
    items: [{ icon: 'purge', color: '#7be0b0', name: 'Purge & repair', text: 'Inflicts no status: Purge clears your own Bleed, Numb, Fever and Necrosis, and Aegis heals graft Integrity.' }],
  },
];

function StatusTable() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {STATUS_BY_FACTION.map(({ wf, items }) => (
        <div key={wf} className="rounded-lg border border-line bg-black/25 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 font-display text-sm font-bold" style={{ color: WORLD_FACTION_META[wf].color }}>
            <Emblem id={wf} size={20} />
            {WORLD_FACTION_META[wf].name}
          </div>
          <ul className="space-y-1.5">
            {items.map((it) => (
              <li key={it.name} className="flex gap-2 text-[12px] leading-snug">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: `${it.color}33`, color: it.color }}>
                  <StatusIcon kind={it.icon} className="h-3 w-3" />
                </span>
                <span>
                  <b style={{ color: it.color }}>{it.name}</b> <span className="text-ink2">{it.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The three Builds: how each plays and its two evolutions (with their conditions). */
function BuildTable() {
  const forms = c.evolutions as Record<string, { id: string; name: string; text: string }[]>;
  return (
    <div className="grid gap-2 lg:grid-cols-3">
      {(Object.keys(FACTION_META) as (keyof typeof FACTION_META)[]).map((f) => (
        <div key={f} className="rounded-lg border border-line bg-black/25 p-2.5">
          <div className="mb-1 flex items-center gap-2">
            <ChipArt id={f} size={36} />
            <span className="font-display text-base font-bold" style={{ color: FACTION_META[f].color }}>
              {FACTION_META[f].name}
            </span>
          </div>
          <p className="text-[12px] leading-snug text-ink">{BUILD_GUIDE[f].plan}</p>
          <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-mute">Evolutions</div>
          <ul className="mt-0.5 space-y-1">
            {forms[f].map((d) => (
              <li key={d.id} className="text-[11.5px] leading-snug">
                <b style={{ color: FACTION_META[f].color }}>{d.name}</b> <span className="text-ink2">{d.text}</span>
              </li>
            ))}
          </ul>
        </div>
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
          <b>Draw.</b> You draw {c.match.drawPerRound === 1 ? 'a card' : `${c.match.drawPerRound} cards`} ({c.match.drawPerRound + c.match.lateDraw} from round {c.match.lateDrawFromRound}) and refill Energy: {c.energy.min} at first, then one more each round up to {c.energy.cap}. Unspent Energy is lost.
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
    tip: `Tap a card to pick it up, then tap a glowing slot. Hold (or right-click) a card to read it in full. ★ Signature cards are one per deck and become Veteran after ${c.veterancy.signatureThreshold} Strain checks; Mastery Signatures, unlocked by Faction achievements, go on to Elite at ${c.veterancy.eliteThreshold}.`,
  },
  {
    title: 'More moves',
    body: (
      <ul className="space-y-1.5">
        <li>
          <b>Hold</b>: give up your Clash damage this round for +{c.strain.holdArmor} armor and an instant vent of {c.strain.holdVent} Strain. You can still play cards.
        </li>
        <li>
          <b>Cycle</b> (once a round): discard a card to vent {c.cycle.ventAmount} Strain or draw {c.cycle.drawAmount}.
        </li>
        <li>
          <b>Face-down graft</b>: play a graft asleep. It gives nothing yet, costs {c.dormant.quietStrain} less Strain, and hides from the opponent. Wake it after it has slept a round for an <b>Ambush</b> bonus that round.
        </li>
        {c.replace.enabled && (
          <li>
            <b>Replace</b>: a graft on an occupied slot swaps out the old one for {c.replace.extraCost} extra Energy; the old one leaves with its Strain.
          </li>
        )}
        <li>
          <b>Hand limit</b>: {c.match.maxHand} cards. A card drawn into a full hand is burned, so play or Cycle rather than hoard.
        </li>
      </ul>
    ),
    tip: 'Hold is your best move when you are about to take a big hit anyway, or are close to rejecting.',
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
                <Emblem id={f} size={16} className="mr-0.5 -mt-0.5 align-middle" />
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
                <Emblem id={f} size={16} className="mr-0.5 -mt-0.5 align-middle" />
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
    title: 'Builds and evolution',
    body: (
      <>
        <p>
          Your <b>Build</b> decides how your Specimen treats Strain and which two forms it can evolve into. Predator races, Parasite wears the opponent down, Bastion out-lasts.
        </p>
        <p>
          <b>Evolving</b>: the two bars under your HP track each form's condition. When one is met you choose to evolve now (permanent, one per match) or hold off for the other. Steer toward whichever bar is closer; on a phone, tap the Evolve block to see the conditions.
        </p>
      </>
    ),
    visual: <BuildTable />,
    tip: "The Save screen's Combo guide has a fuller plan for every Build / World Faction pairing, plus tips from your own matches.",
  },
  {
    title: 'World Factions and status effects',
    body: (
      <>
        <p>Three World Factions put <b>status effects</b> on the opponent; the fourth, Aegis, is the cure. A status shows as an aura on the afflicted tank and a badge with the rounds left.</p>
        <p>
          Parasite's Build trait, <b>Infect</b>, adds {ST.parasiteInfectStrain} Strain whenever it gives a status the opponent didn't already have, so Parasite pairs well with any of them.
        </p>
      </>
    ),
    visual: <StatusTable />,
    tip: "Statuses tick down at the end of each round. Purge clears them all at once, so save it for when you're carrying more than one.",
  },
  {
    title: "You're ready",
    body: (
      <>
        <p>
          Start with <b>Quick match</b> from the menu. Press <HelpKey /> in a match for the full rules and your key bindings (change them in Settings).
        </p>
        <p>
          Create a <b>Save</b> to keep your decks and default picks, and to see stats and tips from your own matches. A Save also tracks <b>Faction mastery</b>: master a Build or World Faction to unlock its Mastery Signature card.
        </p>
      </>
    ),
  },
];

const STEP_KEY = 'specimen.guide.step';
const readStep = () => {
  try {
    const n = Number(localStorage.getItem(STEP_KEY));
    return Number.isInteger(n) && n > 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
};

export function GuideScreen({ onBack, onPlay }: { onBack: () => void; onPlay: () => void }) {
  const [i, setIRaw] = useState(readStep); // reopens where you left off
  const [toc, setToc] = useState(false);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const setI = (f: number | ((v: number) => number)) =>
    setIRaw((v) => {
      const n = Math.max(0, Math.min(STEPS.length - 1, typeof f === 'function' ? f(v) : f));
      try {
        localStorage.setItem(STEP_KEY, String(n));
      } catch {
        /* not remembered this time */
      }
      return n;
    });
  useEffect(() => {
    window.scrollTo(0, 0); // each page starts at its top
  }, [i]);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (e.key === 'ArrowRight') setI((v) => v + 1);
    if (e.key === 'ArrowLeft') setI((v) => v - 1);
    if (e.key === 'Escape') {
      if (toc) setToc(false);
      else onBack();
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);
  // Swipe left / right on touch screens (a mostly horizontal swipe of 60px or more).
  const touch = useRef<[number, number] | null>(null);
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current[0];
    const dy = e.changedTouches[0].clientY - touch.current[1];
    touch.current = null;
    if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setI((v) => v + (dx < 0 ? 1 : -1));
  };
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-3 p-4 pb-0" onTouchStart={(e) => (touch.current = [e.touches[0].clientX, e.touches[0].clientY])} onTouchEnd={onTouchEnd}>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="lab-label">Game guide · {i + 1} of {STEPS.length}</div>
          <h1 className="font-display text-2xl font-bold phone:text-xl">{step.title}</h1>
        </div>
        <div className="ml-auto flex shrink-0 gap-1.5">
          <button onClick={() => setToc((v) => !v)} aria-expanded={toc} className={`rounded-md border px-3 py-1.5 text-sm ${toc ? 'border-accent text-accent' : 'border-line text-ink2 hover:border-mute'}`}>
            Contents
          </button>
          <button onClick={onBack} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink2 hover:border-mute">
            Close
          </button>
        </div>
      </div>
      <nav className="flex gap-1" aria-label="Guide pages">
        {STEPS.map((st, k) => (
          <button key={k} onClick={() => setI(k)} aria-label={`Page ${k + 1}: ${st.title}`} aria-current={k === i ? 'step' : undefined} title={st.title} className="group flex-1 py-1.5">
            <span className={`block h-1.5 rounded-full transition ${k === i ? 'bg-accent' : k < i ? 'bg-accent/50' : 'bg-line group-hover:bg-mute'}`} />
          </button>
        ))}
      </nav>
      {toc ? (
        <ol className="pop lab-panel divide-y divide-line/60 rounded-2xl border border-line" aria-label="Contents">
          {STEPS.map((st, k) => (
            <li key={k}>
              <button
                onClick={() => {
                  setI(k);
                  setToc(false);
                }}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm ${k === i ? 'text-accent' : 'text-ink hover:bg-white/5'}`}
              >
                <span className="w-5 shrink-0 text-right font-display text-xs text-mute">{k + 1}</span>
                <span className="font-semibold">{st.title}</span>
                {k === i && <span className="ml-auto text-[10px] uppercase tracking-wider">here</span>}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <section key={i} className="pop lab-panel flex flex-col gap-4 rounded-2xl border border-line p-5 phone:p-3">
          {step.visual && <div className="flex justify-center">{step.visual}</div>}
          <div className="space-y-2 text-sm leading-relaxed text-ink">{step.body}</div>
          {step.tip && <div className="rounded-lg border-l-2 border-accent bg-black/25 px-3 py-2 text-xs text-ink2">Tip: {step.tip}</div>}
        </section>
      )}
      {/* Always reachable, however long the page. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex gap-2 border-t border-line bg-bg/90 px-4 pt-3 backdrop-blur" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <button onClick={() => setI((v) => v - 1)} disabled={i === 0} className="rounded-xl bg-panel2 px-5 py-3 font-semibold disabled:opacity-40">
          Back
        </button>
        {last ? (
          <button onClick={onPlay} className="flex-1 rounded-xl bg-accent px-4 py-3 font-display font-bold text-black">
            Play a Quick match
          </button>
        ) : (
          <button onClick={() => setI((v) => v + 1)} autoFocus className="min-w-0 flex-1 truncate rounded-xl bg-accent px-4 py-3 font-display font-bold text-black">
            Next<span className="hidden sm:inline phone:inline">: {STEPS[i + 1].title}</span>
          </button>
        )}
      </div>
    </div>
  );
}
