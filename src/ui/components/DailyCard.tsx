import { useState } from 'react';
import biomassArt from '../../assets/biomass.webp';
import { dailyChallenge, dailyReward, dayKey, liveStreak, streakNeedsGrace, todayRecord } from '../daily';
import { FACTION_META, WORLD_FACTION_META } from '../meta';
import type { Progress } from '../modes';
import { ChipArt } from './Emblem';

/** The daily challenge, featured on the menu and above the modes: today's twist, the streak, and the dispatch a win recovers. */
export function DailyCard({ p, onOpen, compact = false }: { p: Progress; onOpen: () => void; compact?: boolean }) {
  const key = dayKey();
  const d = dailyChallenge(key, '');
  const rec = todayRecord(p, key);
  const streak = liveStreak(p, key);
  const grace = !rec.won && streakNeedsGrace(p, key);
  const dispatch = (p.dailyWins ?? 0) + (rec.won ? 0 : 1);
  // The streak flares the first time you see it grow.
  const [grew] = useState(() => {
    try {
      const seen = Number(localStorage.getItem('specimen.streakSeen') ?? 0);
      localStorage.setItem('specimen.streakSeen', String(streak));
      return streak > seen;
    } catch {
      return false;
    }
  });
  return (
    <button onClick={onOpen} className={`lab-panel relative flex w-full items-center gap-3 overflow-hidden rounded-xl border-2 border-amber-400/60 text-left transition hover:-translate-y-0.5 ${compact ? 'p-2.5 phone:rounded-lg phone:p-1.5' : 'p-3'}`} aria-label="Daily challenge">
      <div className="flex shrink-0 -space-x-2">
        <ChipArt id={d.you.faction} size={compact ? 28 : 34} />
        <ChipArt id={d.opponent.faction} size={compact ? 28 : 34} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`font-display font-bold text-amber-300 ${compact ? 'text-base phone:text-sm' : 'text-lg'}`}>Daily challenge</span>
          {rec.won ? <span className="rounded-full bg-emerald-500/20 px-2 text-[11px] font-bold text-emerald-300">✓ Beaten</span> : <span className="rounded-full bg-amber-400/20 px-2 text-[11px] font-bold text-amber-200">New</span>}
          {streak > 0 && <span className={`inline-block text-[11px] font-bold text-orange-300 ${grew ? 'achievement-pop drop-shadow-[0_0_8px_rgba(251,146,60,0.9)]' : ''}`}>🔥 {streak}</span>}
        </div>
        <div className="truncate text-xs text-ink2">
          {FACTION_META[d.you.faction].name}/{WORLD_FACTION_META[d.you.worldFaction].name} vs {FACTION_META[d.opponent.faction].name}/{WORLD_FACTION_META[d.opponent.worldFaction].name} · Twist: <b className="text-amber-200">{d.twist.name}</b>
        </div>
        <div className={`text-[11px] text-mute ${compact ? 'phone:hidden' : ''}`}>
          {rec.won ? (
            <>Dispatch {p.dailyWins ?? 0} recovered · best win {rec.bestHp} HP</>
          ) : (
            <>
              Win for <img src={biomassArt} alt="" aria-hidden className="inline-block h-3.5 w-3.5 rounded-full align-[-2px]" /> {dailyReward(streak + 1)} and Dispatch {dispatch}
              {grace && <span className="text-amber-200"> · you missed a day: this week's grace keeps your streak</span>}
            </>
          )}
        </div>
      </div>
      <span className="font-display text-lg text-amber-300" aria-hidden>
        ›
      </span>
    </button>
  );
}
