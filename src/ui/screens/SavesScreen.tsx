import { useState } from 'react';
import { chipOf, defaultConfig } from '../../engine';
import { ACHIEVEMENTS, achievementStates } from '../achievements';
import { FACTION_META, STANCE_META, WORLD_FACTION_META } from '../meta';
import type { Analysis, Split, StanceUse } from '../stats';
import { analyze, pct } from '../stats';
import type { MatchRecord } from '../storage';
import { createSave, deleteSave, loadDecks, loadLastSetup, loadMatches, loadSaveIndex, renameSave, SAVE_SLOTS, setActiveSave } from '../storage';

export function SavesScreen({ onBack }: { onBack: () => void }) {
  // Storage is the source of truth; bump this to re-read it after a change.
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const idx = loadSaveIndex();
  const [naming, setNaming] = useState<{ slot: number; name: string; rename: boolean } | null>(null);

  const submitName = () => {
    if (!naming || !naming.name.trim()) return;
    if (naming.rename) renameSave(naming.slot, naming.name);
    else createSave(naming.slot, naming.name);
    setNaming(null);
    refresh();
  };

  const active = idx.active;
  const matches = active === null ? [] : loadMatches(active);
  const analysis = analyze(matches);

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-3 p-4">
      <div className="flex items-end gap-2">
        <div>
          <div className="lab-label">Specimen records</div>
          <h1 className="font-display text-2xl font-bold">Saves</h1>
        </div>
        <button onClick={onBack} className="ml-auto rounded-md border border-line px-3 py-1.5 text-sm text-ink2 hover:border-mute">
          ← Menu
        </button>
      </div>
      <p className="text-xs text-ink2">A save keeps your player name, your decks and Chip loadouts, your default Build / World Faction / Chip (your last picks), and the stats of every match you finish while it is loaded.</p>

      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: SAVE_SLOTS }, (_, slot) => {
          const meta = idx.slots[slot];
          const isActive = active === slot;
          const editing = naming?.slot === slot;
          if (!meta || (editing && !naming.rename)) {
            return (
              <section key={slot} className="lab-panel flex flex-col gap-2 rounded-xl border border-dashed border-line p-3">
                <div className="lab-label">Slot {slot + 1}</div>
                {editing ? (
                  <NameForm value={naming.name} onChange={(name) => setNaming({ ...naming, name })} onSubmit={submitName} onCancel={() => setNaming(null)} submitLabel="Create save" />
                ) : (
                  <>
                    <div className="text-sm text-mute">Empty</div>
                    <button onClick={() => setNaming({ slot, name: '', rename: false })} className="mt-auto rounded-lg bg-accent px-3 py-2 font-display text-sm font-bold text-black">
                      New save
                    </button>
                  </>
                )}
              </section>
            );
          }
          const recs = loadMatches(slot);
          const w = recs.filter((r) => r.result === 'win').length;
          const def = loadLastSetup(slot)?.[0];
          const decks = loadDecks(slot).length;
          return (
            <section key={slot} className={`lab-panel flex flex-col gap-2 rounded-xl border p-3 ${isActive ? 'turn-glow border-accent' : 'border-line'}`}>
              <div className="flex items-center gap-2">
                <span className="lab-label">Slot {slot + 1}</span>
                {isActive && <span className="ml-auto rounded bg-accent px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-black">Loaded</span>}
              </div>
              {editing ? (
                <NameForm value={naming.name} onChange={(name) => setNaming({ ...naming, name })} onSubmit={submitName} onCancel={() => setNaming(null)} submitLabel="Rename" />
              ) : (
                <div className="truncate font-display text-xl font-bold">{meta.name}</div>
              )}
              <div className="space-y-0.5 text-xs text-ink2">
                <div>
                  {recs.length} match{recs.length === 1 ? '' : 'es'} · {w} won{recs.length ? ` (${pct(w / recs.length)})` : ''}
                </div>
                <div>
                  Defaults:{' '}
                  {def ? (
                    <>
                      <span style={{ color: FACTION_META[def.faction]?.color }}>{FACTION_META[def.faction]?.name}</span> / <span style={{ color: WORLD_FACTION_META[def.worldFaction]?.color }}>{WORLD_FACTION_META[def.worldFaction]?.name}</span> / {chipOf(def.chip)?.name ?? def.chip}
                    </>
                  ) : (
                    <span className="text-mute">set when you start a Vs Bot match</span>
                  )}
                </div>
                <div>
                  {decks} saved deck{decks === 1 ? '' : 's'} · since {new Date(meta.created).toLocaleDateString()}
                </div>
                <div className="text-amber-300">
                  ★ {achievementStates(recs).filter((s) => s.unlocked).length}/{ACHIEVEMENTS.length} achievements
                </div>
              </div>
              <div className="mt-auto flex gap-1.5 pt-1">
                {isActive ? (
                  <button onClick={() => (setActiveSave(null), refresh())} className="flex-1 rounded-lg bg-panel2 px-2 py-1.5 text-xs font-semibold">
                    Unload
                  </button>
                ) : (
                  <button onClick={() => (setActiveSave(slot), refresh())} className="flex-1 rounded-lg bg-accent px-2 py-1.5 font-display text-xs font-bold text-black">
                    Load
                  </button>
                )}
                <button onClick={() => setNaming({ slot, name: meta.name, rename: true })} className="rounded-lg bg-panel2 px-2 py-1.5 text-xs font-semibold">
                  Rename
                </button>
                <button onClick={() => window.confirm(`Delete "${meta.name}"? Its decks, defaults and match stats are erased.`) && (deleteSave(slot), refresh())} className="rounded-lg bg-panel2 px-2 py-1.5 text-xs font-semibold text-red-300">
                  Delete
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {active !== null && <AchievementGallery records={matches} />}

      {active === null ? (
        <div className="lab-panel rounded-xl border border-line p-4 text-sm text-ink2">No save is loaded. You can still play, but decks and picks are kept only as unsaved defaults on this device, and match stats and achievements are not recorded. Create or load a save to track your progress.</div>
      ) : analysis ? (
        <StatsPanel name={idx.slots[active]!.name} a={analysis} recent={matches.slice(-8).reverse()} />
      ) : (
        <div className="lab-panel rounded-xl border border-line p-4 text-sm text-ink2">No matches recorded for this save yet. Finish a match and your stats and tips will show up here.</div>
      )}
    </div>
  );
}

function AchievementGallery({ records }: { records: MatchRecord[] }) {
  const states = achievementStates(records);
  const got = states.filter((s) => s.unlocked).length;
  // Unlocked first (newest first), then locked by how close they are.
  const sorted = [...states].sort((x, y) => (x.unlocked === y.unlocked ? (x.unlocked ? (y.at ?? 0) - (x.at ?? 0) : y.have / y.need - x.have / x.need) : x.unlocked ? -1 : 1));
  return (
    <section className="lab-panel rounded-xl border border-line p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-lg font-bold">Achievements</h2>
        <span className="text-xs text-mute">
          {got} of {states.length} unlocked
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map(({ a, have, need, unlocked, at }) => (
          <div key={a.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${unlocked ? 'border-amber-400/50 bg-amber-950/25' : 'border-line bg-black/20'}`}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-lg ${unlocked ? 'bg-amber-400 text-black' : 'bg-panel2 text-mute'}`}>{a.icon}</span>
            <div className="min-w-0 flex-1">
              <div className={`truncate font-display text-sm font-bold ${unlocked ? 'text-amber-200' : 'text-ink2'}`}>{a.name}</div>
              <div className="text-[11px] leading-snug text-ink2">{a.text}</div>
              {unlocked ? (
                <div className="text-[10px] text-mute">{at ? `Unlocked ${new Date(at).toLocaleDateString()}` : 'Unlocked'}</div>
              ) : need > 1 ? (
                <div className="mt-1 flex items-center gap-2" title={`${have} of ${need}`}>
                  <div className="h-1.5 flex-1 rounded bg-black/40">
                    <div className="h-full rounded bg-amber-400/70" style={{ width: `${(have / need) * 100}%` }} />
                  </div>
                  <span className="text-[10px] tabular-nums text-mute">
                    {have}/{need}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function NameForm({ value, onChange, onSubmit, onCancel, submitLabel }: { value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void; submitLabel: string }) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} maxLength={16} placeholder="Player name" aria-label="Player name" className="rounded-md border border-line bg-black/30 px-2 py-1.5 text-sm font-bold" />
      <div className="flex gap-1.5">
        <button type="submit" disabled={!value.trim()} className="flex-1 rounded-lg bg-accent px-2 py-1.5 font-display text-xs font-bold text-black disabled:opacity-40">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg bg-panel2 px-2 py-1.5 text-xs font-semibold">
          Cancel
        </button>
      </div>
    </form>
  );
}

function StatsPanel({ name, a, recent }: { name: string; a: Analysis; recent: MatchRecord[] }) {
  const num = (x: number | null, digits = 1) => (x === null ? '—' : x.toFixed(digits));
  const facts: [string, string, string?][] = [
    ['Match length', `${a.avg.rounds.toFixed(1)} rounds`],
    ['Wins by KO', a.koWinShare === null ? '—' : pct(a.koWinShare), 'the rest won on HP after the last round'],
    ['Comeback wins', String(a.comebacks), `won after trailing by ${defaultConfig.match.catchUpHpGap}+ HP`],
    ['HP left in wins', num(a.avg.hpLeftInWins, 0)],
    ['Evolved', pct(1 - a.avg.noEvolution), a.avg.evolvedRound === null ? undefined : `on average in round ${a.avg.evolvedRound.toFixed(1)}`],
    ['Peak Strain', num(a.avg.peakStrain), `rejects above ${defaultConfig.strain.threshold}`],
    ['Rejections', num(a.avg.rejections, 2), 'per match'],
    ['Damage dealt / taken', `${a.avg.dealt.toFixed(0)} / ${a.avg.taken.toFixed(0)}`, 'per match'],
    ['Damage blocked', num(a.avg.blocked, 0), 'per match'],
    ['HP healed', num(a.avg.healed, 0), 'per match'],
    ['Cards played', num(a.avg.cardsPlayed), 'per match'],
    ['Grafts destroyed', a.avg.graftsKilled === null ? '—' : `${a.avg.graftsKilled.toFixed(1)} / ${num(a.avg.graftsLost)}`, 'theirs / yours, via Integrity'],
    ['Cards burned', num(a.avg.burned), `drawn into a full ${defaultConfig.match.maxHand}-card hand`],
  ];
  return (
    <section className="lab-panel flex flex-col gap-4 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="font-display text-lg font-bold">{name}'s record</h2>
        <span className="text-xs text-mute">{a.games} matches</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Win rate" value={pct(a.rate)} sub={`${a.wins}W ${a.losses}L ${a.draws}D`} />
        <Stat label="Last 10" value={a.recentRate === null ? '—' : pct(a.recentRate)} sub={a.recentRate === null ? 'after 10 matches' : a.recentRate > a.rate ? 'trending up' : a.recentRate < a.rate ? 'trending down' : 'steady'} />
        <Stat label="Streak" value={a.streak ? `${a.streak.n} ${a.streak.kind === 'win' ? 'W' : a.streak.kind === 'loss' ? 'L' : 'D'}` : '—'} sub={`best: ${a.bestStreak} wins in a row`} />
        <Stat label="Stance clashes won" value={a.stanceWinRate === null ? '—' : pct(a.stanceWinRate)} sub="of rounds that weren't a tie" />
      </div>

      <div>
        <div className="lab-label mb-1.5">Tips from your matches</div>
        <ul className="space-y-1.5">
          {a.tips.map((t) => (
            <li key={t} className="rounded-lg border-l-2 border-accent bg-black/25 px-3 py-2 text-xs text-ink">
              {t}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="lab-label mb-1.5">How your matches go (averages)</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {facts.map(([label, value, hint]) => (
            <div key={label} className="flex items-baseline justify-between gap-2 border-b border-line/60 pb-1 text-xs" title={hint}>
              <dt className="text-ink2">{label}</dt>
              <dd className="font-display font-bold tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <StanceMix stances={a.stances} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Bars title="As your Build" rows={a.byBuild} />
        <Bars title="As your World Faction" rows={a.byWorld} />
        <Bars title="By Chip" rows={a.byChip} />
        <Bars title="By evolution form" rows={a.byForm} />
        <Bars title="Your most-played combinations" rows={a.byCombo} />
        <Bars title="Against Build" rows={a.vsBuild} />
        <Bars title="Against World Faction" rows={a.vsWorld} />
      </div>

      <div>
        <div className="lab-label mb-1.5">Recent matches</div>
        <ul className="space-y-1 text-xs">
          {recent.map((r) => (
            <li key={r.at} className="flex flex-wrap items-center gap-x-2 rounded-md bg-black/25 px-2 py-1">
              <span className={`w-10 font-display font-bold ${r.result === 'win' ? 'text-emerald-300' : r.result === 'loss' ? 'text-red-300' : 'text-ink2'}`}>{r.result.toUpperCase()}</span>
              <span style={{ color: FACTION_META[r.me.faction]?.color }}>{FACTION_META[r.me.faction]?.name}</span>/<span style={{ color: WORLD_FACTION_META[r.me.worldFaction]?.color }}>{WORLD_FACTION_META[r.me.worldFaction]?.name}</span>
              <span className="text-mute">vs</span>
              <span style={{ color: FACTION_META[r.opp.faction]?.color }}>{FACTION_META[r.opp.faction]?.name}</span>/<span style={{ color: WORLD_FACTION_META[r.opp.worldFaction]?.color }}>{WORLD_FACTION_META[r.opp.worldFaction]?.name}</span>
              {r.ko !== undefined && <span className="text-mute">· {r.ko ? 'KO' : 'on HP'}</span>}
              <span className="ml-auto text-mute">
                R{r.rounds} · dealt {r.me.dealt} · took {r.me.taken}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// Validated (dataviz validate_palette.js, dark surface #111a16): lightness band, chroma, CVD and contrast all pass.
const STANCE_COLOR: Record<string, string> = { aggress: '#e0563a', adapt: '#2b8cc4', fortify: '#a8841a' };

/** Share of your stance picks, as one labeled split bar (segments separated by a 2px gap). */
function StanceMix({ stances }: { stances: StanceUse[] }) {
  const used = stances.filter((s) => s.share > 0);
  if (!used.length) return null;
  return (
    <div>
      <div className="lab-label mb-1.5">Your stance mix</div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded">
        {used.map((s) => (
          <div key={s.stance} className="h-full first:rounded-l last:rounded-r" style={{ width: `${s.share * 100}%`, background: STANCE_COLOR[s.stance] }} title={`${STANCE_META[s.stance].name}: ${pct(s.share)}`} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-ink2">
        {stances.map((s) => (
          <span key={s.stance} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: STANCE_COLOR[s.stance] }} />
            {STANCE_META[s.stance].name} <span className="tabular-nums text-ink">{pct(s.share)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-black/25 p-2">
      <div className="lab-label">{label}</div>
      <div className="font-display text-2xl font-bold">{value}</div>
      <div className="text-[11px] text-mute">{sub}</div>
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: Split[] }) {
  return (
    <div>
      <div className="lab-label mb-1">{title}</div>
      <div className="space-y-1">
        {rows.map((r) => (
          // Identity is carried by the name label (text stays in ink) plus the swatch; the bar color only repeats it.
          <div key={r.key} className="group flex items-center gap-2 text-xs" title={`${r.label}: ${pct(r.rate)} over ${r.games} game${r.games === 1 ? '' : 's'} (${r.wins} won)`}>
            <span className="flex w-24 shrink-0 items-center gap-1.5 truncate font-semibold text-ink">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
              {r.label}
            </span>
            <div className="relative h-2.5 flex-1 rounded bg-black/40">
              <div className="h-full rounded-r-[4px] transition group-hover:brightness-125" style={{ width: `${Math.max(2, Math.round(r.rate * 100))}%`, background: r.color }} />
              <div className="absolute inset-y-[-2px] left-1/2 w-px bg-white/30" />
            </div>
            <span className="w-24 shrink-0 text-right tabular-nums text-ink2">
              {pct(r.rate)} <span className="text-mute">({r.games})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
