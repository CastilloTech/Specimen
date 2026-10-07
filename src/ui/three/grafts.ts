import * as THREE from 'three';
import type { SlotId } from '../../engine';

// Placeholder graft parts, made in code until a card has its own model: one shape family per slot, varied per
// card (seeded by its id, so a card always looks the same) and coloured by its faction. Each part is built pointing
// out along +Y from the origin (the point that touches the body), the same convention as card graft models.

export interface Part {
  group: THREE.Group;
  /** Materials that glow: an ability firing, poison or damage light these up. */
  glow: THREE.MeshStandardMaterial[];
  /** A fitted graft (skinned to the body's skeleton): moving its group does nothing, so it fades in and out. */
  fitted?: boolean;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** A small seeded random source, so each card's part is always built the same way. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function shell(color: THREE.Color) {
  return new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.35), metalness: 0.55, roughness: 0.38 });
}
function glowMat(color: THREE.Color, strength = 0.9) {
  return new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.5), emissive: color, emissiveIntensity: strength, metalness: 0.2, roughness: 0.4 });
}

/** A crest of curved fins along the top of the helmet. */
function head(r: () => number, c: THREE.Color): Part {
  const g = new THREE.Group();
  const s = shell(c);
  const glow = glowMat(c, 0.7);
  const fins = 2 + Math.floor(r() * 3);
  for (let i = 0; i < fins; i++) {
    const h = 0.05 + r() * 0.04;
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.012, h, 4), i % 2 ? glow : s);
    fin.scale.set(0.35, 1, 1);
    fin.position.set(0, h / 2, -0.02 + i * (0.04 / fins));
    fin.rotation.x = -0.5 - i * 0.12;
    g.add(fin);
  }
  return { group: g, glow: [glow] };
}

/** A chain of glowing nodes down the back of the neck, on a cable. */
function nerve(r: () => number, c: THREE.Color): Part {
  const g = new THREE.Group();
  const glow = glowMat(c, 1.1);
  const n = 3 + Math.floor(r() * 3);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.012 * n + 0.01, 6), shell(c));
  cable.rotation.x = Math.PI / 2;
  cable.position.set(0, 0.008, (0.012 * n) / 2 - 0.012);
  g.add(cable);
  for (let i = 0; i < n; i++) {
    const node = new THREE.Mesh(new THREE.IcosahedronGeometry(0.008 + r() * 0.005, 0), glow);
    node.position.set((r() - 0.5) * 0.008, 0.012, i * 0.012 - 0.012);
    g.add(node);
  }
  return { group: g, glow: [glow] };
}

/** A caged core in the chest that pulses. */
function organ(r: () => number, c: THREE.Color): Part {
  const g = new THREE.Group();
  const glow = glowMat(c, 1.2);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.022 + r() * 0.008, 1), glow);
  core.position.y = 0.012;
  g.add(core);
  const rings = 1 + Math.floor(r() * 2);
  for (let i = 0; i < rings; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03 + i * 0.006, 0.0035, 6, 18), shell(c));
    ring.position.y = 0.012;
    ring.rotation.set(Math.PI / 2 + (r() - 0.5) * 0.8, r() * Math.PI, 0);
    g.add(ring);
  }
  return { group: g, glow: [glow] };
}

/** A blade swept out from a band around the forearm. */
function limb(r: () => number, c: THREE.Color): Part {
  const g = new THREE.Group();
  const s = shell(c);
  const glow = glowMat(c, 0.8);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 16), s);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const len = 0.07 + r() * 0.05;
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.014, len, 4), glow);
  blade.scale.set(0.3, 1, 1);
  blade.position.y = len / 2 + 0.008;
  blade.rotation.z = (r() - 0.5) * 0.4;
  g.add(blade);
  if (r() > 0.5) {
    const spur = new THREE.Mesh(new THREE.ConeGeometry(0.008, len * 0.5, 4), s);
    spur.position.set(0.012, len * 0.25, 0);
    spur.rotation.z = -0.6;
    g.add(spur);
  }
  return { group: g, glow: [glow] };
}

const MAKERS: Record<SlotId, (r: () => number, c: THREE.Color) => Part> = { head, nerve, organ, organB: organ, limbA: limb, limbB: limb };

/** The placeholder part for a card on a slot. */
export function placeholderPart(slot: SlotId, cardId: string, color: string): Part {
  return MAKERS[slot](rng(hash(cardId)), new THREE.Color(color));
}

/** A face-down (dormant) graft: a dark cocoon, the same for every card so it gives nothing away. */
export function cocoon(): Part {
  const g = new THREE.Group();
  const glow = new THREE.MeshStandardMaterial({ color: 0x1f2a26, roughness: 0.85, metalness: 0.1, emissive: new THREE.Color(0x3a5a50), emissiveIntensity: 0.15 });
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 10), glow);
  m.scale.set(1, 1.35, 1);
  m.position.y = 0.03;
  g.add(m);
  return { group: g, glow: [glow] };
}

/** A dead socket (necrosis): a dull purple scar on the body. */
export function scar(): Part {
  const g = new THREE.Group();
  const glow = new THREE.MeshStandardMaterial({ color: 0x2a0f2e, emissive: new THREE.Color(0xa21caf), emissiveIntensity: 0.6, roughness: 0.6 });
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.03, 14), glow);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  g.add(m);
  return { group: g, glow: [glow] };
}
