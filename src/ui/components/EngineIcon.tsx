import engineIcon from '../../assets/engine.png';

/** The engine emblem, sized to the surrounding text (it replaces the old ⚙ glyph). */
export function EngineIcon({ className = '' }: { className?: string }) {
  return <img src={engineIcon} alt="" aria-hidden draggable={false} className={`inline-block h-[1.35em] w-[1.35em] shrink-0 align-[-0.35em] drop-shadow-[0_0_1px_rgba(0,0,0,0.9)] ${className}`} />;
}
