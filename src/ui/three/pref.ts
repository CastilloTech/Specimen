import { useEffect, useState } from 'react';

// Whether Specimens are drawn in 3D. Automatic by default: on when the device can draw 3D and isn't short of
// memory; players can turn it off (or back on) from the sound & display menu. Kept apart from the 3D code itself,
// so deciding doesn't load it.

const KEY = 'specimen.3d';
type Choice = 'auto' | 'on' | 'off';
const listeners = new Set<() => void>();

function choice(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

let capable: boolean | null = null;
/** The device can draw 3D (WebGL), and has the memory for it (3 GB or more, where the browser says). */
function deviceCan(): boolean {
  if (capable !== null) return capable;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    capable = !!gl && !(mem !== undefined && mem < 3);
  } catch {
    capable = false;
  }
  return capable;
}

/** Draw Specimens in 3D? */
export function use3d(): boolean {
  const c = choice();
  return c === 'on' ? true : c === 'off' ? false : deviceCan();
}

export function set3d(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* not remembered */
  }
  listeners.forEach((l) => l());
}

/** The 3D setting, re-rendering when it changes. */
export function use3dPref(): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return use3d();
}

// ---------- The arena camera ----------

export type CamView = 'broadcast' | 'ringside' | 'overhead' | 'shoulder' | 'orbit';
export const CAM_VIEWS: { id: CamView; name: string }[] = [
  { id: 'broadcast', name: 'Broadcast' },
  { id: 'ringside', name: 'Ringside' },
  { id: 'overhead', name: 'Overhead' },
  { id: 'shoulder', name: 'Shoulder' },
  { id: 'orbit', name: 'Orbit' },
];
const CAM_KEY = 'specimen.cam';
const CINE_KEY = 'specimen.cinematic';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* not remembered */
  }
  listeners.forEach((l) => l());
}

export const camView = (): CamView => {
  const v = read(CAM_KEY);
  return CAM_VIEWS.some((c) => c.id === v) ? (v as CamView) : 'broadcast';
};
export const setCamView = (v: CamView) => write(CAM_KEY, v);
/** Cinematic camera: big moments (a clash, an evolution, the knockout) cut to their own shots. On by default. */
export const cinematic = () => read(CINE_KEY) !== 'off';
export const setCinematic = (on: boolean) => write(CINE_KEY, on ? 'on' : 'off');

/** The arena camera settings, re-rendering when they change. */
export function useCamPrefs(): { view: CamView; cinematic: boolean } {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { view: camView(), cinematic: cinematic() };
}

/** 3D failed on this device (no context, lost context): fall back to 2D for this visit. */
export function disable3dForNow() {
  capable = false;
  if (choice() === 'on') return;
  listeners.forEach((l) => l());
}
