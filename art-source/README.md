# Art sources

How the game's 3D art was made, so it can be remade or extended.

## The Specimen (`src/assets/models/specimen.glb`)

1. **Image.** `specimen-cutout.png` is the creature painting (`src/assets/specimen.jpg`) cut out onto a clear
   background (rembg, `isnet-general-use`).
2. **3D model.** The cutout went through TRELLIS.2 (MIT licence). The result is a single textured mesh, about
   96k triangles, in an A-pose and facing forward.
3. **Rig.** The model was reduced to about 48k triangles, scaled to 1.8 m with its feet on the ground, and uploaded
   to Mixamo as an OBJ in a ZIP. Settings: auto-rigger, **No Fingers (25 bones)**. Downloads, all FBX Binary:
   - the character: With Skin, T-pose;
   - six animations: Without Skin, 30 fps.

   | Clip in the game | Mixamo animation | Plays when |
   |---|---|---|
   | `idle` | Breathing Idle | always (quicker as Strain climbs) |
   | `attack` | Mutant Swiping | a clash (both Specimens swing) |
   | `hit` | Hit Reaction | it loses HP |
   | `die` | Dying Backwards | the knockout |
   | `victory` | Mutant Roaring | it wins |
   | `evolve` | Sword And Shield Power Up | it evolves |

   The raw Mixamo files are kept **outside** this repository (Mixamo's terms allow using them in a game, not
   sharing the files themselves).
4. **Game model.** The Mixamo files were merged into one GLB:
   - smooth normals recomputed, and the original colour and metal/roughness textures put back;
   - scaled to 1 unit tall, centred, facing +Z;
   - each clip starts facing forward over the rest spot with its feet on the floor, and keeps its own travel
     (Dying Backwards falls a body length back);
   - compressed: about 29k triangles, 1024 px WebP textures, meshopt, keyframes resampled (about 830 KB).
5. **Sockets.** The graft sockets in `src/ui/three/models.ts` are points on the rest pose, each riding a bone.
   The attack's blow lands 1.3 s into its clip (`attackStrike`).

In a clash the game moves the Specimens itself (they dash in, trade blows, get knocked back and hop home), so clips
don't need to travel. To add or swap an animation, download it from Mixamo the same way (Without Skin, FBX Binary)
and rebuild the GLB with the same steps. The game plays whichever of the six clip names the model has.

## Graft parts (`src/assets/models/grafts/<card id>.glb`)

`graft-prompts.md` has an image prompt for each graft card. Each image goes through TRELLIS.2, and the model is
saved under the card's id. Until a card has one, it gets a placeholder part made in code (`src/ui/three/grafts.ts`).

## The arena (optional)

Two files can go in `src/assets/models/`:
- `arena.glb` replaces the built-in lab;
- `arena-sky.jpg` (or .webp or .png) is a 360° panorama behind it.

See the top of `src/ui/three/arena.ts`.
