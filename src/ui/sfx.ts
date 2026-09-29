import { useEffect, useRef, useState } from 'react';
import { CARD_MAP } from '../engine';
import type { GameState, PlayerId } from '../engine';

// Sound effects, synthesized with Web Audio (no audio files). Every sound is a few short oscillator or
// filtered-noise envelopes. The preferences (effects, music, vibration) are per device, in localStorage.
// The ambient music lives in music.ts and shares this audio context.

export type Sfx = 'click' | 'card' | 'graft' | 'toxin' | 'react' | 'hit' | 'bigHit' | 'strain' | 'reject' | 'evolve' | 'heal' | 'stance' | 'round' | 'win' | 'lose' | 'draw' | 'craft' | 'wake';

export interface Pref {
  volume: number; // 0..1
  muted: boolean;
  /** Ambient music (music.ts). */
  music: boolean;
  musicVolume: number; // 0..1
  /** Phone vibration on big moments. */
  haptics: boolean;
}
const DEFAULTS: Pref = { volume: 0.6, muted: false, music: true, musicVolume: 0.35, haptics: true };
const unit = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
const KEY = 'specimen.sound';
const listeners = new Set<(p: Pref) => void>();
let pref: Pref = (() => {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Pref> | null;
    if (p && typeof p === 'object')
      return { volume: unit(p.volume, DEFAULTS.volume), muted: !!p.muted, music: p.music ?? DEFAULTS.music, musicVolume: unit(p.musicVolume, DEFAULTS.musicVolume), haptics: p.haptics ?? DEFAULTS.haptics };
  } catch {
    /* fall through */
  }
  return { ...DEFAULTS };
})();

export const getSoundPref = () => pref;
export function setSoundPref(next: Partial<Pref>) {
  pref = { ...pref, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(pref));
  } catch {
    /* not remembered this time */
  }
  listeners.forEach((l) => l(pref));
}
/** Be told whenever the preferences change (the music follows them). */
export function onSoundPref(cb: (p: Pref) => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
export function useSoundPref(): Pref {
  const [p, setP] = useState(pref);
  useEffect(() => {
    listeners.add(setP);
    return () => void listeners.delete(setP);
  }, []);
  return p;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** The shared audio context (created on first use; browsers only let it play after a tap or key). */
export function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One tone: frequency glides from f0 to f1 over `dur`, with a quick attack and exponential decay. */
function tone(c: AudioContext, t: number, f0: number, f1: number, dur: number, type: OscillatorType, gain: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A burst of filtered noise (impacts, hisses). */
function noise(c: AudioContext, t: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master!);
  src.start(t);
}

let lastAt: Partial<Record<Sfx, number>> = {};
export function play(s: Sfx) {
  if (pref.muted || pref.volume <= 0) return;
  const c = audio();
  if (!c || !master) return;
  const now = c.currentTime;
  if ((lastAt[s] ?? -1) > now - 0.04) return; // the same sound twice in 40 ms is one sound
  lastAt = { ...lastAt, [s]: now };
  master.gain.value = pref.volume * 0.5;
  const t = now + 0.005;
  switch (s) {
    case 'click':
      tone(c, t, 1400, 900, 0.04, 'square', 0.05);
      break;
    case 'card':
      noise(c, t, 0.12, 2400, 1.2, 0.35);
      tone(c, t, 520, 780, 0.1, 'triangle', 0.12);
      break;
    case 'graft':
      tone(c, t, 180, 90, 0.22, 'sine', 0.45);
      noise(c, t, 0.15, 600, 2, 0.4);
      tone(c, t + 0.05, 660, 990, 0.12, 'triangle', 0.1);
      break;
    case 'toxin':
      tone(c, t, 300, 140, 0.35, 'sawtooth', 0.12);
      noise(c, t, 0.3, 1200, 4, 0.2);
      break;
    case 'react':
      tone(c, t, 880, 1320, 0.08, 'square', 0.1);
      tone(c, t + 0.08, 1320, 880, 0.12, 'square', 0.08);
      break;
    case 'hit':
      noise(c, t, 0.16, 900, 1, 0.7, 'lowpass');
      tone(c, t, 140, 60, 0.18, 'sine', 0.6);
      break;
    case 'bigHit':
      noise(c, t, 0.35, 700, 0.8, 0.9, 'lowpass');
      tone(c, t, 110, 40, 0.4, 'sine', 0.9);
      tone(c, t, 220, 70, 0.25, 'sawtooth', 0.15);
      break;
    case 'strain':
      tone(c, t, 240, 480, 0.18, 'sawtooth', 0.08);
      break;
    case 'reject':
      [0, 0.16, 0.32].forEach((d) => tone(c, t + d, 880, 440, 0.14, 'square', 0.12));
      noise(c, t, 0.4, 3000, 1, 0.2);
      break;
    case 'evolve':
      [0, 0.09, 0.18, 0.27].forEach((d, i) => tone(c, t + d, [392, 523, 659, 784][i], [392, 523, 659, 784][i] * 1.01, 0.5, 'triangle', 0.14));
      noise(c, t + 0.2, 0.5, 6000, 0.7, 0.12, 'highpass');
      break;
    case 'heal':
      tone(c, t, 523, 784, 0.25, 'sine', 0.2);
      tone(c, t + 0.1, 784, 1047, 0.25, 'sine', 0.15);
      break;
    case 'stance':
      noise(c, t, 0.1, 1800, 3, 0.35);
      tone(c, t, 440, 330, 0.12, 'triangle', 0.15);
      break;
    case 'round':
      tone(c, t, 330, 330, 0.3, 'triangle', 0.18);
      tone(c, t + 0.12, 494, 494, 0.35, 'triangle', 0.14);
      break;
    case 'win':
      [0, 0.12, 0.24, 0.42].forEach((d, i) => tone(c, t + d, [523, 659, 784, 1047][i], [523, 659, 784, 1047][i], i === 3 ? 0.7 : 0.2, 'triangle', 0.2));
      break;
    case 'lose':
      [0, 0.2, 0.4].forEach((d, i) => tone(c, t + d, [392, 330, 262][i], [392, 330, 196][i], i === 2 ? 0.8 : 0.25, 'sawtooth', 0.1));
      break;
    case 'draw':
      tone(c, t, 440, 440, 0.4, 'triangle', 0.15);
      break;
    case 'craft':
      tone(c, t, 660, 1320, 0.15, 'triangle', 0.15);
      noise(c, t, 0.1, 5000, 1, 0.1, 'highpass');
      break;
    case 'wake':
      noise(c, t, 0.2, 1400, 1.5, 0.35);
      tone(c, t + 0.05, 330, 660, 0.18, 'triangle', 0.14);
      break;
  }
}

// ---------- Match sounds (read from the log and the play list) ----------

// The loudest thing in a batch wins; a batch plays at most three sounds, staggered.
const PRIORITY: Sfx[] = ['win', 'lose', 'draw', 'evolve', 'reject', 'bigHit', 'round', 'hit', 'heal', 'graft', 'toxin', 'react', 'card', 'stance', 'strain', 'wake'];

/** Plays the sounds for whatever just happened in a match. `me` hears their own win or loss. */
export function useMatchSounds(state: GameState, me: PlayerId, enabled = true, haptics = true) {
  const seenLog = useRef(state.log.length);
  const seenPlays = useRef(state.plays.length);
  useEffect(() => {
    if (state.log.length < seenLog.current || state.plays.length < seenPlays.current) {
      seenLog.current = state.log.length; // a rematch started a fresh match
      seenPlays.current = state.plays.length;
      return;
    }
    const log = state.log.slice(seenLog.current);
    const plays = state.plays.slice(seenPlays.current);
    seenLog.current = state.log.length;
    seenPlays.current = state.plays.length;
    if (!enabled) return;
    const out = new Set<Sfx>();
    for (const r of plays) {
      if (r.kind === 'react') out.add('react');
      else if (r.kind === 'play') {
        const t = r.cardId ? CARD_MAP[r.cardId]?.type : 'graft';
        out.add(r.faceDown || t === 'graft' ? 'graft' : t === 'toxin' || t === 'sabotage' ? 'toxin' : 'card');
      } else out.add('card');
    }
    for (const l of log) {
      // Big Clash hits are logged as 'hit', the rest as 'damage'.
      if ((l.kind === 'damage' || l.kind === 'hit') && (l.amount ?? 0) > 0) out.add(l.kind === 'hit' || (l.amount ?? 0) >= 8 ? 'bigHit' : 'hit');
      else if (l.kind === 'heal' && (l.amount ?? 0) > 0) out.add('heal');
      else if (l.kind === 'reject') out.add('reject');
      else if (l.kind === 'evolve') out.add('evolve');
      else if (l.kind === 'round') out.add('round');
      else if (l.kind === 'stance' && l.player === null) out.add('stance');
      else if (l.kind === 'strain' && (l.amount ?? 0) > 0) out.add('strain');
      else if (l.kind === 'end') out.add(state.result?.winner === me ? 'win' : state.result?.winner == null ? 'draw' : 'lose');
    }
    // Vibrate for what happens to you: a hit you take, your rejection or evolution, the result.
    let feel: keyof typeof BUZZ | null = null;
    for (const l of log) {
      if (l.kind === 'end') feel = state.result?.winner === me ? 'win' : state.result?.winner == null ? null : 'lose';
      else if (l.player !== me) continue;
      else if (l.kind === 'evolve' && l.text.startsWith('EVOLUTION:')) feel = 'evolve';
      else if (l.kind === 'reject' && feel !== 'evolve') feel = 'reject';
      else if ((l.kind === 'damage' || l.kind === 'hit') && (l.amount ?? 0) > 0 && (!feel || feel === 'hit')) feel = l.kind === 'hit' || (l.amount ?? 0) >= 8 ? 'bigHit' : 'hit';
    }
    if (feel && haptics) buzz(BUZZ[feel] as number | number[]);
    PRIORITY.filter((s) => out.has(s))
      .slice(0, 3)
      .forEach((s, i) => (i ? setTimeout(() => play(s), i * 120) : play(s)));
  }, [state.log, state.plays, state.result, me, enabled, haptics]);
}


// ---------- Haptics ----------

export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/** A short buzz for a big moment, if the device can and the player hasn't turned it off. */
export function buzz(pattern: number | number[]) {
  if (!pref.haptics || !canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignored */
  }
}

const BUZZ = { hit: 25, bigHit: [70], reject: [40, 60, 40], evolve: [30, 40, 30, 40, 90], win: [50, 60, 140], lose: [220] } as const;
