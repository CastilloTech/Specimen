import { useEffect, useRef, useState } from 'react';
import type { GameState, PlayerId } from '../../engine';
import { EngineIcon } from './EngineIcon';

/**
 * Several engine payoffs going off from one play is the moment combos are built for: count it up in the
 * middle of the board ("Chain ×3"), bigger the longer the chain. The opponent's chains show too, quieter.
 */
export function ChainFx({ state, me }: { state: GameState; me: PlayerId }) {
  const seen = useRef(state.log.length);
  const [chain, setChain] = useState<{ key: number; n: number; mine: boolean } | null>(null);
  useEffect(() => {
    const fresh = state.log.slice(seen.current);
    seen.current = state.log.length;
    for (const p of [me, (1 - me) as PlayerId]) {
      const n = fresh.filter((l) => l.kind === 'engine' && l.player === p).length;
      if (n >= 2) {
        const key = Date.now();
        setChain({ key, n, mine: p === me });
        setTimeout(() => setChain((c) => (c?.key === key ? null : c)), 1600);
        return;
      }
    }
  }, [state.log, me]);
  if (!chain) return null;
  const size = chain.n >= 4 ? 'text-5xl' : chain.n === 3 ? 'text-4xl' : 'text-3xl';
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[30%] z-[45] flex justify-center" aria-live="polite">
      <span key={chain.key} className={`pop flex items-center gap-2 rounded-2xl border-2 bg-black/80 px-4 py-1.5 font-display font-extrabold tracking-wider shadow-2xl ${size} ${chain.mine ? 'border-amber-300 text-amber-200' : 'border-line text-ink2'}`}>
        <EngineIcon className="engine-cog" />
        {chain.mine ? 'CHAIN' : 'Their chain'} ×{chain.n}
      </span>
    </div>
  );
}
