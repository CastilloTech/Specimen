import { cardOf, SLOT_LABEL } from '../../engine';
import type { CardDef, GameState, PendingPlay, PlayerId } from '../../engine';

// Making a reaction window readable: exactly what is incoming and where it is aimed, and, for each Protocol you
// could answer with, whether it actually stops that play.

export interface Incoming {
  /** Null for a face-down graft (its identity is hidden from you). */
  def: CardDef | null;
  name: string;
  /** Where it is aimed, from your side: "at your Limb A: Razor Talon", "at you", "against your Bile Spit"... */
  aim: string;
}

export function incomingInfo(state: GameState, me: PlayerId, play: PendingPlay): Incoming {
  const def = cardOf(play.card.cardId);
  const hidden = def.type === 'graft' && !!play.faceDown && play.player !== me;
  const name = hidden ? 'a face-down graft' : def.name;
  let aim: string;
  if (play.against) {
    const ad = cardOf(play.against.card.cardId);
    const adHidden = ad.type === 'graft' && !!play.against.faceDown && play.against.player !== me;
    aim = `against ${play.against.player === me ? 'your' : 'their'} ${adHidden ? 'face-down graft' : ad.name}`;
  } else if (def.type === 'graft') aim = play.slot ? `into their ${SLOT_LABEL[play.slot]}` : 'onto their Specimen';
  else if (def.type === 'sabotage') {
    const g = play.target ? state.players[me].grafts.find((x) => x.slot === play.target) : undefined;
    aim = play.target ? `at your ${SLOT_LABEL[play.target]}${g ? `: ${cardOf(g.cardId).name}` : ''}` : 'at one of your grafts';
  } else if (def.type === 'toxin') aim = 'at you';
  else aim = 'on themselves';
  return { def: hidden ? null : def, name, aim };
}

export interface Verdict {
  kind: 'stop' | 'reflect' | 'other';
  short: string;
  long: string;
}

/** What a Protocol would do to the play it answers. */
export function protocolVerdict(protocol: CardDef, incomingName: string): Verdict {
  const ops = protocol.effect.ops ?? [];
  if (ops.some((o) => o.op === 'negate')) return { kind: 'stop', short: 'STOPS IT', long: `Cancels ${incomingName}: it does nothing.` };
  if (ops.some((o) => o.op === 'reflect')) return { kind: 'reflect', short: 'SENDS IT BACK', long: `${incomingName} hits its own caster instead.` };
  const extra = protocol.text.replace(/^Respond to [^:]*:\s*/i, '');
  return { kind: 'other', short: "DOESN'T STOP IT", long: `${incomingName} still happens. Also: ${extra}` };
}

export const VERDICT_CLASS: Record<Verdict['kind'], string> = {
  stop: 'bg-emerald-600 text-white',
  reflect: 'bg-sky-600 text-white',
  other: 'bg-zinc-700 text-zinc-100',
};
