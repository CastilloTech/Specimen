import { useEffect, useRef, useState } from 'react';
import { CARD_MAP } from '../engine';
import type { GameState, PlayerId } from '../engine';
import { duckMusic } from './music';

// Sound effects, synthesized with Web Audio (no audio files). Every sound is a few short oscillator or
// filtered-noise envelopes. The preferences (effects, music, vibration) are per device, in localStorage.
// The ambient music lives in music.ts and shares this audio context.

export type Sfx = 'click' | 'card' | 'graft' | 'toxin' | 'react' | 'hit' | 'bigHit' | 'strain' | 'reject' | 'evolve' | 'heal' | 'stance' | 'round' | 'win' | 'lose' | 'draw' | 'craft' | 'wake' | 'engine' | 'chain' | 'objective' | 'record' | 'biomass' | 'unlock' | 'land' | 'found' | 'emote' | 'ready';

/** How one play of a sound differs: pitch and loudness multipliers, and a voice (a faction's) where it has one. */
export interface SfxOpts {
  pitch?: number;
  gain?: number;
  voice?: string;
}

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

// The current play's pitch and loudness (set by play(): a little random variation, plus any scaling asked
// for), applied by tone() and noise() so the same sound never plays exactly the same way twice.
let pitchMul = 1;
let gainMul = 1;

/** One tone: frequency glides from f0 to f1 over `dur`, with a quick attack and exponential decay. */
function tone(c: AudioContext, t: number, f0: number, f1: number, dur: number, type: OscillatorType, gain: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0 * pitchMul, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitchMul), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * gainMul), t + 0.01);
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
  f.frequency.value = freq * pitchMul;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain * gainMul;
  src.connect(f).connect(g).connect(master!);
  src.start(t);
}

/** A faction's voice laid over a graft landing: the creature, metal, wet tissue, acid, light, spores, bone. */
function voice(c: AudioContext, t: number, v: string) {
  switch (v) {
    case 'predator': // a wet snarl
      tone(c, t, 95, 62, 0.28, 'sawtooth', 0.12);
      noise(c, t, 0.22, 420, 1.5, 0.25, 'lowpass');
      break;
    case 'parasite': // a squelch
      tone(c, t, 320, 140, 0.16, 'sine', 0.2);
      noise(c, t + 0.03, 0.14, 520, 5, 0.3);
      break;
    case 'bastion': // a metal clank with a ring
      tone(c, t, 1250, 1180, 0.06, 'square', 0.08);
      tone(c, t, 1870, 1860, 0.45, 'triangle', 0.05);
      noise(c, t, 0.05, 3200, 2, 0.25);
      break;
    case 'corrosion': // an acid sizzle
      noise(c, t + 0.02, 0.4, 4200, 0.6, 0.18, 'highpass');
      break;
    case 'aegis': // a clean chime
      tone(c, t, 1568, 1568, 0.45, 'sine', 0.07);
      tone(c, t + 0.04, 2093, 2093, 0.4, 'sine', 0.05);
      break;
    case 'miasma': // a spore hiss
      noise(c, t, 0.38, 2600, 0.8, 0.2);
      tone(c, t, 210, 190, 0.35, 'sine', 0.06);
      break;
    case 'hollow': // a hollow knock, twice
      tone(c, t, 125, 112, 0.12, 'sine', 0.3);
      tone(c, t + 0.14, 118, 105, 0.14, 'sine', 0.22);
      break;
    default: // tech: a blip
      tone(c, t, 1320, 1760, 0.06, 'square', 0.05);
  }
}

let lastAt: Partial<Record<Sfx, number>> = {};
export function play(s: Sfx, opts: SfxOpts = {}) {
  if (pref.muted || pref.volume <= 0) return;
  const c = audio();
  if (!c || !master) return;
  const now = c.currentTime;
  if ((lastAt[s] ?? -1) > now - 0.04) return; // the same sound twice in 40 ms is one sound
  lastAt = { ...lastAt, [s]: now };
  master.gain.value = pref.volume * 0.5;
  const t = now + 0.005;
  // ±4% pitch and ±10% loudness every time (not on UI clicks, which should feel exact).
  const jitter = s === 'click' ? 0 : 1;
  pitchMul = (opts.pitch ?? 1) * (1 + jitter * (Math.random() - 0.5) * 0.08);
  gainMul = (opts.gain ?? 1) * (1 + jitter * (Math.random() - 0.5) * 0.2);
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
      if (opts.voice) voice(c, t + 0.04, opts.voice);
      break;
    case 'land': // a graft settling into its socket (a soft thud)
      tone(c, t, 150, 70, 0.14, 'sine', 0.35);
      break;
    case 'engine': // a payoff firing: a quick turning chime
      tone(c, t, 740, 1110, 0.09, 'triangle', 0.14);
      tone(c, t + 0.06, 1110, 1480, 0.12, 'triangle', 0.1);
      noise(c, t, 0.05, 5000, 2, 0.08, 'highpass');
      break;
    case 'chain': // each step of a chain a little higher (opts.pitch)
      tone(c, t, 880, 1320, 0.16, 'square', 0.07);
      tone(c, t + 0.07, 1320, 1760, 0.2, 'triangle', 0.1);
      break;
    case 'objective':
      tone(c, t, 784, 784, 0.16, 'triangle', 0.14);
      tone(c, t + 0.1, 1175, 1175, 0.3, 'triangle', 0.14);
      break;
    case 'record': // a recovered record: an uneasy, slightly detuned pair
      tone(c, t, 659, 652, 0.9, 'sine', 0.08);
      tone(c, t + 0.05, 698, 705, 0.9, 'sine', 0.06);
      break;
    case 'biomass': // a tick per step of the counter
      tone(c, t, 1760, 2093, 0.05, 'triangle', 0.05);
      break;
    case 'unlock':
      [0, 0.07, 0.14, 0.21].forEach((d, i) => tone(c, t + d, [523, 659, 784, 1047][i], [523, 659, 784, 1047][i] * 1.005, 0.32, 'triangle', 0.12));
      noise(c, t + 0.2, 0.3, 7000, 0.7, 0.08, 'highpass');
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
    case 'found': // an opponent joined: a rising signal lock
      [0, 0.08, 0.16].forEach((d, i) => tone(c, t + d, [440, 587, 880][i], [466, 622, 932][i], 0.18, 'square', 0.07));
      tone(c, t + 0.26, 1175, 1175, 0.45, 'triangle', 0.14);
      noise(c, t + 0.24, 0.25, 6000, 0.8, 0.08, 'highpass');
      break;
    case 'emote': // a reaction bubble
      tone(c, t, 880, 1320, 0.07, 'sine', 0.12);
      tone(c, t + 0.05, 1320, 1180, 0.08, 'sine', 0.08);
      break;
    case 'ready': // you (or they) are ready for the next game
      tone(c, t, 587, 587, 0.1, 'triangle', 0.13);
      tone(c, t + 0.08, 880, 880, 0.18, 'triangle', 0.12);
      break;
    case 'wake':
      noise(c, t, 0.2, 1400, 1.5, 0.35);
      tone(c, t + 0.05, 330, 660, 0.18, 'triangle', 0.14);
      break;
  }
}

// ---------- Match sounds (read from the log and the play list) ----------

// The loudest thing in a batch wins; a batch plays at most three sounds, staggered.
const PRIORITY: Sfx[] = ['win', 'lose', 'draw', 'evolve', 'reject', 'bigHit', 'round', 'hit', 'engine', 'heal', 'graft', 'toxin', 'react', 'card', 'stance', 'strain', 'wake'];
/** The opponent's routine sounds sit a little behind yours. */
const THEIRS = 0.6;

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
    // Each sound once per batch, with how it should play: a faction's voice on a graft, hits scaled by the
    // biggest hit in the batch, and the opponent's routine plays a little quieter than yours.
    const out = new Map<Sfx, SfxOpts>();
    const add = (s: Sfx, o: SfxOpts = {}) => {
      if (!out.has(s)) out.set(s, o);
    };
    for (const r of plays) {
      const theirs = r.player !== me ? { gain: THEIRS } : {};
      if (r.kind === 'react') add('react', theirs);
      else if (r.kind === 'play') {
        const def = r.cardId ? CARD_MAP[r.cardId] : undefined;
        const t = def?.type ?? 'graft';
        if (r.faceDown || t === 'graft') add('graft', { ...theirs, voice: r.faceDown && r.player !== me ? undefined : def?.faction });
        else add(t === 'toxin' || t === 'sabotage' ? 'toxin' : 'card', theirs);
      } else add('card', theirs);
    }
    let biggest = 0;
    for (const l of log) {
      // Big Clash hits are logged as 'hit', the rest as 'damage'. The weight of a hit follows its size.
      if ((l.kind === 'damage' || l.kind === 'hit') && (l.amount ?? 0) > 0) {
        biggest = Math.max(biggest, l.amount ?? 0);
        add(l.kind === 'hit' || (l.amount ?? 0) >= 8 ? 'bigHit' : 'hit');
      } else if (l.kind === 'heal' && (l.amount ?? 0) > 0) add('heal');
      else if (l.kind === 'engine') add('engine', l.player !== me ? { gain: THEIRS } : {});
      else if (l.kind === 'reject') add('reject');
      else if (l.kind === 'evolve') add('evolve');
      else if (l.kind === 'round') add('round');
      else if (l.kind === 'stance' && l.player === null) add('stance');
      else if (l.kind === 'strain' && (l.amount ?? 0) > 0) add('strain');
      else if (l.kind === 'end') add(state.result?.winner === me ? 'win' : state.result?.winner == null ? 'draw' : 'lose');
    }
    for (const h of ['hit', 'bigHit'] as const) if (out.has(h)) out.set(h, { pitch: 1.1 - Math.min(0.35, biggest / 30), gain: 0.75 + Math.min(0.6, biggest / 20) });
    // The music steps back for the moments that matter most.
    if (log.some((l) => l.kind === 'end' || (l.kind === 'evolve' && l.text.startsWith('EVOLUTION:')))) duckMusic(log.some((l) => l.kind === 'end') ? 2500 : 1600);
    // Vibrate for what happens to you: a hit you take, your rejection or evolution, the result.
    let feel: keyof typeof BUZZ | null = null as keyof typeof BUZZ | null;
    for (const l of log) {
      if (l.kind === 'end') feel = state.result?.winner === me ? 'win' : state.result?.winner == null ? null : 'lose';
      else if (l.player !== me) continue;
      else if (l.kind === 'evolve' && l.text.startsWith('EVOLUTION:')) feel = 'evolve';
      else if (l.kind === 'reject' && feel !== 'evolve') feel = 'reject';
      else if ((l.kind === 'damage' || l.kind === 'hit') && (l.amount ?? 0) > 0 && (!feel || feel === 'hit')) feel = l.kind === 'hit' || (l.amount ?? 0) >= 8 ? 'bigHit' : 'hit';
    }
    // A light tap when your own card lands, if nothing bigger happened.
    if (!feel && plays.some((r) => r.player === me && r.kind === 'play')) feel = 'play';
    if (feel && haptics) buzz(BUZZ[feel] as number | number[]);
    PRIORITY.filter((s) => out.has(s))
      .slice(0, 3)
      .forEach((s, i) => (i ? setTimeout(() => play(s, out.get(s)), i * 120) : play(s, out.get(s))));
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

const BUZZ = { play: 10, hit: 25, bigHit: [70], reject: [40, 60, 40], evolve: [30, 40, 30, 40, 90], win: [50, 60, 140], lose: [220] } as const;
