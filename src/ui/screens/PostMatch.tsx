import { useMemo, useState } from 'react';
import { turningPoints } from '../turningPoints';
import { CARD_MAP, findNode } from '../../engine';
import type { EngineId, GameState, MatchSetup } from '../../engine';
import { Emblem } from '../components/Emblem';
import { LineChart } from '../components/LineChart';
import { Collapsible } from '../components/Collapsible';
import { newlyUnlocked, newlyUnlockedMastery } from '../achievements';
import { CardDetail } from '../components/CardDetail';
import { CardView, factionName } from '../components/CardView';
import { ENGINE_META, engineColor, FACTION_META, PLAYER_COLORS, WORLD_FACTION_META } from '../meta';
import { activeSave, loadMatches } from '../storage';
import { EngineIcon } from '../components/EngineIcon';
import { IconText } from '../components/EngineIcon';

interface Props {
  state: GameState;
  setup: MatchSetup;
  onRematch: () => void;
  /** Straight into a quick match: your defaults against a new random bot. */
  onNext: () => void;
  onMenu: () => void;
  /** Watch this match again, step by step (from a given step). */
  onReplay?: (step?: number) => void;
  /** Open the deck builder with a deck built around this card. */
  onBuildWith?: (cardId: string) => void;
}

export function exportMatchJson(state: GameState, setup: MatchSetup): string {
  return JSON.stringify(
    {
      game: 'Specimen',
      exportedAt: new Date().toISOString(),
      note: 'Replay: createMatch(setup) then reduce() each entry of actions in order. Same seed + actions = same match.',
      setup,
      result: state.result,
      rounds: state.round,
      actions: state.history,
      log: state.log.map(({ n, round, kind, player, text }) => ({ n, round, kind, player, text })),
      snapshots: state.snapshots,
      players: state.players.map((p) => ({ name: p.name, faction: p.faction, worldFaction: p.worldFaction, chip: p.chip, loadout: p.loadout, evolution: p.evolution, finalHp: p.hp, finalStrain: p.strain, stats: p.stats })),
    },
    null,
    2,
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function PostMatch({ state, setup, onRematch, onNext, onMenu, onReplay, onBuildWith }: Props) {
  const [a, b] = state.players;
  const names: [string, string] = [a.name, b.name];
  const rounds = state.snapshots.map((s) => s.round);
  const hp: [number[], number[]] = [state.snapshots.map((s) => s.hp[0]), state.snapshots.map((s) => s.hp[1])];
  const strain: [number[], number[]] = [state.snapshots.map((s) => s.strain[0]), state.snapshots.map((s) => s.strain[1])];
  const T = state.config.strain.threshold;
  const yStrain = Math.max(T + 3, ...strain[0], ...strain[1]);
  const key = state.log.filter((l) => ['reject', 'evolve', 'hit', 'end'].includes(l.kind) || (l.kind === 'wear' && /integrity depleted/.test(l.text)));
  const w = state.result?.winner ?? null;
  // The match was recorded into the loaded save when it ended, so the newest record is this one.
  const unlocked = activeSave() ? newlyUnlocked(loadMatches()) : [];
  const newCards = activeSave() ? newlyUnlockedMastery(loadMatches()) : [];
  const [viewCard, setViewCard] = useState<string | null>(null);
  const points = useMemo(() => turningPoints(setup, state, 0), [setup, state]);

  const [chart, setChart] = useState<'hp' | 'strain'>('hp');
  const me = 0;
  const outcome = w === null ? 'Draw' : w === me ? 'Victory' : 'Defeat';
  const outcomeColor = w === null ? 'var(--color-accent)' : w === me ? '#6ee7b7' : '#f87171';
  const evoName = (p: (typeof state.players)[number]) => (p.evolution ? (state.config.evolutions as Record<string, { id: string; name: string }[]>)[p.faction].find((d) => d.id === p.evolution)?.name : null);
  // Side-by-side numbers; the better one of each pair is lit.
  const rows: { label: string; v: [number, number]; higherIsBetter: boolean }[] = [
    { label: 'Damage dealt', v: [a.stats.damageDealt, b.stats.damageDealt], higherIsBetter: true },
    { label: 'Damage blocked', v: [a.stats.damageBlocked, b.stats.damageBlocked], higherIsBetter: true },
    { label: 'Strain vented', v: [a.stats.strainVented, b.stats.strainVented], higherIsBetter: true },
    { label: 'Rejections', v: [a.stats.rejectionsSuffered, b.stats.rejectionsSuffered], higherIsBetter: false },
    { label: 'Engine payoffs fired', v: [a.stats.engineFires, b.stats.engineFires], higherIsBetter: true },
  ];
  const best = (r: (typeof rows)[number], i: 0 | 1) => r.v[0] !== r.v[1] && (r.higherIsBetter ? r.v[i] > r.v[1 - i] : r.v[i] < r.v[1 - i]);
  const iconBtn = 'grid h-10 w-11 shrink-0 place-items-center rounded-xl bg-panel2 text-base';

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-3 p-3 pt-0">
      {/* Always on top: straight into the next match without scrolling past the report. */}
      <nav className="sticky top-0 z-20 -mx-3 flex gap-2 border-b border-line bg-bg/90 px-3 pb-2 backdrop-blur" style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }} aria-label="After the match">
        <button onClick={onMenu} className={iconBtn} aria-label="Menu" title="Menu">
          ☰
        </button>
        {onReplay && (
          <button onClick={() => onReplay()} className={`${iconBtn} text-ink2`} aria-label="Watch the replay" title="Watch this match again, step by step">
            ▶
          </button>
        )}
        <button onClick={onRematch} className="flex-1 rounded-xl border border-accent/60 px-3 py-2.5 text-sm font-semibold text-accent" title="Same Builds, World Factions, Chips and decks">
          Rematch
        </button>
        <button onClick={onNext} autoFocus className="flex-1 rounded-xl bg-accent px-3 py-2.5 font-display text-sm font-bold text-black" title="Your defaults against a new random opponent">
          Next match ▸
        </button>
      </nav>

      <div className="grid gap-3 lg:grid-cols-2 phone:grid-cols-2 lg:items-start phone:items-start">
        {/* Left: the result, what you unlocked, and what decided it. */}
        <div className="flex min-w-0 flex-col gap-3">
          <header className="lab-panel overflow-hidden rounded-xl border p-3" style={{ borderColor: `${outcomeColor}99` }}>
            <div className="flex items-baseline justify-between gap-2">
              <h1 className="font-display text-3xl font-bold tracking-wide" style={{ color: outcomeColor }}>
                {outcome}
              </h1>
              <span className="lab-label shrink-0">{state.round} rounds</span>
            </div>
            <p className="text-xs text-ink2">{state.result?.reason}</p>
            {/* Both Specimens: identity and final HP. */}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {state.players.map((p) => (
                <div key={p.id} className="min-w-0 rounded-lg bg-black/30 p-2" style={{ borderTop: `2px solid ${PLAYER_COLORS[p.id]}` }}>
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 truncate text-sm font-bold">{p.name}</span>
                    <Emblem id={p.faction} size={16} />
                    <Emblem id={p.worldFaction} size={16} />
                  </div>
                  <div className="truncate text-[10px]">
                    <span style={{ color: FACTION_META[p.faction].color }}>{FACTION_META[p.faction].name}</span>
                    <span className="text-mute"> / </span>
                    <span style={{ color: WORLD_FACTION_META[p.worldFaction].color }}>{WORLD_FACTION_META[p.worldFaction].name}</span>
                    {evoName(p) && <span className="text-violet-300"> · {evoName(p)}</span>}
                  </div>
                  <div className="relative mt-1.5 h-4 overflow-hidden rounded bg-black/60" role="meter" aria-label={`${p.name} final HP`} aria-valuenow={Math.max(0, p.hp)} aria-valuemax={p.maxHp}>
                    <div className={`h-full ${p.hp > p.maxHp / 2 ? 'bg-emerald-500' : p.hp > p.maxHp / 4 ? 'bg-amber-500' : 'bg-red-600'}`} style={{ width: `${Math.max(0, (p.hp / p.maxHp) * 100)}%` }} />
                    <span className="absolute inset-0 grid place-items-center font-display text-[10px] font-bold text-white drop-shadow">
                      {Math.max(0, p.hp)} / {p.maxHp} HP · Strain {p.strain}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-line/50">
                    <td className={`w-16 py-1 text-right font-display font-bold tabular-nums ${best(r, 0) ? 'text-emerald-300' : 'text-ink2'}`}>{r.v[0]}</td>
                    <td className="py-1 text-center text-[10px] uppercase tracking-wider text-mute">{r.label}</td>
                    <td className={`w-16 py-1 text-left font-display font-bold tabular-nums ${best(r, 1) ? 'text-emerald-300' : 'text-ink2'}`}>{r.v[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Which engines each side got running, and how often they fired. */}
            {(a.stats.engineFires > 0 || b.stats.engineFires > 0) && (
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line/50 pt-2" aria-label="Engine payoffs fired, per engine">
                {[a, b].map((p, i) => {
                  const list = (Object.entries(p.stats.engineFiresBy) as [EngineId, number][]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
                  return (
                    <div key={p.id} className={`flex flex-wrap gap-1 ${i ? 'justify-start' : 'justify-end'}`}>
                      {list.length === 0 && <span className="text-[10px] text-mute">No engines fired</span>}
                      {list.map(([e, n]) => (
                        <span key={e} className="rounded-full border px-1.5 font-display text-[10px] font-bold uppercase tracking-wide" style={{ borderColor: engineColor(e), color: engineColor(e) }} title={ENGINE_META[e].text}>
                          <EngineIcon /> {ENGINE_META[e].name} ×{n}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </header>

          {newCards.length > 0 && (
            <section className="lab-panel rounded-xl border-2 border-amber-400 p-3 text-center" aria-live="polite">
              <div className="lab-label text-amber-300">Faction mastered · new card unlocked</div>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                {newCards.map((c) => (
                  <div key={c.id} className="achievement-pop flex flex-col items-center gap-1">
                    <CardView def={c} onClick={() => setViewCard(c.id)} />
                    <span className="text-xs text-ink2">Now in the {factionName(c.faction)} pool of the deck builder.</span>
                    {onBuildWith && (
                      <button onClick={() => onBuildWith(c.id)} className="rounded-lg bg-amber-400 px-3 py-1 text-xs font-bold text-black">
                        Build a deck with it ▶
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {unlocked.length > 0 && (
            <section className="lab-panel rounded-xl border border-amber-400/60 p-3" aria-live="polite">
              <div className="lab-label text-amber-300">Achievement{unlocked.length > 1 ? 's' : ''} unlocked</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {unlocked.map((u, i) => (
                  <div key={u.id} className="achievement-pop flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-950/30 px-3 py-2" style={{ animationDelay: `${i * 0.15}s` }}>
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-400 font-display text-lg text-black"><IconText text={u.icon} /></span>
                    <span>
                      <span className="block font-display text-sm font-bold text-amber-200">{u.name}</span>
                      <span className="block text-xs text-ink2">{u.text}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {points.length > 0 && (
            <section className="lab-panel rounded-xl border border-line p-3" aria-label="Turning points">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="font-display text-base font-bold">Turning points</h2>
                <span className="text-[11px] text-mute">what decided this match</span>
              </div>
              <ol className="space-y-1.5">
                {points.map((t) => (
                  <li key={`${t.round}-${t.step}-${t.title}`} className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 ${t.good ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-red-500/40 bg-red-950/20'}`}>
                    <span className="mt-0.5 text-lg leading-none" aria-hidden>
                      {t.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-semibold ${t.good ? 'text-emerald-200' : 'text-red-200'}`}>{t.title}</span>
                      {t.detail && <span className="block text-xs text-ink2">{t.detail}</span>}
                    </span>
                    {onReplay && (
                      <button onClick={() => onReplay(t.step)} className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-ink2 hover:border-mute" aria-label={`Watch: ${t.title}`}>
                        ▶ Watch
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {/* Right: the match over time, then the full record. */}
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <div className="mb-1.5 flex rounded-lg border border-line p-0.5 text-xs" role="tablist" aria-label="Chart">
              {(['hp', 'strain'] as const).map((c) => (
                <button key={c} role="tab" aria-selected={chart === c} onClick={() => setChart(c)} className={`flex-1 rounded-md px-3 py-1 font-semibold ${chart === c ? 'bg-accent text-black' : 'text-ink2'}`}>
                  {c === 'hp' ? 'HP by round' : 'Strain by round'}
                </button>
              ))}
            </div>
            {chart === 'hp' ? (
              <LineChart title="HP by round" names={names} rounds={rounds} values={hp} yMax={Math.max(state.config.specimen.hp, ...state.players.map((p) => p.maxHp))} yStep={10} />
            ) : (
              <LineChart title="Strain by round" names={names} rounds={rounds} values={strain} yMax={yStrain} yStep={5} refLine={{ y: T, label: `T=${T}` }} />
            )}
          </div>

          <div className="lab-panel rounded-xl border border-line px-3 py-2 text-[11px] text-ink2">
            {state.players.map((p) => (
              <div key={p.id} className="truncate">
                <span className="font-semibold" style={{ color: PLAYER_COLORS[p.id] }}>
                  {p.name}
                </span>{' '}
                Chip nodes: {p.loadout.map((id) => findNode(id)?.name).join(' · ')}
              </div>
            ))}
          </div>

          <Collapsible id="post-log" defaultOpen={false} title="Match log" meta={`${key.length} key events`} bodyClass="space-y-2">
            <ul className="space-y-1 text-xs">
              {key.map((e) => (
                <li key={e.n} className="flex gap-2">
                  <span className="w-8 shrink-0 text-mute">R{e.round}</span>
                  <span className={e.kind === 'reject' ? 'text-red-300' : e.kind === 'evolve' ? 'text-violet-300' : e.kind === 'hit' ? 'text-amber-200' : e.kind === 'wear' ? 'text-orange-300' : 'text-accent'}>{e.text}</span>
                </li>
              ))}
              {key.length === 0 && <li className="text-mute">Nothing dramatic happened.</li>}
            </ul>
            <button onClick={() => download(`specimen-match-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, exportMatchJson(state, setup))} className="w-full rounded-lg bg-panel2 px-4 py-2 text-xs font-semibold">
              Export match log (JSON)
            </button>
          </Collapsible>
        </div>
      </div>
      {viewCard && <CardDetail def={CARD_MAP[viewCard]} onClose={() => setViewCard(null)} />}
      <div className="pb-2" />
    </div>
  );
}
