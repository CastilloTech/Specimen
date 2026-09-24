import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** A phone held sideways: short and wide. The match switches to its compact, no-scroll board. */
export const PHONE_LANDSCAPE = '(orientation: landscape) and (max-height: 540px)';
/** A phone held upright, where the match asks to be rotated. */
export const PHONE_PORTRAIT = '(orientation: portrait) and (max-width: 700px)';

/** Best effort: go fullscreen and lock landscape (Android Chrome supports it; iOS ignores it). */
export function tryLandscapeFullscreen(): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  document.documentElement
    .requestFullscreen?.()
    .then(() => orientation.lock?.('landscape'))
    .catch(() => {});
}
