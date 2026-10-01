import { useEffect, useMemo, useState } from 'react';
import { CARD_MAP, chipsFor, findNode, MUTATION_MAP } from '../../engine';
import type { MatchSetup, PlayerSetup } from '../../engine';
import { CardDetail } from '../components/CardDetail';
import { CardView } from '../components/CardView';
import { Collapsible } from '../components/Collapsible';
import { ChipArt } from '../components/Emblem';
import { ScreenHeader } from '../components/ScreenHeader';
import { dailyChallenge, dailyReward, dailySetup, dailyShareText, dayKey, liveStreak, todayRecord } from '../daily';
import { appLink, replayLink, shareOrCopy } from '../share';
import type { SavedReplay } from '../storage';
import type { DailyOutcome } from '../daily';
import { FACTION_META, PLAYER_COLORS, WORLD_FACTION_META } from '../meta';
import { loadProgress } from '../modes';
import type { Progress } from '../modes';
import { activeSave } from '../storage';
import { BiomassBadge, BiomassIcon } from './GameModes';
import { DIFFICULTY } from '../picks';

/** Time until the next local midnight, as "5h 12m". */
function untilTomorrow(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const m = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60000));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function SpecimenCard({ s, who, color }: { s: PlayerSetup; who: string; color: string }) {
  const chip = chipsFor(s.worldFaction).find((c) => c.id === s.chip);
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-line bg-black/25 p-2.5" style={{ borderTop: `3px solid ${color}` }}>
      <div className="lab-label" style={{ color }}>
        {who}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <ChipArt id={s.faction} size={30} />
        <ChipArt id={s.worldFaction} size={30} />
      </div>
      <div className="mt-1 truncate text-sm font-bold">
        <span style={{ color: FACTION_META[s.faction].color }}>{FACTION_META[s.faction].name}</span>
        <span className="text-mute"> / </span>
        <span style={{ color: WORLD_FACTION_META[s.worldFaction].color }}>{WORLD_FACTION_META[s.worldFaction].name}</span>
      </div>
      <div className="truncate text-[11px] text-ink2" title={s.loadout.map((id) => findNode(id)?.name ?? id).join(' · ')}>
        {chip?.name} · {s.loadout.map((id) => findNode(id)?.name ?? id).join(' · ')}
      </div>
    </div>
  );
}

/** The daily challenge: today's fixed match, your attempts, and your streak. */
export function DailyScreen({ onBack, onFight, onWatch, last }: { onBack: () => void; onFight: (setup: MatchSetup, key: string) => void; onWatch: (r: SavedReplay) => void; last?: DailyOutcome | null }) {
  const [p] = useState<Progress>(() => loadProgress()!);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const key = dayKey(now);
  const d = useMemo(() => dailyChallenge(key, activeSave()?.meta.name ?? 'You'), [key]);
  const rec = todayRecord(p, key);
  const streak = liveStreak(p, key);
  const nextStreak = rec.won ? streak : streak + 1;
  const tier = DIFFICULTY.find((x) => x.id === d.tier)!;
  const [viewCard, setViewCard] = useState<string | null>(null);
  const deck = useMemo(() => {
    const counts = new Map<string, number>();
    d.you.deck.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
    return [...counts].sort((a, b) => CARD_MAP[a[0]].cost - CARD_MAP[b[0]].cost);
  }, [d]);
  const dateText = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const [note, setNote] = useState<string | null>(null);
  const bestReplay = (): SavedReplay | null =>
    rec.won && rec.bestActions ? { id: `daily-${key}`, at: Date.now(), me: 0, names: [d.you.name, d.opponent.name], result: 'win', rounds: rec.bestRounds ?? 0, label: `Daily challenge ${key}`, setup: dailySetup(d), actions: rec.bestActions } : null;
  const shareResult = async () => {
    const res = await shareOrCopy({ title: 'Specimen daily', text: dailyShareText(d, rec, streak), url: appLink('daily') });
    setNote(res === 'copied' ? 'Result copied: paste it anywhere.' : res === 'failed' ? "Couldn't share from this browser." : null);
  };
  const shareWin = async () => {
    const r = bestReplay();
    if (!r) return;
    const res = await shareOrCopy({ title: 'Specimen daily replay', text: `${dailyShareText(d, rec, streak)}\nWatch my win:`, url: await replayLink(r) });
    setNote(res === 'copied' ? 'Replay link copied.' : res === 'failed' ? "Couldn't share from this browser." : null);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-3 pb-0">
      <ScreenHeader title="Daily challenge" sub={`${dateText} · new challenge in ${untilTomorrow(now)}`} onBack={onBack} backLabel="Back to Game Modes" right={<BiomassBadge n={p.biomass} />} />

      {last && (
        <section className={`pop rounded-xl border-2 p-3 text-center ${last.won ? 'border-amber-400 bg-amber-950/25' : 'border-red-500/70 bg-red-950/25'}`} aria-live="polite">
          <div className="font-display text-lg font-bold">{last.won ? (last.firstWin ? "Today's challenge beaten!" : last.newBest ? 'A better win!' : 'Won again') : 'Defeated'}</div>
          <div className="text-sm text-ink2">
            {last.won ? (
              <>
                {last.firstWin && (
                  <>
                    +<BiomassIcon /> {last.reward} biomass · streak {last.streak} day{last.streak === 1 ? '' : 's'}.{' '}
                  </>
                )}
                Won with {last.hp} HP left{last.newBest && !last.firstWin ? ', your best today' : ''}.
              </>
            ) : (
              'Same match, same shuffle: try another line.'
            )}
          </div>
          {last.dispatch && <div className="mt-1 text-[12px] font-semibold text-sky-200">◆ Dispatch {last.dispatch} recovered. It's in the Archive. Come back tomorrow for the next.</div>}
        </section>
      )}

      <section className="lab-panel relative overflow-hidden rounded-xl border-2 border-amber-400/60 p-3.5" aria-label="Today's challenge">
        <div className="flex items-baseline justify-between">
          <span className="lab-label text-amber-300">Today's match · same for everyone</span>
          <span className="rounded-full border px-2 py-0.5 text-[11px] font-bold" style={{ borderColor: tier.color, color: tier.color }} title={tier.hint}>
            {tier.label} bot
          </span>
        </div>
        <div className="mt-2 flex items-stretch gap-2">
          <SpecimenCard s={d.you} who="You play" color={PLAYER_COLORS[0]} />
          <span className="self-center font-display text-xs font-bold text-mute">VS</span>
          <SpecimenCard s={d.opponent} who="Opponent" color={PLAYER_COLORS[1]} />
        </div>
        <div className="mt-2.5 rounded-lg border border-amber-400/50 bg-amber-950/30 px-3 py-2">
          <div className="font-display text-sm font-bold text-amber-200">Twist: {d.twist.name}</div>
          <div className="text-xs text-ink2">{d.twist.text}</div>
          {d.mutations.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-fuchsia-200">
              {d.mutations.map((id) => (
                <li key={id}>
                  ✦ <b>{MUTATION_MAP[id].name}</b>: {MUTATION_MAP[id].text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2 text-center" aria-label="Your daily record">
        <div className="lab-panel rounded-lg border border-line p-2">
          <div className="font-display text-xl font-bold">{rec.attempts}</div>
          <div className="text-[10px] uppercase tracking-wider text-mute">Attempts</div>
        </div>
        <div className="lab-panel rounded-lg border border-line p-2">
          <div className={`font-display text-xl font-bold ${rec.won ? 'text-emerald-300' : 'text-mute'}`}>{rec.won ? `${rec.bestHp} HP` : '—'}</div>
          <div className="text-[10px] uppercase tracking-wider text-mute">Best win</div>
        </div>
        <div className="lab-panel rounded-lg border border-line p-2">
          <div className="font-display text-xl font-bold text-amber-300">🔥 {streak}</div>
          <div className="text-[10px] uppercase tracking-wider text-mute">Day streak{p.dailyStreak?.best ? ` · best ${p.dailyStreak.best}` : ''}</div>
        </div>
      </section>

      {rec.attempts > 0 && (
        <section className="lab-panel rounded-xl border border-line p-2.5" aria-label="Share">
          {rec.won && rec.bestGrid && (
            <div className="mb-2 text-center">
              <div className="text-[10px] uppercase tracking-wider text-mute">Your best win, round by round</div>
              <div className="mt-0.5 text-xl tracking-[0.15em]" aria-label="Rounds: green won, red lost, white even">
                {Array.from(rec.bestGrid).map((sq, i) => (
                  <span key={i} className="grid-pop" style={{ ['--i' as string]: i } as React.CSSProperties}>
                    {sq}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void shareResult()} className="flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black">
              ↗ Share result
            </button>
            {bestReplay() && (
              <>
                <button onClick={() => onWatch(bestReplay()!)} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink2 hover:border-mute">
                  ▶ Watch best win
                </button>
                <button onClick={() => void shareWin()} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink2 hover:border-mute">
                  Share the replay
                </button>
              </>
            )}
          </div>
          {note && (
            <p className="mt-1.5 text-center text-[11px] text-emerald-300" role="status">
              {note}
            </p>
          )}
        </section>
      )}

      <p className="text-center text-xs text-ink2">
        {rec.won ? (
          <>Beaten today. Play again to beat your best (most HP left). Tomorrow's first win pays <BiomassIcon /> {dailyReward(streak + 1)}.</>
        ) : (
          <>
            First win today pays <BiomassIcon /> <b className="text-ink">{dailyReward(nextStreak)}</b>
            {nextStreak > 1 ? ` (a ${nextStreak}-day streak)` : ''}. Win on consecutive days for more.
          </>
        )}
      </p>

      <Collapsible id="daily-deck" defaultOpen={false} title="Your loaned deck" meta={`${d.you.deck.length} cards · starter deck`}>
        <div className="flex flex-wrap gap-2 pt-1">
          {deck.map(([id, n]) => (
            <CardView key={id} def={CARD_MAP[id]} size="xs" count={n > 1 ? n : undefined} onClick={() => setViewCard(id)} />
          ))}
        </div>
      </Collapsible>

      <div className="sticky bottom-0 z-10 -mx-3 mt-auto flex gap-2 border-t border-line bg-bg/90 px-3 pt-2.5 backdrop-blur" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
        <button onClick={() => onFight(dailySetup(d), key)} className="flex-1 rounded-xl bg-amber-400 px-4 py-3 font-display font-bold text-black">
          {rec.attempts === 0 ? 'Take the challenge' : rec.won ? 'Play again' : 'Try again'}
        </button>
      </div>
      {viewCard && <CardDetail def={CARD_MAP[viewCard]} onClose={() => setViewCard(null)} />}
    </div>
  );
}
