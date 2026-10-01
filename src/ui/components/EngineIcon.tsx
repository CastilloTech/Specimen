import { Fragment } from 'react';
import engineIcon from '../../assets/engine.png';

/** Text from the data that may still mark engines with "⚙" (Chip nodes, the match log, an achievement
 * icon): each one is drawn as the engine emblem. */
export function IconText({ text, className }: { text: string; className?: string }) {
  if (!text.includes('⚙')) return <>{text}</>;
  return (
    <>
      {text.split('⚙').map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <EngineIcon className={className} />}
          {part}
        </Fragment>
      ))}
    </>
  );
}

/** The same text for a tooltip, which can't show the emblem: the mark is dropped. */
export const plainText = (text: string | undefined) => text?.replace(/⚙\s?/g, '');

/** The engine emblem, sized to the surrounding text (it replaces the old ⚙ glyph). */
export function EngineIcon({ className = '' }: { className?: string }) {
  return <img src={engineIcon} alt="" aria-hidden draggable={false} className={`inline-block h-[1.35em] w-[1.35em] shrink-0 align-[-0.35em] drop-shadow-[0_0_1px_rgba(0,0,0,0.9)] ${className}`} />;
}
