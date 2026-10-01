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
