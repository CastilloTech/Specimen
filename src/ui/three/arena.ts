import * as THREE from 'three';
import { SpecimenActor } from './actor';
import type { Anchors, StageEvent, StageState } from './actor';
import { disposeTree, easeInOut, loadGltf, makeRenderer, prefersReducedMotion } from './core';
import type { SlotId } from '../../engine';
import type { CamView } from './pref';

// The arena: both Specimens in one 3D scene, standing on their pedestals in a lab, with a camera that has several
// views to pick from and cuts to its own shots at the big moments (a clash, an evolution, the knockout).
//
// The default view (Broadcast) is built from the page layout: each Specimen stands where its box is on screen, so
// the graft plates beside it line up with its sockets. The other views move freely; the plates stay put and their
// leader lines hide until the camera is back.
//
// Optional art, dropped into src/assets/models/ (no code needed):
//   arena.glb                 the arena set (floor, walls...), replacing the built-in lab. It's centred, scaled to
//                             ARENA_SIZE across and darkened; its floor is the surface at its open middle.
//   arena-sky.jpg/.webp/.png  a 360° panorama (2:1, equirectangular) behind everything.

export type Side = 'left' | 'right';
/** A Specimen's box on the page, in canvas pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A clash: each hit names the side struck. `hold` marks that the other side held (it doesn't attack). */
export type ArenaCue = { kind: 'clash'; hits: { side: Side; dmg: number; big: boolean; hold: boolean }[] };

const ARENA_GLB = import.meta.glob('../../assets/models/arena.glb', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;
const ARENA_SKY = import.meta.glob('../../assets/models/arena-sky.{jpg,jpeg,png,webp}', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;

const FOV = 26;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
/** How much of its box a Specimen fills (height), in the Broadcast view. */
const FILL = 0.9;
const FLOOR = -0.5;
/** The Broadcast camera stays this close (inside the arena's rim); past it, it zooms with the lens instead. */
const MAX_DIST = 2.9;
/** An arena.glb's width (world units; a Specimen is 1 tall), and how much its colours are darkened. */
const ARENA_SIZE = 7;
/** The backdrop goes round the arena this many times (its tanks look this many times smaller), turned so a tank
 * stands behind the arena in Broadcast. */
const SKY_WRAP = 3;
const SKY_TURN = (0.25 + 0.75 * SKY_WRAP) % 1; // the image's tank (a quarter in) at the dome's -Z (three quarters round)
const ARENA_SHADE = 0.34;
const ACCENT = 0x7be0b0;
const BG = 0x040908;
/** Which way each Specimen faces: three-quarters to the audience in Broadcast, squarer to each other otherwise,
 * and square on while they fight. */
const YAW = { show: 0.45, duel: 0.95, fight: 1.35, stance: 1.2 };
/** In a clash they meet this far apart (centre to centre): close enough for the claws to land. */
const CONTACT = 0.34;

interface Shot {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  /** Field of view (degrees); FOV if not given. */
  fov?: number;
}
interface Cue {
  kind: 'clash' | 'evolve' | 'finale';
  t0: number;
  dur: number;
  shot: (k: number, ms: number) => Shot;
}

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** The height of a model's floor: its highest point within `r` of its centre (world units). Null if nothing's there. */
function centreFloor(obj: THREE.Object3D, r: number): number | null {
  const centre = new THREE.Box3().setFromObject(obj).getCenter(v3());
  const v = v3();
  let top = -Infinity;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (Math.hypot(v.x - centre.x, v.z - centre.z) < r && v.y > top) top = v.y;
    }
  });
  return top > -Infinity ? top : null;
}

// ---------- The built-in lab ----------

/** Hexagon floor tiles with a few rings, drawn once as a texture (base colour and glow). */
function floorTexture(): THREE.CanvasTexture {
  const n = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, n, n);
  const r = 26;
  const h = Math.sqrt(3) * r;
  g.lineWidth = 2;
  for (let row = -1; row * h < n + h; row++) {
    for (let col = -1; col * r * 1.5 < n + r; col++) {
      const cx = col * r * 1.5;
      const cy = row * h + (col % 2 ? h / 2 : 0);
      const d = Math.hypot(cx - n / 2, cy - n / 2) / (n / 2);
      if (d > 1) continue;
      g.strokeStyle = `rgba(123,224,176,${(0.32 * (1 - d * 0.75)).toFixed(3)})`;
      g.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = cx + r * 0.94 * Math.cos(a);
        const py = cy + r * 0.94 * Math.sin(a);
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.stroke();
    }
  }
  g.strokeStyle = 'rgba(123,224,176,0.55)';
  for (const [rad, w] of [
    [0.97, 6],
    [0.9, 2],
    [0.12, 3],
  ] as const) {
    g.lineWidth = w;
    g.beginPath();
    g.arc(n / 2, n / 2, (n / 2) * rad, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A soft round glow (for pools of light and shadows under the feet). */
function radial(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const metal = (color = 0x0d1513) => new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.45 });

interface Pedestal {
  group: THREE.Group;
  ring: THREE.MeshStandardMaterial;
  pool: THREE.MeshBasicMaterial;
}

function pedestal(): Pedestal {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.41, 0.05, 48), metal(0x101a17));
  base.position.y = FLOOR + 0.005;
  group.add(base);
  const ring = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(ACCENT), emissiveIntensity: 1.6 });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.385, 0.009, 8, 64), ring);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = FLOOR + 0.03;
  group.add(halo);
  // A pool of the player's colour on the floor around it, and a soft shadow under the feet.
  const pool = new THREE.MeshBasicMaterial({ map: radial('rgba(255,255,255,0.55)', 'rgba(255,255,255,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), pool);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = FLOOR - 0.008;
  group.add(glow);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 32),
    new THREE.MeshBasicMaterial({ map: radial('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = FLOOR + 0.032;
  group.add(shadow);
  return { group, ring, pool };
}

interface Lab {
  /** The parts an arena.glb replaces. */
  set: THREE.Group;
  /** Moving bits: bubbles in the vats, dust in the air. */
  update: (t: number) => void;
}

function lab(): Lab {
  const set = new THREE.Group();
  const floorTex = floorTexture();
  // Low reflection: a shiny floor catches the studio light as a grey band across the front.
  const top = new THREE.MeshStandardMaterial({ color: 0x0a1210, metalness: 0.65, roughness: 0.55, envMapIntensity: 0.3, emissive: new THREE.Color(ACCENT), emissiveMap: floorTex, emissiveIntensity: 0.55 });
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.25, 0.1, 96), [metal(0x0b1311), top, metal(0x0b1311)]);
  floor.position.y = FLOOR - 0.05;
  set.add(floor);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(2.17, 0.014, 8, 160), new THREE.MeshStandardMaterial({ color: 0x0, emissive: new THREE.Color(ACCENT), emissiveIntensity: 1.2 }));
  edge.rotation.x = Math.PI / 2;
  edge.position.y = FLOOR;
  set.add(edge);

  // Specimen vats on an arc behind the arena: glass tubes of glowing fluid, bubbles rising.
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fe8d0, transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const cap = metal(0x18221f);
  const fluids = [0x2fbf8f, 0x3aa0c8, 0x7be0b0, 0x9a6be0, 0x2fbf8f, 0x3aa0c8, 0x7be0b0];
  const vats: { x: number; z: number }[] = [];
  fluids.forEach((col, i) => {
    const a = THREE.MathUtils.degToRad(-66 + (132 / (fluids.length - 1)) * i);
    const x = Math.sin(a) * 2.85;
    const z = -Math.cos(a) * 2.85;
    vats.push({ x, z });
    const vat = new THREE.Group();
    vat.position.set(x, FLOOR, z);
    const fluid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.19, 1.25, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x041410, emissive: new THREE.Color(col), emissiveIntensity: 0.55, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    fluid.position.y = 0.78;
    vat.add(fluid);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 1.45, 24, 1, true), glass);
    tube.position.y = 0.85;
    vat.add(tube);
    for (const y of [0.07, 1.62]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.14, 24), cap);
      c.position.y = y;
      vat.add(c);
    }
    set.add(vat);
  });
  const PER = 9;
  const bubbleGeo = new THREE.BufferGeometry();
  const bubblePos = new Float32Array(vats.length * PER * 3);
  bubbleGeo.setAttribute('position', new THREE.BufferAttribute(bubblePos, 3));
  const seeds = Array.from({ length: vats.length * PER }, () => [Math.random(), Math.random() * 0.24 - 0.12, Math.random() * 0.24 - 0.12, 0.08 + Math.random() * 0.12]);
  const bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({ color: 0xd8fff0, size: 0.022, transparent: true, opacity: 0.7, depthWrite: false }));
  set.add(bubbles);

  // Pillars at the edge of the dark, each with a lit strip.
  const strip = new THREE.MeshStandardMaterial({ color: 0x0, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0.7 });
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12 + 0.26;
    const p = new THREE.Group();
    p.position.set(Math.sin(a) * 3.9, FLOOR, Math.cos(a) * 3.9);
    p.lookAt(0, FLOOR, 0);
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.4, 0.3), metal(0x0c1412));
    col.position.y = 1.7;
    p.add(col);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.035, 2.8, 0.01), strip);
    s.position.set(0, 1.6, 0.156);
    p.add(s);
    set.add(p);
  }
  // A ring of light hanging over the arena.
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.02, 8, 96), new THREE.MeshStandardMaterial({ color: 0x0, emissive: new THREE.Color(0xd8fff0), emissiveIntensity: 0.9 }));
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 2.1;
  set.add(halo);

  return {
    set,
    update: (t) => {
      for (let i = 0; i < seeds.length; i++) {
        const [ph, dx, dz, sp] = seeds[i];
        const v = vats[Math.floor(i / PER)];
        bubblePos[i * 3] = v.x + dx * 0.6;
        bubblePos[i * 3 + 1] = FLOOR + 0.2 + ((ph + t * sp) % 1) * 1.2;
        bubblePos[i * 3 + 2] = v.z + dz * 0.6;
      }
      bubbleGeo.attributes.position.needsUpdate = true;
    },
  };
}

/** Motes drifting up through the light. */
function dust(): { points: THREE.Points; update: (t: number) => void } {
  const N = 140;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const seeds = Array.from({ length: N }, () => [Math.random() * Math.PI * 2, Math.sqrt(Math.random()) * 2.3, Math.random(), 0.02 + Math.random() * 0.04]);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbff5e2, size: 0.014, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  return {
    points,
    update: (t) => {
      for (let i = 0; i < N; i++) {
        const [a, r, ph, sp] = seeds[i];
        const aa = a + t * 0.03;
        pos[i * 3] = Math.cos(aa) * r;
        pos[i * 3 + 1] = FLOOR + ((ph + t * sp) % 1) * 2.4;
        pos[i * 3 + 2] = Math.sin(aa) * r;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ---------- The stage ----------

export class ArenaStage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);
  /** The Broadcast camera at rest: what the plate layout is built from. */
  private layoutCam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);
  readonly actors: Record<Side, SpecimenActor>;
  private pedestals: Record<Side, Pedestal>;
  private lab: Lab;
  private dust: ReturnType<typeof dust>;
  private w = 1;
  private h = 1;
  private boxes: Partial<Record<Side, Box>> = {};
  /** Where the Specimens stand (x), and the Broadcast camera's distance and height, from the layout. */
  private lx = -0.6;
  private rx = 0.6;
  private dist = 3;
  /** The Broadcast camera's field of view (degrees): narrower when the layout wants it further back than MAX_DIST. */
  private lens = FOV;
  private camY = 0;
  private view: CamView = 'broadcast';
  private cinematic = true;
  private cues: Cue[] = [];
  private shake = 0;
  private camPos = v3();
  private camTarget = v3();
  private placed = false;
  /** How far each Specimen is turned toward the other (radians; the right one mirrors it). */
  private yaw: Record<Side, number> = { left: YAW.show, right: YAW.show };
  /** The turn each one rests at in Broadcast (the plates are laid out for it): squared up in a stance. */
  private restYaw: Record<Side, number> = { left: YAW.show, right: YAW.show };
  /** Until when (scene ms) a clash is being fought: they square up to each other. */
  private fightUntil = -1;
  private linesShown: boolean | null = null;
  private reduced = prefersReducedMotion();
  private running = false;
  private raf = 0;
  private clock = new THREE.Clock();
  /** The scene clock (ms): it stands still during a hit-stop, like the rest of the board. */
  private time = 0;
  /** Told when the layout's anchors change (the creatures loaded, the page resized). */
  onLayout: () => void = () => undefined;
  /** Told when the plates' leader lines should show (the Broadcast camera is at rest) or hide. */
  onLines: (show: boolean) => void = () => undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = makeRenderer(canvas, this.scene, false);
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.FogExp2(BG, 0.15);
    this.scene.add(new THREE.HemisphereLight(0xbfefff, 0x0c1412, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1.2, 2, 2.4);
    this.scene.add(key);
    const top = new THREE.SpotLight(0xd8fff0, 9, 6, 0.75, 0.7, 2);
    top.position.set(0, 2.4, 0.5);
    top.target.position.set(0, FLOOR, 0);
    this.scene.add(top, top.target);

    this.lab = lab();
    this.scene.add(this.lab.set);
    this.dust = dust();
    this.scene.add(this.dust.points);
    this.pedestals = { left: pedestal(), right: pedestal() };
    this.actors = { left: new SpecimenActor(), right: new SpecimenActor() };
    for (const side of ['left', 'right'] as const) {
      this.scene.add(this.pedestals[side].group);
      const a = this.actors[side];
      a.onWake = () => this.wake();
      a.whenReady(() => this.onLayout());
      this.scene.add(a.root);
    }
    this.place();
    void this.loadArt();
  }

  /** The optional arena art (see the top of this file). */
  private async loadArt() {
    const glb = Object.values(ARENA_GLB)[0];
    if (glb) {
      try {
        const g = await loadGltf(await glb());
        const obj = g.scene.clone();
        obj.userData.shared = true;
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(v3());
        const k = ARENA_SIZE / Math.max(size.x, size.z, 0.001);
        obj.scale.setScalar(k);
        obj.position.set(-((box.min.x + box.max.x) / 2) * k, 0, -((box.min.z + box.max.z) / 2) * k);
        obj.updateMatrixWorld(true);
        // The Specimens stand on its floor: the surface at its open middle (its base and rim may sit lower).
        obj.position.y = FLOOR - (centreFloor(obj, 0.12 * Math.max(size.x, size.z) * k) ?? box.min.y * k);
        // Toned down to the lab's darkness: bright chrome would glare and swallow the dark Specimens.
        obj.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (!m || !('envMapIntensity' in m)) return;
          m.envMapIntensity = 0.35;
          m.color.multiplyScalar(ARENA_SHADE);
        });
        this.scene.remove(this.lab.set);
        this.scene.add(obj);
        this.wake();
      } catch {
        /* keep the built-in lab */
      }
    }
    const sky = Object.values(ARENA_SKY)[0];
    if (sky) {
      try {
        const tex = await new THREE.TextureLoader().loadAsync(await sky());
        tex.colorSpace = THREE.SRGBColorSpace;
        // Wrapped SKY_WRAP times around the arena and squeezed into the middle band of the sky to match, so what's in
        // it looks SKY_WRAP times smaller (further off). The image's edges meet seamlessly, so it can repeat.
        tex.wrapS = THREE.RepeatWrapping;
        tex.repeat.set(-SKY_WRAP, SKY_WRAP); // negative: seen from inside the dome, it would be mirrored
        tex.offset.set(SKY_TURN, (1 - SKY_WRAP) / 2);
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(30, 64, 32),
          new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false, color: new THREE.Color(0.7, 0.7, 0.7) }),
        );
        dome.renderOrder = -1;
        this.scene.add(dome);
        this.scene.background = new THREE.Color(0x000000);
        // Lighter haze: the backdrop now gives the depth, and thick fog would ring the arena in black against it.
        this.scene.fog = new THREE.FogExp2(BG, 0.06);
        this.wake();
      } catch {
        /* keep the plain dark */
      }
    }
  }

  // ---------- Layout ----------

  setSize(w: number, h: number) {
    if (!w || !h) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    for (const c of [this.camera, this.layoutCam]) {
      c.aspect = w / h;
      c.updateProjectionMatrix();
    }
    this.relayout();
  }

  /** Where the two Specimens' boxes are on the canvas (pixels). */
  setBoxes(boxes: Partial<Record<Side, Box>>) {
    this.boxes = boxes;
    this.relayout();
  }

  /** How far back a camera must be to fit a half-width and half-height (world units) in view. */
  private fit(hw: number, hh: number) {
    return Math.max(hh / TAN, hw / (TAN * (this.w / this.h)));
  }

  private relayout() {
    const { left: L, right: R } = this.boxes;
    if (L && R && L.h > 0 && R.h > 0) {
      // Each Specimen (1 unit tall) fills its box, standing where the box is.
      const boxH = (L.h + R.h) / 2;
      this.dist = this.h / (FILL * boxH * 2 * TAN);
      const upp = (2 * this.dist * TAN) / this.h;
      this.lx = (L.x + L.w / 2 - this.w / 2) * upp;
      this.rx = (R.x + R.w / 2 - this.w / 2) * upp;
      this.camY = ((L.y + L.h / 2 + R.y + R.h / 2) / 2 - this.h / 2) * upp;
    } else {
      this.lx = -0.6;
      this.rx = 0.6;
      this.dist = this.fit(1.25, 0.6);
      this.camY = 0;
    }
    // Too far back would put the camera outside the arena, behind its rim: come in, and zoom to match.
    const reach = this.dist * TAN;
    this.dist = Math.min(this.dist, MAX_DIST);
    this.lens = THREE.MathUtils.radToDeg(2 * Math.atan(reach / this.dist));
    this.layoutCam.fov = this.lens;
    this.layoutCam.updateProjectionMatrix();
    this.layoutCam.position.set(0, this.camY, this.dist);
    this.layoutCam.lookAt(0, this.camY, 0);
    this.layoutCam.updateMatrixWorld();
    this.place();
    this.onLayout();
    this.render();
  }

  private place() {
    this.actors.left.root.position.set(this.lx, 0, 0);
    this.actors.right.root.position.set(this.rx, 0, 0);
    this.pedestals.left.group.position.x = this.lx;
    this.pedestals.right.group.position.x = this.rx;
    this.actors.left.root.rotation.y = this.yaw.left;
    this.actors.right.root.rotation.y = -this.yaw.right;
  }

  /** Each socket's spot on the canvas (pixels) in the Broadcast view, for the plates. */
  anchors(side: Side): Anchors {
    const a = this.actors[side];
    const out: Anchors = {};
    if (!a.ready) return out;
    // Measured with the Specimens turned as they are in Broadcast, whatever the camera is doing now.
    const was = a.root.rotation.y;
    a.root.rotation.y = side === 'left' ? this.restYaw.left : -this.restYaw.right;
    a.root.updateMatrixWorld(true);
    const v = v3();
    for (const slot of Object.keys(a.model.sockets) as SlotId[]) {
      a.socketWorld(slot, v).project(this.layoutCam);
      out[slot] = { x: (v.x * 0.5 + 0.5) * this.w, y: (1 - (v.y * 0.5 + 0.5)) * this.h };
    }
    a.root.rotation.y = was;
    a.root.updateMatrixWorld(true);
    return out;
  }

  // ---------- The match ----------

  setActor(side: Side, s: StageState) {
    const a = this.actors[side];
    const wasWon = a.state?.won;
    a.setState(s);
    // In a stance (and not staggering under rejection Strain) it squares up to its opponent; the plates follow.
    const rest = s.stance && !s.rejecting ? YAW.stance : YAW.show;
    if (rest !== this.restYaw[side]) {
      this.restYaw[side] = rest;
      this.onLayout();
    }
    this.pedestals[side].ring.emissive.set(s.color);
    this.pedestals[side].pool.color.set(s.color);
    if (s.won && wasWon === false) this.cue('finale', side);
  }

  fire(side: Side, e: StageEvent) {
    this.actors[side].fire(e);
    if (e.kind === 'evolve') this.cue('evolve', side);
  }

  setView(v: CamView) {
    this.view = v;
    this.wake();
  }

  setCinematic(on: boolean) {
    this.cinematic = on;
    if (!on) this.cues = [];
  }

  /** A clash: both lunge; the camera pushes in and shakes, then finds whoever took a big hit. */
  clash(c: ArenaCue) {
    // Who attacks (a side that holds stays put), and how hard each was hit.
    const swings = (side: Side) => !c.hits.some((h) => h.hold && h.side !== side);
    const taken = (side: Side) => Math.max(0, ...c.hits.filter((h) => h.side === side && !h.hold).map((h) => h.dmg));
    const L = swings('left');
    const R = swings('right');
    if (!L && !R) return;
    // They rush to meet: halfway each, or all the way to one that holds.
    const room = Math.max(0, this.rx - this.lx - CONTACT);
    const reach = { left: L ? (R ? room / 2 : room) : 0, right: R ? (L ? room / 2 : room) : 0 };
    for (const side of ['left', 'right'] as const) {
      const t = taken(side);
      this.actors[side].clash({ dir: side === 'left' ? 1 : -1, reach: reach[side], swing: side === 'left' ? L : R, knock: t > 0 ? Math.min(0.34, 0.07 + t * 0.026) : 0 });
    }
    this.fightUntil = this.time + 1300;
    const top = Math.max(0, ...c.hits.map((h) => h.dmg));
    setTimeout(() => (this.shake = Math.max(this.shake, Math.min(1, 0.25 + top / 10))), 300);
    const big = c.hits.filter((h) => h.big).sort((a, b) => b.dmg - a.dmg)[0];
    // The camera pushes in on where they meet.
    const meet = (this.lx + reach.left + this.rx - reach.right) / 2;
    this.cue('clash', big?.side ?? null, meet);
  }

  private cue(kind: Cue['kind'], side: Side | null, meet?: number) {
    if (!this.cinematic || this.reduced) return;
    const center = () => v3(meet ?? (this.lx + this.rx) / 2, 0.02, 0);
    const actorAt = (s: Side) => this.actors[s].centerWorld(v3());
    /** A camera around a Specimen: `turn` radians from straight in front of it (positive: toward the middle).
     * Close shots stay on its outer side: squared up, "in front" of it is where its opponent stands. */
    const around = (s: Side, turn: number, dist: number, y: number) => {
      const t = actorAt(s);
      const a = this.actors[s].root.rotation.y + (s === 'left' ? turn : -turn);
      return { target: t, pos: t.clone().add(v3(Math.sin(a) * dist, y, Math.cos(a) * dist)) };
    };
    let cue: Cue;
    if (kind === 'clash') {
      const spread = this.rx - this.lx;
      cue = {
        kind,
        t0: this.time,
        dur: side ? 1750 : 1250,
        shot: (_k, ms) => {
          // The one who took the big hit, close up, nearly face on.
          if (side && ms > 560) return around(side, -0.45, 1.7, 0.06);
          const t = center();
          return { target: t, pos: t.clone().add(v3(0, -0.06, this.fit(spread / 2 + 0.3, 0.42))) };
        },
      };
    } else if (kind === 'evolve' && side) {
      cue = {
        kind,
        t0: this.time,
        dur: 1900,
        // Sweeps across its front, close enough to fill the frame.
        shot: (k) => around(side, -1.25 + 0.7 * easeInOut(k), 2.5, 0.12),
      };
    } else if (kind === 'finale' && side) {
      cue = {
        kind,
        t0: this.time,
        dur: 4600,
        // A slow arc round its face, dropping low: the winner towers over the arena.
        shot: (k) => around(side, -1.35 + 1.0 * easeInOut(k), 2.6, 0.3 - 0.45 * k),
      };
    } else return;
    // A clash cuts in at once; an evolution or the finale waits for the clash shot to finish.
    const cur = this.cues[0];
    if (cur && cur.kind === 'clash' && kind !== 'clash') {
      cue.t0 = Math.max(cue.t0, cur.t0 + cur.dur);
      this.cues = [cur, cue];
    } else this.cues = [cue];
    this.wake();
  }

  // ---------- The camera ----------

  /** Where the camera wants to be right now. */
  private shot(): { shot: Shot; cue: boolean } {
    const cue = this.cues[0];
    if (cue && this.time >= cue.t0) {
      const ms = this.time - cue.t0;
      return { shot: cue.shot(Math.min(1, ms / cue.dur), ms), cue: true };
    }
    const mid = (this.lx + this.rx) / 2;
    const spread = this.rx - this.lx;
    const t = this.time / 1000;
    const S = (target: THREE.Vector3, dir: THREE.Vector3, d: number): Shot => ({ target, pos: target.clone().addScaledVector(dir.normalize(), d) });
    switch (this.view) {
      case 'ringside':
        return { shot: S(v3(mid, 0.06, 0), v3(0.38, -0.2, 1), this.fit(spread / 2 + 0.45, 0.58) * 0.92), cue: false };
      case 'overhead':
        return { shot: S(v3(mid, -0.3, 0.05), v3(0, 1.35, 1), this.fit(spread / 2 + 0.6, 0.8)), cue: false };
      case 'shoulder': {
        const me = this.actors.left.centerWorld(v3());
        const foe = this.actors.right.centerWorld(v3());
        // From behind your Specimen's shoulder (it frames the left edge), looking at the opponent.
        return { shot: { target: me.clone().lerp(foe, 0.6), pos: me.clone().add(v3(-0.75, 0.25, 0.95)) }, cue: false };
      }
      case 'orbit': {
        const a = t * 0.12;
        const d = this.fit(spread / 2 + 0.5, 0.62);
        return { shot: { target: v3(mid, 0, 0), pos: v3(mid + Math.sin(a) * d, 0.18 + 0.12 * Math.sin(t * 0.07), Math.cos(a) * d) }, cue: false };
      }
      default:
        return { shot: { target: v3(0, this.camY, 0), pos: v3(0, this.camY, this.dist), fov: this.lens }, cue: false };
    }
  }

  private moveCamera(dt: number) {
    while (this.cues.length && this.time >= this.cues[0].t0 + this.cues[0].dur) this.cues.shift();
    const { shot, cue } = this.shot();
    // The Specimens square up to each other away from Broadcast.
    const fighting = this.time < this.fightUntil;
    const calm = !cue && (this.view === 'broadcast' || this.view === 'overhead');
    for (const side of ['left', 'right'] as const) {
      const want = fighting ? YAW.fight : calm ? this.restYaw[side] : Math.max(YAW.duel, this.restYaw[side]);
      this.yaw[side] += (want - this.yaw[side]) * (1 - Math.exp(-dt * (fighting ? 12 : 3)));
    }
    this.place();
    const fov = shot.fov ?? FOV;
    if (!this.placed) {
      this.camPos.copy(shot.pos);
      this.camTarget.copy(shot.target);
      this.camera.fov = fov;
      this.placed = true;
    } else {
      const k = 1 - Math.exp(-dt * (cue ? 6 : 3.2));
      this.camPos.lerp(shot.pos, k);
      this.camTarget.lerp(shot.target, k);
      this.camera.fov += (fov - this.camera.fov) * k;
    }
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.camPos);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.shake > 0 && !this.reduced) {
      const s = this.shake * this.shake * 0.03;
      this.camera.position.add(v3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0));
    }
    this.camera.lookAt(this.camTarget);
    // The plates' lines show only when Broadcast is at rest (the plates were laid out for it).
    const rest = !cue && !fighting && this.view === 'broadcast' && this.camPos.distanceTo(shot.pos) < 0.02 && Math.abs(this.camera.fov - fov) < 0.05 && Math.abs(this.yaw.left - this.restYaw.left) < 0.01 && Math.abs(this.yaw.right - this.restYaw.right) < 0.01;
    if (rest !== this.linesShown) {
      this.linesShown = rest;
      this.onLines(rest);
    }
  }

  // ---------- The loop ----------

  /** Run (on screen) or rest (off screen, tab hidden). */
  setRunning(on: boolean) {
    if (on === this.running) return;
    this.running = on;
    if (on) {
      this.clock.getDelta();
      this.loop();
    } else cancelAnimationFrame(this.raf);
  }

  private wake() {
    if (!this.running) this.render();
  }

  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = Math.min(0.05, this.clock.getDelta());
    if (document.body.classList.contains('hitstop')) dt = 0;
    this.time += dt * 1000;
    const t = this.time / 1000;
    this.moveCamera(dt);
    this.actors.left.update(this.time, dt);
    this.actors.right.update(this.time, dt);
    if (!this.reduced) {
      this.lab.update(t);
      this.dust.update(t);
    }
    this.render();
  };

  private render() {
    if (!this.placed) this.moveCamera(0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.setRunning(false);
    this.actors.left.dispose();
    this.actors.right.dispose();
    for (const side of ['left', 'right'] as const) this.scene.remove(this.actors[side].root);
    disposeTree(this.scene);
    (this.scene.environment as THREE.Texture | null)?.dispose();
    this.renderer.dispose();
  }
}
