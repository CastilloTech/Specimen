import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { SlotId } from '../../engine';
import { back, disposeTree, ease, easeInOut, loadGltf, prefersReducedMotion, runTweens } from './core';
import type { Tween } from './core';
import { cocoon, placeholderPart, scar } from './grafts';
import type { Part } from './grafts';
import { graftModelLoader, SPECIMEN } from './models';
import type { Clip, SpecimenModel } from './models';

// One Specimen in a 3D scene: the creature, its grafts on their sockets, and the animations the match drives.
// A rigged model plays its clips (idle; an attack in a clash, a hit reaction, evolving, dying, a victory roar) and
// its grafts ride its bones; a model without clips gets the same moments made in code (breathing, a flinch, a
// slump). Either way: Strain tremor, lunges, glows; grafts growing in, firing, cracking, destroyed or ejected.
// Whoever owns the scene places it (root), tells it what's on the body (setState) and what just happened (fire),
// and calls update() each frame; it animates the rest itself.

export interface GraftView {
  slot: SlotId;
  uid: string;
  /** Null when the viewer can't know it (an opponent's face-down graft). */
  cardId: string | null;
  faceDown: boolean;
  color: string;
  poisoned: boolean;
  disabled: boolean;
  /** 0, 1 (Veteran) or 2 (Elite). */
  rank: number;
}

export interface StageState {
  grafts: GraftView[];
  /** Slots that are necrotic (dead for a while). */
  necrosis: SlotId[];
  /** Strain against the rejection line, 0..1+. */
  strain: number;
  hp: number;
  /** The evolved form's colour, or null. */
  tint: string | null;
  dead: boolean;
  won: boolean;
  /** The player's colour (rim light). */
  color: string;
  /** Its stance this round, once the viewer may know it (it shapes the idle). */
  stance: 'aggress' | 'fortify' | 'adapt' | null;
  /** In the rejection zone (Strain past the threshold): it staggers, whatever its stance. */
  rejecting: boolean;
}

export type StageEvent = { kind: 'wear' | 'destroyed' | 'ejected' | 'reveal'; slot: SlotId } | { kind: 'engine'; slot: SlotId; color: string } | { kind: 'evolve' };

/** Where each socket sits on the canvas, in percent. */
export type Anchors = Partial<Record<SlotId, { x: number; y: number }>>;

const UP = new THREE.Vector3(0, 1, 0);
/** Parts drawn larger than life on small slots, so they read at board size (a phone held sideways). */
const PART_SCALE: Record<SlotId, number> = { head: 1.9, nerve: 1.9, organ: 1.2, organB: 1.2, limbA: 1.35, limbB: 1.35 };
/** In a clash, the attack plays this much faster, and its blow lands this long after the clash begins (the
 * arena's impact shake and the board's hit-stop land then too). The one struck reacts at the same moment. */
const ATTACK_SPEED = 1.4;
const STRIKE_MS = 300;

interface Mounted {
  uid: string;
  key: string;
  part: Part;
  holder: THREE.Group;
  leaving: boolean;
  base: number[];
}

export class SpecimenActor {
  /** Placed by the scene's owner: where the Specimen stands and which way it faces. */
  readonly root = new THREE.Group();
  /** Breathing, tremor and lunges ride here. */
  private rig = new THREE.Group();
  private body = new THREE.Group();
  private bodyMats: THREE.MeshStandardMaterial[] = [];
  private rim: THREE.PointLight;
  readonly model: SpecimenModel;
  ready = false;
  private readyFns: (() => void)[] = [];
  private tweens: Tween[] = [];
  private grafts = new Map<SlotId, Mounted>();
  private scars = new Map<SlotId, THREE.Group>();
  /** Each socket: placed on the body at rest, then carried by its bone (rigged) or the body. Parts sit on these. */
  private marks = new Map<SlotId, THREE.Object3D>();
  private mixer: THREE.AnimationMixer | null = null;
  private acts: Partial<Record<Clip, THREE.AnimationAction>> = {};
  private cur: THREE.AnimationAction | null = null;
  /** When (scene ms) this Specimen last swung in a clash; a reaction (hit or knockout) waiting for the blow to
   * land; and a victory roar waiting for its last swing to finish. */
  private attackAt = -Infinity;
  private reactAt = -1;
  private reactWith: 'hit' | 'die' | null = null;
  private roarAt = -1;
  private hitPower = 0;
  /** Grafts just gone from the state: their exit waits a beat for the match to say how (destroyed or ejected). */
  private pending = new Map<SlotId, ReturnType<typeof setTimeout>>();
  state: StageState | null = null;
  /** The scene clock (ms) at the last update: tweens start from it. */
  private now = 0;
  private flinch = 0;
  private flash = new THREE.Color(0, 0, 0);
  private flashK = 0;
  private fall = 0;
  /** How far a clash has carried it from its spot (scene x), and a hop's height. */
  private moveX = 0;
  private moveY = 0;
  private reduced = prefersReducedMotion();
  private disposed = false;
  /** Asks the owner for a frame (something started animating while the scene rests). */
  onWake: () => void = () => undefined;

  constructor(opts: { model?: SpecimenModel } = {}) {
    this.model = opts.model ?? SPECIMEN;
    // A rim light in the player's colour, just behind the creature (it lights only what's near).
    this.rim = new THREE.PointLight(0xffffff, 0.6, 2, 2);
    this.rim.position.set(0, 0.2, -0.9);
    this.root.add(this.rim);
    this.rig.add(this.body);
    this.root.add(this.rig);
    void loadGltf(this.model.url).then((g) => this.mount(g));
  }

  /** Called once the creature is in the scene (its sockets are then meaningful). */
  whenReady(fn: () => void) {
    if (this.ready) fn();
    else this.readyFns.push(fn);
  }

  private mount(g: GLTF) {
    if (this.disposed) return;
    const obj = cloneSkinned(g.scene);
    obj.userData.shared = true;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // Each Specimen gets its own materials (its own glow and tint); geometry and textures stay shared.
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => (x as THREE.MeshStandardMaterial).clone());
      m.material = Array.isArray(m.material) ? mats : mats[0];
      for (const mat of mats) {
        mat.emissive = new THREE.Color(0, 0, 0);
        this.bodyMats.push(mat);
      }
    });
    this.body.add(obj);
    // Sockets: placed at rest, then handed to their bone, which carries them (and the grafts) from then on.
    this.root.updateMatrixWorld(true);
    for (const slot of Object.keys(this.model.sockets) as SlotId[]) {
      const s = this.model.sockets[slot];
      const mark = new THREE.Object3D();
      mark.position.set(...s.at);
      mark.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...s.out).normalize());
      this.body.add(mark);
      mark.updateMatrixWorld(true);
      const bone = s.bone ? obj.getObjectByName(s.bone) : undefined;
      if (bone) bone.attach(mark);
      this.marks.set(slot, mark);
    }
    if (g.animations.length) {
      this.mixer = new THREE.AnimationMixer(obj);
      for (const clip of g.animations) this.acts[clip.name as Clip] = this.mixer.clipAction(clip);
      // A one-off (attack, hit, roar, evolve) returns to the idle; dying holds its last frame.
      this.mixer.addEventListener('finished', (e) => {
        if (e.action === this.cur && e.action !== this.acts.die) this.play(this.idleClip(), { fade: 0.35 });
      });
      this.play(this.state?.dead ? 'die' : this.idleClip(), { start: this.state?.dead ? 99 : Math.random() * 4 });
    }
    this.ready = true;
    if (this.state) this.apply(this.state);
    this.onWake();
    for (const fn of this.readyFns) fn();
    this.readyFns = [];
  }

  /** A socket's position in world space. */
  socketWorld(slot: SlotId, out = new THREE.Vector3()) {
    const mark = this.marks.get(slot);
    if (mark) return mark.getWorldPosition(out);
    out.set(...this.model.sockets[slot].at);
    return this.body.localToWorld(out);
  }

  // ---------- Clips (rigged models) ----------

  /** Plays a clip, cross-fading from the one playing. One-offs play once and hold their last frame. */
  private play(name: Clip, o: { once?: boolean; start?: number; speed?: number; fade?: number } = {}) {
    const a = this.acts[name];
    if (!a || (a === this.cur && !o.once)) return;
    a.reset();
    a.setLoop(o.once || name === 'die' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = true;
    a.timeScale = o.speed ?? 1;
    a.time = Math.min(o.start ?? 0, a.getClip().duration);
    a.play();
    if (this.cur && this.cur !== a) this.cur.crossFadeTo(a, o.fade ?? 0.18, false);
    this.cur = a;
  }

  private get rigged() {
    return !!this.mixer;
  }

  /** The idle for now: the rejection stagger, else its stance's (Adapt, Fortify; Aggress is the plain idle). */
  private idleClip(): Clip {
    if (this.state?.rejecting && this.acts.strained) return 'strained';
    const st = this.state?.stance;
    return (st === 'adapt' || st === 'fortify') && this.acts[st] ? st : 'idle';
  }

  /** Whether it's idling (in any stance), not in the middle of a one-off. */
  private get idling() {
    return (['idle', 'adapt', 'fortify', 'strained'] as Clip[]).some((c) => this.acts[c] && this.acts[c] === this.cur);
  }

  /** The middle of the chest in world space, wherever a clash has carried it (where cameras look). */
  centerWorld(out = new THREE.Vector3()) {
    out.set(0, 0.12, 0);
    return this.rig.localToWorld(out);
  }

  // ---------- What's on the body ----------

  setState(s: StageState) {
    const prev = this.state;
    this.state = s;
    this.rim.color.set(s.color);
    if (prev && s.hp < prev.hp) this.hit(Math.min(1, (prev.hp - s.hp) / 8));
    else if (prev && s.hp > prev.hp) this.glowPulse(new THREE.Color(0x4ade80), 0.5);
    // The knockout and the win (a new match brings it back to its feet).
    // The knockout falls when the blow lands; the winner roars once its swing is done.
    if (s.dead && !prev?.dead) {
      this.reactWith = 'die';
      this.scheduleReaction();
    } else if (!s.dead && prev?.dead) {
      this.moveX = 0;
      this.play(this.idleClip(), { fade: 0.4 });
    } else if ((s.stance !== prev?.stance || s.rejecting !== prev?.rejecting) && this.idling && !s.dead) this.play(this.idleClip(), { fade: 0.45 });
    if (s.won && prev && !prev.won) this.roarAt = this.now + 90;
    if (this.ready) this.apply(s);
    this.onWake();
  }

  private apply(s: StageState) {
    // Grafts: new ones grow in; gone ones are animated away by their event (or simply shrink).
    const want = new Map(s.grafts.map((g) => [g.slot, g]));
    for (const [slot, m] of this.grafts) {
      const g = want.get(slot);
      if (m.leaving || (g && g.uid === m.uid)) continue;
      // Replaced at once by another graft: out it goes now. Otherwise wait for the match to say how it left.
      if (g) this.exit(slot, 'destroyed');
      else if (!this.pending.has(slot)) this.pending.set(slot, setTimeout(() => this.exit(slot, 'destroyed'), 180));
    }
    for (const g of s.grafts) {
      const key = `${g.uid}:${g.faceDown && !g.cardId ? 'cocoon' : g.cardId}:${g.faceDown}`;
      const m = this.grafts.get(g.slot);
      if (m && !m.leaving && m.uid === g.uid) {
        if (m.key !== key) this.swap(g, key);
        this.dress(this.grafts.get(g.slot)!, g);
        continue;
      }
      this.attach(g, key, true);
    }
    // Necrotic sockets show a scar.
    for (const slot of Object.keys(this.model.sockets) as SlotId[]) {
      const dead = s.necrosis.includes(slot) && !want.has(slot);
      const had = this.scars.get(slot);
      if (dead && !had) {
        const p = scar();
        const holder = this.holder(slot);
        holder.add(p.group);
        this.scars.set(slot, holder);
      } else if (!dead && had) {
        had.removeFromParent();
        disposeTree(had);
        this.scars.delete(slot);
      }
    }
    for (const mat of this.bodyMats) mat.envMapIntensity = s.dead ? 0.35 : 1;
  }

  /** A holder on a socket (its +Y points out of the body), for a part or a scar. */
  private holder(slot: SlotId): THREE.Group {
    const h = new THREE.Group();
    h.scale.setScalar(PART_SCALE[slot]);
    this.marks.get(slot)!.add(h);
    return h;
  }

  private attach(g: GraftView, key: string, grow: boolean) {
    const part = g.faceDown ? cocoon() : placeholderPart(g.slot, g.cardId ?? g.uid, g.color);
    const holder = this.holder(g.slot);
    holder.add(part.group);
    const m: Mounted = { uid: g.uid, key, part, holder, leaving: false, base: part.glow.map((x) => x.emissiveIntensity) };
    this.grafts.set(g.slot, m);
    this.dress(m, g);
    if (grow && !this.reduced) {
      part.group.scale.setScalar(0.001);
      this.tween(420, (k) => part.group.scale.setScalar(Math.max(0.001, back(k))));
    }
    // The card's own model, when it has one: replaces the placeholder once loaded.
    if (!g.faceDown && g.cardId) {
      const get = graftModelLoader(g.cardId);
      if (get)
        void get()
          .then(loadGltf)
          .then((gl) => {
            const cur = this.grafts.get(g.slot);
            if (this.disposed || !cur || cur.uid !== g.uid || cur.leaving) return;
            const obj = cloneSkinned(gl.scene);
            obj.userData.shared = true;
            // Sit it on the socket: its base at the origin, about 0.08 units across.
            const box = new THREE.Box3().setFromObject(obj);
            const size = box.getSize(new THREE.Vector3());
            const k = 0.08 / Math.max(size.x, size.y, size.z, 0.001);
            obj.scale.setScalar(k);
            obj.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k, -((box.min.z + box.max.z) / 2) * k);
            const glow: THREE.MeshStandardMaterial[] = [];
            obj.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh) return;
              const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((x) => (x as THREE.MeshStandardMaterial).clone());
              mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
              for (const mm of mats) if ('emissive' in mm) glow.push(mm);
            });
            cur.holder.remove(cur.part.group);
            disposeTree(cur.part.group);
            const group = new THREE.Group();
            group.add(obj);
            cur.holder.add(group);
            cur.part = { group, glow };
            cur.base = glow.map((x) => x.emissiveIntensity || 0.6);
            this.onWake();
          })
          .catch(() => undefined);
    }
  }

  /** Same graft, new look (a face-down graft revealed). */
  private swap(g: GraftView, key: string) {
    const m = this.grafts.get(g.slot)!;
    m.holder.removeFromParent();
    this.drop(m.holder);
    this.grafts.delete(g.slot);
    this.attach(g, key, true);
  }

  /** Frees a removed graft (its card model's cloned materials included). */
  private drop(holder: THREE.Group) {
    holder.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mat.dispose();
    });
    disposeTree(holder);
  }

  /** Poisoned grafts glow purple, disabled ones go dark, Veterans and Elites shine. */
  private dress(m: Mounted, g: GraftView) {
    m.part.glow.forEach((mat, i) => {
      mat.userData.tint = g.poisoned ? 0xd946ef : g.rank >= 2 ? 0xf0abfc : g.rank >= 1 ? 0xfbbf24 : null;
      mat.userData.base = g.disabled ? 0.08 : (m.base[i] ?? 0.8) + (g.rank ? 0.35 : 0);
      mat.emissiveIntensity = mat.userData.base;
    });
  }

  private exit(slot: SlotId, how: 'destroyed' | 'ejected') {
    const t = this.pending.get(slot);
    if (t) clearTimeout(t);
    this.pending.delete(slot);
    this.leave(slot, how);
  }

  private leave(slot: SlotId, how: 'destroyed' | 'ejected') {
    const m = this.grafts.get(slot);
    if (!m) return;
    m.leaving = true;
    this.grafts.delete(slot);
    const holder = m.holder;
    const gone = () => {
      holder.removeFromParent();
      this.drop(holder);
    };
    // In the socket's own frame: out of the body is +Y; down is wherever the world's down is.
    const start = holder.position.clone();
    const out = UP.clone();
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(holder.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
    if (this.reduced) return gone();
    if (how === 'ejected') {
      this.tween(800, (k) => {
        holder.position.copy(start).addScaledVector(out, ease(k) * 0.35).addScaledVector(down, 0.25 * k * k);
        holder.rotation.x += 0.25;
        holder.scale.setScalar(1 - k * 0.6);
      }, gone);
    } else {
      this.tween(650, (k) => {
        holder.scale.setScalar(Math.max(0.001, 1 - ease(k)));
        holder.position.copy(start).addScaledVector(out, -0.02 * k);
      }, gone);
    }
  }

  // ---------- What just happened ----------

  fire(e: StageEvent) {
    if (e.kind === 'evolve') return this.evolve();
    const m = this.grafts.get(e.slot);
    if (e.kind === 'ejected' || e.kind === 'destroyed') {
      if (this.pending.has(e.slot)) this.exit(e.slot, e.kind);
      return;
    }
    if (!m) return;
    if (e.kind === 'engine') {
      const c = new THREE.Color(e.color);
      this.tween(700, (k) => {
        const pulse = Math.sin(Math.PI * k);
        m.part.group.scale.setScalar(1 + 0.35 * pulse);
        for (const mat of m.part.glow) {
          mat.emissive.copy(c);
          mat.emissiveIntensity = (mat.userData.base ?? 0.8) + 2.5 * pulse;
        }
      });
    } else if (e.kind === 'wear') {
      const start = m.part.group.position.clone();
      this.tween(450, (k) => {
        const a = (1 - k) * 0.006;
        m.part.group.position.set(start.x + (Math.random() - 0.5) * a, start.y, start.z + (Math.random() - 0.5) * a);
        for (const mat of m.part.glow) {
          mat.emissive.setRGB(1, 0.45 * k + 0.2, 0.1 * k);
          mat.emissiveIntensity = (mat.userData.base ?? 0.8) + 1.8 * (1 - k);
        }
      }, () => m.part.group.position.copy(start));
    } else if (e.kind === 'reveal') {
      this.tween(500, (k) => m.part.group.scale.setScalar(1 + 0.4 * Math.sin(Math.PI * k)));
    }
  }

  /**
   * A clash. It dashes `reach` across the arena toward its opponent (dir: +1 right, -1 left) and swings, unless it
   * holds; the blows land STRIKE_MS in; a blow knocks it back `knock`; then it hops back to its spot (or, knocked
   * out, stays down where it fell).
   */
  clash(o: { dir: number; reach: number; swing: boolean; knock: number }) {
    const down = this.cur === this.acts.die;
    if (this.rigged && !down) {
      // The swing (or, holding, the guard), started so the blow lands (or the guard is up) STRIKE_MS from now.
      this.attackAt = this.now;
      if (o.swing) {
        const strike = this.model.attackStrike ?? 0;
        this.play('attack', { once: true, speed: ATTACK_SPEED, start: Math.max(0, strike - (STRIKE_MS / 1000) * ATTACK_SPEED), fade: 0.1 });
      } else this.play('block', { once: true, start: Math.max(0, (this.model.blockUp ?? 0) - STRIKE_MS / 1000), fade: 0.1 });
    }
    // A reaction already waiting (the damage arrived a frame before the clash) waits for the blow instead.
    if (this.reactAt >= 0) this.reactAt = this.now + STRIKE_MS;
    if (this.roarAt >= 0) this.roarAt = this.now + 1150;
    if (this.reduced || down) return;
    const DASH = 230, KNOCK = 200, BACK_AT = 760, BACK = 520, TOTAL = BACK_AT + BACK;
    const reach = o.swing ? o.reach : 0;
    this.tween(TOTAL, (k) => {
      const ms = k * TOTAL;
      let x: number;
      let y = 0;
      if (ms < DASH) x = reach * (ms / DASH) ** 2; // accelerating in
      else if (ms < STRIKE_MS) x = reach;
      else if (ms < STRIKE_MS + KNOCK) x = reach - o.knock * ease((ms - STRIKE_MS) / KNOCK);
      else if (ms < BACK_AT || this.cur === this.acts.die) x = reach - o.knock;
      else {
        const p = (ms - BACK_AT) / BACK;
        x = (reach - o.knock) * (1 - easeInOut(p));
        y = 0.045 * Math.sin(Math.PI * p) * Math.min(1, Math.abs(reach - o.knock) * 4); // a hop back
      }
      this.moveX = o.dir * x;
      this.moveY = y;
    }, () => {
      // Knocked out, it stays where it fell; otherwise it's home.
      if (this.cur !== this.acts.die) this.moveX = 0;
      this.moveY = 0;
    });
  }

  private hit(power: number) {
    if (!this.rigged) {
      this.glowPulse(new THREE.Color(0xff3b2f), 0.35 + 0.5 * power);
      this.flinch = Math.max(this.flinch, 0.35 + 0.65 * power);
      return;
    }
    // The red flash comes with the reaction, when the blow lands.
    this.hitPower = Math.max(this.hitPower, power);
    if (this.reactWith !== 'die') this.reactWith = 'hit';
    this.scheduleReaction();
  }

  /** Mid-clash, a reaction waits for the blow to land. Otherwise it comes after a beat: the clash that dealt this
   * damage may only now be starting (the board sends the damage a frame before the clash), and then clash() moves
   * the reaction to the blow. */
  private scheduleReaction() {
    const land = this.attackAt + STRIKE_MS;
    this.reactAt = this.now < land ? land : this.now + 90;
  }

  private react() {
    const kind = this.reactWith;
    this.reactWith = null;
    if (this.hitPower > 0) this.glowPulse(new THREE.Color(0xff3b2f), 0.35 + 0.5 * this.hitPower);
    this.hitPower = 0;
    if (kind === 'die') this.play('die', { once: true, fade: 0.15 });
    else if (kind === 'hit' && !this.state?.dead && this.cur !== this.acts.die) this.play('hit', { once: true, speed: 1.25, fade: 0.08 });
  }

  private glowPulse(c: THREE.Color, k: number) {
    this.flash.copy(c);
    this.flashK = Math.max(this.flashK, k);
  }

  private evolve() {
    if (!this.state?.dead) this.play('evolve', { once: true, fade: 0.2 });
    if (this.reduced) return;
    const c = new THREE.Color(this.state?.tint ?? this.state?.color ?? '#a78bfa');
    this.tween(1400, (k) => {
      const pulse = Math.sin(Math.PI * k);
      this.body.scale.setScalar(1 + 0.06 * pulse);
      this.flash.copy(c);
      this.flashK = Math.max(this.flashK, 0.9 * pulse);
    }, () => this.body.scale.setScalar(1));
  }

  private tween(dur: number, step: (k: number) => void, done?: () => void) {
    this.tweens.push({ t0: this.now, dur, step, done });
    this.onWake();
  }

  /** One frame. `now` is the scene clock in ms (it stands still during a hit-stop), `dt` seconds. */
  update(now: number, dt: number) {
    this.now = now;
    runTweens(this.tweens, now);
    const t = now / 1000;
    const s = this.state;
    const strain = Math.max(0, Math.min(1.2, s?.strain ?? 0));
    if (this.mixer) {
      if (this.reactAt >= 0 && now >= this.reactAt) {
        this.reactAt = -1;
        this.react();
      }
      if (this.roarAt >= 0 && now >= this.roarAt) {
        this.roarAt = -1;
        this.play('victory', { once: true, fade: 0.3 });
      }
      // The idle quickens as Strain climbs (the clips carry the breathing).
      if (this.cur === this.acts.idle) this.cur!.timeScale = 1 + 0.8 * Math.min(1, strain);
      this.mixer.update(dt);
    }
    if (!this.reduced) {
      // Breathing (unrigged): faster as Strain climbs; a tremor near the rejection line.
      const period = 4.5 - 2.6 * Math.min(1, strain);
      if (!this.mixer) this.rig.scale.set(1, 1 + 0.007 * Math.sin((t * Math.PI * 2) / period), 1);
      this.rig.position.x = strain > 0.85 ? (Math.random() - 0.5) * 0.005 : 0;
      // Organs and nerves pulse with the breath.
      for (const [slot, m] of this.grafts) {
        if (slot === 'organ' || slot === 'organB' || slot === 'nerve') {
          const p = 1 + 0.06 * Math.sin((t * Math.PI * 2) / (period * 0.5));
          if (!m.leaving && this.tweens.length === 0) m.part.group.scale.setScalar(p);
        }
        for (const mat of m.part.glow) {
          const tint = mat.userData.tint as number | null | undefined;
          if (tint) mat.emissive.lerp(new THREE.Color(tint), 0.08);
        }
      }
    }
    // Clash movement is in the scene's frame (toward the opponent), so it undoes the facing turn.
    if (this.moveX || this.moveY) {
      const v = new THREE.Vector3(this.moveX, 0, 0).applyAxisAngle(UP, -this.root.rotation.y);
      this.rig.position.x += v.x;
      this.rig.position.z = v.z;
      this.rig.position.y = this.moveY;
    } else this.rig.position.set(this.rig.position.x, 0, 0);
    // Unrigged: a hit leans it back, then it recovers; a KO slumps it forward and sinks it. (Clips do this otherwise.)
    if (!this.mixer) {
      this.flinch = Math.max(0, this.flinch - dt * 2.4);
      this.fall += ((s?.dead ? 1 : 0) - this.fall) * Math.min(1, dt * 2.5);
      this.body.rotation.x = -0.22 * Math.sin(this.flinch * Math.PI) + 0.55 * this.fall;
      this.body.position.y = -0.18 * this.fall;
    }
    // Glow on the body: a flash (hit, heal, evolve) fading, the evolved tint, a win's slow pulse. Kept faint: the
    // body is dark metal, so even a little glow reads as a strong colour.
    this.flashK = Math.max(0, this.flashK - dt * 1.6);
    const glow = new THREE.Color(0, 0, 0);
    if (s?.tint) glow.add(new THREE.Color(s.tint).multiplyScalar(0.03));
    if (s?.won) glow.add(new THREE.Color(s.color).multiplyScalar(0.012 + 0.01 * Math.sin(t * 3)));
    glow.add(this.flash.clone().multiplyScalar(this.flashK * 0.16));
    for (const mat of this.bodyMats) mat.emissive.copy(glow);
  }

  dispose() {
    this.disposed = true;
    this.mixer?.stopAllAction();
    for (const t of this.pending.values()) clearTimeout(t);
    for (const m of this.grafts.values()) this.drop(m.holder);
    for (const h of this.scars.values()) disposeTree(h);
    for (const mat of this.bodyMats) mat.dispose();
  }
}
