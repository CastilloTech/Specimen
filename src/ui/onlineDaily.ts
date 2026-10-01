import { loadProgress, saveProgress } from './modes';
import { loadSaveData, saveSaveData } from './storage';

// The online daily goal: win one online game a day, for a little biomass (with Game Modes started).

export const ONLINE_DAILY_REWARD = 30;
export const ONLINE_DAILY_TEXT = 'Win a game online';
const KEY = 'onlineDaily';
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

/** Whether today's online goal is done (always false without a loaded save). */
export const onlineDailyDone = () => loadSaveData<{ date: string }>(KEY)?.date === today();

/** An online game was won: completes today's goal once. Returns the biomass paid (0 without Game Modes), or null if already done or no save. */
export function claimOnlineDaily(): number | null {
  if (loadSaveData<{ date: string }>(KEY)?.date === today()) return null;
  const p = loadProgress();
  saveSaveData(KEY, { date: today() });
  if (loadSaveData<{ date: string }>(KEY)?.date !== today()) return null; // no save loaded
  if (!p) return 0;
  saveProgress({ ...p, biomass: p.biomass + ONLINE_DAILY_REWARD, earned: p.earned + ONLINE_DAILY_REWARD });
  return ONLINE_DAILY_REWARD;
}
