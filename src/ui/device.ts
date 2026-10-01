import { checkName, tidyName } from '../../server/names';

// Who this device is to the matchmaking queue, without an account: a random private id made once (the server
// only ever shows others a hash of it), the name strangers see, and the players blocked from this device.
// All of it is kept on this device, outside the saves (it belongs to the person holding the device).

const DEVICE_KEY = 'specimen.device';
const NAME_KEY = 'specimen.onlineName';
const BLOCK_KEY = 'specimen.blocked';

let memDevice: string | null = null;
/** This device's private id (32 hex characters), made the first time it's needed. */
export function deviceId(): string {
  try {
    const v = localStorage.getItem(DEVICE_KEY);
    if (v && /^[a-f0-9]{32}$/.test(v)) return v;
  } catch {
    /* no storage: an id for this visit only */
  }
  if (!memDevice) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    memDevice = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  try {
    localStorage.setItem(DEVICE_KEY, memDevice);
  } catch {
    /* kept in memory */
  }
  return memDevice;
}

/** The name strangers see, once chosen (null until then). */
export function onlineName(): string | null {
  try {
    const v = localStorage.getItem(NAME_KEY);
    return v && checkName(v).ok ? v : null;
  } catch {
    return null;
  }
}
export function setOnlineName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, tidyName(name));
  } catch {
    /* asked again next time */
  }
}
/** A first suggestion: the save's name, if it would pass. */
export function suggestName(saveName: string | undefined): string {
  return saveName && checkName(saveName).ok ? tidyName(saveName) : '';
}

export interface Blocked {
  /** The player's public id. */
  id: string;
  name: string;
  at: number;
}
export function loadBlocked(): Blocked[] {
  try {
    const v = JSON.parse(localStorage.getItem(BLOCK_KEY) ?? '[]') as Blocked[];
    return Array.isArray(v) ? v.filter((b) => b && typeof b.id === 'string') : [];
  } catch {
    return [];
  }
}
function saveBlocked(list: Blocked[]) {
  try {
    localStorage.setItem(BLOCK_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* not kept */
  }
}
export function block(id: string, name: string): void {
  saveBlocked([...loadBlocked().filter((b) => b.id !== id), { id, name, at: Date.now() }]);
}
export function unblock(id: string): void {
  saveBlocked(loadBlocked().filter((b) => b.id !== id));
}
export const isBlocked = (id: string | null | undefined) => !!id && loadBlocked().some((b) => b.id === id);

// ---------- Friends (kept on this device; each side keeps its own list) ----------

export interface Friend {
  /** Their public id. */
  id: string;
  name: string;
  emblem: string;
  since: number;
}
const FRIEND_KEY = 'specimen.friends';
export function loadFriends(): Friend[] {
  try {
    const v = JSON.parse(localStorage.getItem(FRIEND_KEY) ?? '[]') as Friend[];
    return Array.isArray(v) ? v.filter((f) => f && typeof f.id === 'string') : [];
  } catch {
    return [];
  }
}
function saveFriends(list: Friend[]) {
  try {
    localStorage.setItem(FRIEND_KEY, JSON.stringify(list.slice(-100)));
  } catch {
    /* not kept */
  }
}
export function addFriend(f: { id: string; name: string; emblem: string }): void {
  const old = loadFriends().find((x) => x.id === f.id);
  saveFriends([...loadFriends().filter((x) => x.id !== f.id), { id: f.id, name: f.name, emblem: f.emblem, since: old?.since ?? Date.now() }]);
}
export function removeFriend(id: string): void {
  saveFriends(loadFriends().filter((f) => f.id !== id));
}
export const isFriend = (id: string | null | undefined) => !!id && loadFriends().some((f) => f.id === id);
/** Friends change their names: keep the list up to date with what the lounge shows. */
export function refreshFriend(id: string, name: string, emblem: string): void {
  const list = loadFriends();
  const f = list.find((x) => x.id === id);
  if (f && (f.name !== name || f.emblem !== emblem)) saveFriends(list.map((x) => (x.id === id ? { ...x, name, emblem } : x)));
}

// ---------- Small online preferences ----------

const pref = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const setPref = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* not kept */
  }
};
/** The emblem on your profile card (a Build or World Faction id), or null for your Specimen's Build. */
export const loadEmblem = () => pref('specimen.emblem', '') || null;
export const saveEmblem = (id: string) => setPref('specimen.emblem', id);
/** After a series, go straight back to searching. */
export const keepSearching = () => pref('specimen.keepSearching', '0') === '1';
export const setKeepSearching = (on: boolean) => setPref('specimen.keepSearching', on ? '1' : '0');
/** Hide the lounge chat (presence, challenges and the queue still work). */
export const chatHidden = () => pref('specimen.chatHidden', '0') === '1';
export const setChatHidden = (on: boolean) => setPref('specimen.chatHidden', on ? '1' : '0');
/** Skip the lounge list and go straight to a random lounge. */
export const alwaysRandomLounge = () => pref('specimen.randomLounge', '0') === '1';
export const setAlwaysRandomLounge = (on: boolean) => setPref('specimen.randomLounge', on ? '1' : '0');
