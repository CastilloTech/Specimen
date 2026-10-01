// Names shown to strangers (the matchmaking queue). Friend rooms keep the save's name as it is; a stranger sees
// a name its owner chose for that, and the server checks it: length, characters, no links or handles, no
// reserved names (the game's own characters, staff-sounding names), and a word filter that sees through
// spacing, accents, repeated letters and look-alike symbols ("a$$", "f u c k", "shiiit").
// The game uses the same check for instant feedback; the server's is the one that counts.

export const NAME_MIN = 3;
export const NAME_MAX = 16;

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

// Look-alike symbols and digits, read as the letters they imitate.
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };

/** Lower case, accents dropped ("é" → "e"). */
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Letters only, with look-alikes read as letters: "A$$ 1" → "assi". */
const letters = (s: string) => [...fold(s)].map((c) => LEET[c] ?? c).filter((c) => c >= 'a' && c <= 'z').join('');
/** Runs of one letter cut to one: "shiiit" → "shit", "ass" → "as". */
const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');
/** Runs of three or more cut to two: "asssss" → "ass". */
const trim3 = (s: string) => s.replace(/(.)\1{2,}/g, '$1$1');

// Found anywhere in the name, even inside a longer word (see `inside` for how repeated letters are handled).
const ANYWHERE = [
  'fuck', 'fuk', 'shit', 'cunt', 'nigger', 'nigga', 'niger', 'faggot', 'fagot', 'retard', 'whore', 'slut', 'bitch', 'pussy', 'asshole', 'bastard', 'twat', 'wank',
  'porn', 'molest', 'pedophil', 'paedo', 'rapist', 'nazi', 'hitler', 'tranny', 'killyourself', 'dildo', 'blowjob', 'handjob', 'boner', 'tits', 'boobs',
  'semen', 'cocksuck', 'motherf', 'jerkoff', 'horny', 'hentai', 'incest', 'genocide', 'heilh', 'siegheil', 'wetback', 'beaner', 'raghead', 'towelhead',
  // Spanish
  'mierda', 'pendej', 'culero', 'chinga', 'maricon', 'marica', 'cabron', 'verga', 'putita', 'hijodeputa', 'malparid', 'gilipoll', 'mamaguevo',
];
// Only as a whole word (they hide inside ordinary words: class, Scunthorpe, grape, spice, cucumber...).
const WHOLE = new Set([
  'ass', 'arse', 'cock', 'dick', 'dik', 'cum', 'sex', 'anal', 'rape', 'raped', 'raping', 'spic', 'chink', 'gook', 'coon', 'kike', 'dyke', 'fag', 'fags', 'jizz', 'jiz', 'tit',
  'puta', 'puto', 'joto', 'pinche', 'culo', 'cono', 'polla', 'nazis', 'hoe', 'hoes', 'thot', 'pene', 'prick', 'nig', 'niga', 'negro', 'kkk', 'kys', 'pedo', 'pedos', 'hdp', 'zorra', 'concha',
]);
// The game's own characters and anything that sounds official.
const RESERVED_EXACT = new Set(['z', 'admin', 'administrator', 'mod', 'mods', 'moderator', 'dev', 'developer', 'staff', 'system', 'support', 'official', 'specimen', 'specimenteam', 'specimenstaff', 'handler', 'thehandler', 'theunregisteredhandler', 'unregisteredhandler', 'theoperative', 'operative', 'server', 'player', 'bot', 'castillotech']);
const RESERVED_ANYWHERE = ['admin', 'moderator', 'official', 'unregistered', 'castillotech', 'specimenteam', 'specimenstaff', 'gamemaster'];

const LINK = /(https?|www\.|:\/\/|\.\s*(com|net|org|gg|io|tv|ly|me|co|xyz|app|link|ru|es|mx)\b)/i;
const HANDLES = ['discord', 'twitch', 'youtube', 'tiktok', 'instagram', 'insta', 'onlyfans', 'snapchat', 'telegram', 'whatsapp', 'twitter'];
const ALLOWED = /^[A-Za-z0-9À-ÖØ-öø-ÿ _.'-]+$/;

/** Tidy a typed name: no surrounding spaces, single spaces inside. */
export const tidyName = (raw: string) => raw.normalize('NFC').replace(/\s+/g, ' ').trim();

/** Whether a name may be shown to strangers, and the tidied name if so. */
export function checkName(raw: unknown): NameCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'Type a name.' };
  const name = tidyName(raw);
  if (name.length < NAME_MIN || name.length > NAME_MAX) return { ok: false, reason: `Use ${NAME_MIN} to ${NAME_MAX} characters.` };
  if (!ALLOWED.test(name)) return { ok: false, reason: "Letters, numbers, spaces and _ . ' - only." };
  if ((fold(name).match(/[a-z]/g) ?? []).length < 2) return { ok: false, reason: 'Use at least two letters.' };
  const plain = letters(name);
  const flat = collapse(plain);
  if (LINK.test(name) || HANDLES.some((h) => plain.includes(h))) return { ok: false, reason: 'No links or social handles in names.' };
  // Without the look-alike reading too, so "Player 1" is still "player".
  const bare = fold(name).replace(/[^a-z]/g, '');
  if ([plain, flat, bare, collapse(bare)].some((x) => RESERVED_EXACT.has(x)) || RESERVED_ANYWHERE.some((w) => plain.includes(w) || bare.includes(w)))
    return { ok: false, reason: 'That name is reserved. Pick another.' };
  // Words one by one, and the whole name run together ("a s s").
  const words = fold(name)
    .split(/[^a-z0-9@$!|+]+/)
    .map(letters)
    .filter(Boolean);
  const whole = [...words, plain].flatMap((w) => [w, trim3(w)]);
  // A word without double letters is looked for with the name's repeats collapsed ("fuuuck"); one with doubles is
  // too, if collapsing leaves it long enough to be unmistakable ("niiigger" → "niger"), and otherwise as written
  // (collapsing "nigga" to "niga" would catch "Shinigami").
  const inside = (w: string) => (collapse(w) === w || collapse(w).length >= 5 ? flat.includes(collapse(w)) : trim3(plain).includes(w));
  if (ANYWHERE.some(inside) || whole.some((w) => WHOLE.has(w))) return { ok: false, reason: 'That name is not allowed. Pick another.' };
  return { ok: true, name };
}
