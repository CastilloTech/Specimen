import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SPECIMEN } from './models';

// What every 3D view shares: loading models (once for the whole page), setting up a renderer, and tweens.

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const loads = new Map<string, Promise<GLTF>>();
export const loadGltf = (url: string) => {
  let p = loads.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    loads.set(url, p);
    p.catch(() => loads.delete(url));
  }
  return p;
};
/** Start fetching the Specimen early (it's cached for the match). */
export const preloadSpecimen = () => loadGltf(SPECIMEN.url).catch(() => undefined);

/** Whether this device can draw 3D at all. */
export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** A renderer with the game's look (filmic tone, a soft studio reflection so the metal reads). */
export function makeRenderer(canvas: HTMLCanvasElement, scene: THREE.Scene, alpha: boolean) {
  const r = new THREE.WebGLRenderer({ canvas, alpha, antialias: true, powerPreference: 'low-power' });
  r.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return r;
}

export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface Tween {
  t0: number;
  dur: number;
  step: (k: number) => void;
  done?: () => void;
}
export const ease = (k: number) => 1 - (1 - k) ** 3;
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
export const back = (k: number) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2;

/** Runs tweens against a clock (milliseconds). Returns whether any are still running. */
export function runTweens(list: Tween[], now: number): boolean {
  for (const tw of [...list]) {
    const k = Math.min(1, Math.max(0, (now - tw.t0) / tw.dur));
    tw.step(k);
    if (k >= 1) {
      list.splice(list.indexOf(tw), 1);
      tw.done?.();
    }
  }
  return list.length > 0;
}

/** Frees the geometry, materials and textures made for an object. Anything loaded from a model file is marked
 * `userData.shared` and skipped: its meshes and textures belong to the page-wide cache. */
export function disposeTree(o: THREE.Object3D) {
  if (o.userData.shared) return;
  const m = o as THREE.Mesh;
  if (m.isMesh || (o as THREE.Points).isPoints) {
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat) continue;
      (mat as THREE.MeshStandardMaterial).map?.dispose();
      (mat as THREE.MeshStandardMaterial).emissiveMap?.dispose();
      (mat as THREE.MeshStandardMaterial).alphaMap?.dispose();
      mat.dispose();
    }
  }
  for (const c of o.children) disposeTree(c);
}
