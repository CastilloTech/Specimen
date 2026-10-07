import * as THREE from 'three';
import type { SlotId } from '../../engine';
import { SpecimenActor } from './actor';
import type { Anchors, StageEvent, StageState } from './actor';
import { makeRenderer } from './core';
import type { SpecimenModel } from './models';

export type { Anchors, GraftView, StageEvent, StageState } from './actor';
export { preloadSpecimen, webglOk } from './core';

// One Specimen on its own canvas (the menu, Lineage, replays): the creature against a clear background, framed
// whole or close up. It reports where each socket is on screen, for the graft plates.

export class SpecimenStage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
  private actor: SpecimenActor;
  private running = false;
  private raf = 0;
  private clock = new THREE.Clock();
  private time = 0;
  /** Turntable: radians a second it turns by itself (0: still), and how far it's been turned. */
  private spin = 0;
  private turn = 0;
  private baseYaw = 0;

  constructor(canvas: HTMLCanvasElement, opts: { yaw?: number; model?: SpecimenModel; zoom?: number } = {}) {
    this.canvas = canvas;
    this.renderer = makeRenderer(canvas, this.scene, true);
    this.scene.add(new THREE.HemisphereLight(0xbfefff, 0x0c1412, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.2, 2, 2.4);
    this.scene.add(key);
    // Zoomed in (the menu's portrait), the camera frames the upper body; otherwise the whole creature.
    const zoom = opts.zoom ?? 1;
    const focus = zoom > 1 ? 0.2 : 0;
    this.camera.position.set(0, focus + 0.04, 2.45 / zoom);
    this.camera.lookAt(0, focus, 0);
    this.actor = new SpecimenActor({ model: opts.model });
    this.baseYaw = opts.yaw ?? 0;
    this.actor.root.rotation.y = this.baseYaw;
    this.actor.onWake = () => this.wake();
    this.scene.add(this.actor.root);
  }

  /** Called once the creature is on screen (anchors are then meaningful). */
  whenReady(fn: () => void) {
    this.actor.whenReady(fn);
  }

  setSize(w: number, h: number) {
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** Where each socket is on the canvas (percent), for the graft plates. */
  anchors(): Anchors {
    const out: Anchors = {};
    this.scene.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    for (const slot of Object.keys(this.actor.model.sockets) as SlotId[]) {
      this.actor.socketWorld(slot, v).project(this.camera);
      out[slot] = { x: (v.x * 0.5 + 0.5) * 100, y: (1 - (v.y * 0.5 + 0.5)) * 100 };
    }
    return out;
  }

  /** Let it turn by itself (radians a second; 0 stops it). */
  setSpin(speed: number) {
    this.spin = speed;
  }

  /** Turn it by hand (a drag), by this many radians. */
  turnBy(rad: number) {
    this.turn += rad;
    this.actor.root.rotation.y = this.baseYaw + this.turn;
    this.wake();
  }

  setState(s: StageState) {
    this.actor.setState(s);
  }

  fire(e: StageEvent) {
    this.actor.fire(e);
  }

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
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt * 1000;
    if (this.spin) {
      this.turn += this.spin * dt;
      this.actor.root.rotation.y = this.baseYaw + this.turn;
    }
    this.actor.update(this.time, dt);
    this.render();
  };

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.setRunning(false);
    this.actor.dispose();
    this.renderer.dispose();
  }
}
