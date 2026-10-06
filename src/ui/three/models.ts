import type { SlotId } from '../../engine';
import specimenUrl from '../../assets/models/specimen.glb?url';

// The 3D models and where grafts attach to them.
//
// A Specimen model is a GLB about 1 unit tall, centred on the origin, facing +Z. Each graft slot is a socket: a
// point on the body and the direction pointing out of it. These were found on the model's surface (the top of the
// helmet, the front of the neck, the middle of the chest, the outside of each forearm blade), in the model's rest
// pose. The model is rigged (Mixamo), so each socket also names the bone it rides on: the graft follows that bone.
//
// Its animations are named clips (see Clip). The model was built from the Mixamo files in art-source/README.md.
//
// Per-card graft models go in src/assets/models/grafts/<card id>.glb, built to one convention: the point that
// touches the body at the origin, pointing out along +Y, about 0.08 units across. A card without one gets a
// placeholder part made in code for its slot (see grafts.ts).

export interface Socket {
  /** Where on the body (model units). */
  at: [number, number, number];
  /** The direction out of the body there. */
  out: [number, number, number];
  /** Rigged models: the bone this socket rides on (it then follows the animation). */
  bone?: string;
}

/** The animations a rigged model may have (clip names in the GLB). Any it lacks are simply not played.
 * idle: the default idle (no stance). aggress/adapt/fortify: the idle in that stance. strained: the idle in the
 * rejection zone, whatever the stance. block: a clash where it holds instead of attacking. */
export type Clip = 'idle' | 'attack' | 'hit' | 'die' | 'victory' | 'evolve' | 'aggress' | 'adapt' | 'fortify' | 'strained' | 'block';

export interface SpecimenModel {
  url: string;
  sockets: Record<SlotId, Socket>;
  /** Seconds into the attack clip where the blow lands (it's played so the blow meets the clash's impact). */
  attackStrike?: number;
  /** Seconds into the block clip where the guard is up (likewise). */
  blockUp?: number;
}

export const SPECIMEN: SpecimenModel = {
  url: specimenUrl,
  sockets: {
    head: { at: [0, 0.471, 0.02], out: [0.05, 1, -0.1], bone: 'mixamorigHead' },
    // The front of the neck (a collar): the back of the neck would hide behind the head from the camera.
    nerve: { at: [0, 0.335, 0.055], out: [0, 0.25, 1], bone: 'mixamorigNeck' },
    organ: { at: [0, 0.235, 0.094], out: [0, -0.1, 1], bone: 'mixamorigSpine2' },
    // Facing +Z, the creature's right arm is on -X.
    limbA: { at: [-0.23, 0.14, 0.04], out: [-1, -0.15, 0], bone: 'mixamorigRightForeArm' },
    limbB: { at: [0.165, 0.15, -0.01], out: [1, 0.2, 0.1], bone: 'mixamorigLeftForeArm' },
    // A sixth slot some modes use: the lower torso.
    organB: { at: [0, 0.06, 0.07], out: [0, 0, 1], bone: 'mixamorigSpine' },
  },
  attackStrike: 1.3,
  blockUp: 0.95,
};

/** Card graft models that exist (src/assets/models/grafts/<card id>.glb), loaded only when that card is on a body. */
const GRAFT_FILES = import.meta.glob('../../assets/models/grafts/*.glb', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;
export function graftModelLoader(cardId: string): (() => Promise<string>) | null {
  return GRAFT_FILES[`../../assets/models/grafts/${cardId}.glb`] ?? null;
}
