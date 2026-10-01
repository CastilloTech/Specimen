import { audio, getSoundPref, onSoundPref } from './sfx';

// Ambient music, generated live with Web Audio (no audio files): a slow minor-key pad that drifts from chord
// to chord over a low drone, with soft "tank bubble" notes. In a match the progression turns darker, the
// bubbles come faster and a quiet heartbeat pulses underneath. Volume and on/off come from the sound
// preferences; browsers only allow audio after the first tap or key press, so it starts then.

export type Mood = 'calm' | 'match';

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
// D minor. Chords as MIDI notes (three voices, around the octave below middle C).
const CALM = [
  [50, 53, 57], // Dm
  [46, 50, 53], // Bb
  [53, 57, 60], // F
  [48, 52, 55], // C
];
const TENSE = [
  [50, 53, 57], // Dm
  [51, 55, 58], // Eb (a dark half-step lift)
  [46, 50, 53], // Bb
  [45, 49, 52], // A (the dominant, unresolved)
];
const BUBBLES = [74, 77, 79, 81, 84, 86]; // D minor pentatonic, high

let mood: Mood = 'calm';
/** Match tension, 0..1: quickens the heartbeat and bubbles and brightens the pad (Strain, Meltdown, low HP). */
let intensity = 0;
let bus: GainNode | null = null; // music volume
let tone: BiquadFilterNode | null = null; // pad brightness
let echo: DelayNode | null = null;
let drone: { osc: OscillatorNode; gain: GainNode } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextChord = 0;
let nextBubble = 0;
let nextBeat = 0;
let step = 0;
let running = false;

function build(c: AudioContext) {
  if (bus) return;
  bus = c.createGain();
  bus.gain.value = 0;
  bus.connect(c.destination);
  tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 700;
  tone.Q.value = 0.7;
  tone.connect(bus);
  // A slow wobble on the pad's brightness.
  const lfo = c.createOscillator();
  const depth = c.createGain();
  lfo.frequency.value = 0.07;
  depth.gain.value = 180;
  lfo.connect(depth).connect(tone.frequency);
  lfo.start();
  // A soft echo for the bubbles.
  echo = c.createDelay(1.5);
  echo.delayTime.value = 0.42;
  const feedback = c.createGain();
  feedback.gain.value = 0.35;
  const wet = c.createGain();
  wet.gain.value = 0.5;
  echo.connect(feedback).connect(echo);
  echo.connect(wet).connect(bus);
}

function level() {
  const p = getSoundPref();
  return p.music ? p.musicVolume * 0.32 : 0;
}

function chord(c: AudioContext, t: number, notes: number[], dur: number) {
  for (const n of notes) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 2.5);
    g.gain.setValueAtTime(0.09, t + dur - 1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 3);
    g.connect(tone!);
    for (const detune of [-7, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(n);
      o.detune.value = detune;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 3.2);
    }
  }
}

function bubble(c: AudioContext, t: number) {
  const n = BUBBLES[Math.floor(Math.random() * BUBBLES.length)];
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(hz(n) * 0.94, t);
  o.frequency.exponentialRampToValueAtTime(hz(n), t + 0.06);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  o.connect(g);
  g.connect(bus!);
  g.connect(echo!);
  o.start(t);
  o.stop(t + 1);
}

function beat(c: AudioContext, t: number) {
  for (const [dt, v] of [
    [0, 0.16],
    [0.22, 0.1],
  ] as const) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(62, t + dt);
    o.frequency.exponentialRampToValueAtTime(42, t + dt + 0.25);
    g.gain.setValueAtTime(0.0001, t + dt);
    g.gain.exponentialRampToValueAtTime(v, t + dt + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.3);
    o.connect(g).connect(bus!);
    o.start(t + dt);
    o.stop(t + dt + 0.35);
  }
}

/** Schedule a little ahead of the audio clock, once a second. */
function tick() {
  const c = audio();
  if (!c || !bus) return;
  const now = c.currentTime;
  const ahead = now + 1.5;
  const tense = mood === 'match';
  while (nextChord < ahead) {
    const prog = tense ? TENSE : CALM;
    const len = tense ? 7 : 10;
    chord(c, Math.max(nextChord, now), prog[step % prog.length], len);
    step++;
    nextChord = Math.max(nextChord, now) + len;
  }
  while (nextBubble < ahead) {
    bubble(c, Math.max(nextBubble, now));
    nextBubble = Math.max(nextBubble, now) + (tense ? 1.2 - 0.6 * intensity : 2.5) + Math.random() * (tense ? 2 - intensity : 4);
  }
  if (tense) {
    while (nextBeat < ahead) {
      beat(c, Math.max(nextBeat, now));
      nextBeat = Math.max(nextBeat, now) + 1.6 - 0.75 * intensity; // the heartbeat quickens with the tension
    }
  }
}

function fadeTo(v: number, secs = 1.5) {
  const c = audio();
  if (!c || !bus) return;
  bus.gain.cancelScheduledValues(c.currentTime);
  bus.gain.setValueAtTime(bus.gain.value, c.currentTime);
  bus.gain.linearRampToValueAtTime(v, c.currentTime + secs);
}

function start() {
  if (running || level() === 0 || document.hidden) return;
  const c = audio();
  if (!c) return;
  build(c);
  running = true;
  if (!drone) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz(38); // D2
    gain.gain.value = 0.12;
    osc.connect(gain).connect(tone!);
    osc.start();
    drone = { osc, gain };
  }
  nextChord = nextBubble = nextBeat = c.currentTime + 0.2;
  tick();
  timer = setInterval(tick, 1000);
  fadeTo(level(), 3);
}

function stop() {
  if (!running) return;
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
  fadeTo(0, 1.2);
}

/** Dip the music for a moment that should stand alone (an evolution, the end of a match), then bring it back. */
export function duckMusic(ms: number) {
  const c = audio();
  if (!c || !bus || !running) return;
  const v = level();
  bus.gain.cancelScheduledValues(c.currentTime);
  bus.gain.setValueAtTime(bus.gain.value, c.currentTime);
  bus.gain.linearRampToValueAtTime(v * 0.25, c.currentTime + 0.15);
  bus.gain.setValueAtTime(v * 0.25, c.currentTime + ms / 1000);
  bus.gain.linearRampToValueAtTime(v, c.currentTime + ms / 1000 + 1.2);
}

/** How tense the match is right now (0 calm .. 1 on the edge). Eased in, so the music swells rather than jumps. */
export function setMusicIntensity(x: number) {
  const v = Math.max(0, Math.min(1, x));
  if (Math.abs(v - intensity) < 0.05) return;
  intensity = v;
  const c = audio();
  if (c && tone && running && mood === 'match') tone.frequency.setTargetAtTime(950 + 650 * v, c.currentTime, 1.5);
}

/** Calm on the menus, tense in a match. */
export function setMusicMood(m: Mood) {
  if (m === mood) return;
  mood = m;
  const c = audio();
  if (c && tone && running) {
    // Let the current chord finish its bar, then switch.
    nextChord = Math.min(nextChord, c.currentTime + 2);
    if (m === 'calm') intensity = 0;
    tone.frequency.setTargetAtTime(m === 'match' ? 950 + 650 * intensity : 700, c.currentTime, 2);
  }
}

/** Wire the music to the page: start on the first tap or key (browser rule), follow the settings, go quiet
 * in a background tab. */
export function initMusic() {
  if (typeof window === 'undefined') return;
  const kick = () => start();
  window.addEventListener('pointerdown', kick);
  window.addEventListener('keydown', kick);
  onSoundPref(() => {
    if (level() === 0) stop();
    else if (running) fadeTo(level(), 0.4);
    else start();
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
}
