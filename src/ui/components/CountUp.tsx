import { useEffect, useState } from 'react';

/** A number that counts up to its value when it first appears (instantly with reduced motion). */
export function CountUp({ value, delay = 0, ms = 700 }: { value: number; delay?: number; ms?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || value <= 0) return setShown(value);
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / ms));
      setShown(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, delay, ms]);
  return <>{shown}</>;
}
