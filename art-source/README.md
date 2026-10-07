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
   | `idle` | Breathing Idle | the default idle, before a stance is picked (quicker as Strain climbs) |
   | `attack` | Mutant Swiping | a clash (both Specimens swing) |
   | `hit` | Hit Reaction | it loses HP |
   | `die` | Dying Backwards | the knockout |
   | `victory` | Mutant Roaring | it wins |
   | `evolve` | Sword And Shield Power Up | it evolves |
   | `aggress` | Idle | its idle in the Aggress stance |
   | `adapt` | Ninja Idle | its idle in the Adapt stance |
   | `fortify` | Sword And Shield Block Idle | its idle in the Fortify stance |
   | `strained` | Drunk Idle Variation | its idle once Strain reaches the rejection zone (11+), whatever the stance |
   | `block` | Block | a clash where it holds (guard up as the blow lands) |

   The raw Mixamo files are kept **outside** this repository (Mixamo's terms allow using them in a game, not
   sharing the files themselves).
4. **Game model.** The Mixamo files were merged into one GLB:
   - smooth normals recomputed, and the original colour and metal/roughness textures put back;
   - scaled to 1 unit tall, centred, facing +Z;
   - each clip starts over the rest spot with its feet on the floor and its head looking forward (fighting
     stances stay side-on, as Mixamo made them), and keeps its own travel (Dying Backwards falls a body length back);
   - compressed: about 29k triangles, 1024 px WebP textures, meshopt, keyframes resampled (about 900 KB).
5. **Sockets.** The graft sockets in `src/ui/three/models.ts` are points on the rest pose, each riding a bone.
   The attack's blow lands 1.3 s into its clip (`attackStrike`); the block's guard is up 0.95 s in (`blockUp`).

In a clash the game moves the Specimens itself (they dash in, trade blows, get knocked back and hop home), so clips
don't need to travel. To add or swap an animation, download it from Mixamo the same way (Without Skin, FBX Binary)
and rebuild the GLB with the same steps. The game plays whichever of these clip names the model has.

## Graft parts (`src/assets/models/grafts/<card id>.glb`)

Grafts are made **on the Specimen**, so each one is shaped to this body.
1. **Generate:** an image of the Specimen wearing the graft (an image edit of the creature art), then through
   TRELLIS.2.
2. **Cut out:** the graft is cut from the dressed Specimen by colour (bone, red, orange and other bright or warm
   colours against the dark body), keeping its big pieces.
3. **Align:** the dressed body under each piece (the neck, or each forearm) is matched to the same part of the
   game's Specimen at rest, and the piece moves with it. For a Limb card there's one bracer per arm, each shaped to
   its own arm.
4. **Fit:** points that still clip are pushed just outside the skin, and each point takes the bone weights of the
   body under it. The graft is then skinned to the Specimen's own skeleton and bends with it in every animation.
5. **Compress:** about 6,000 triangles per piece, colours baked into the points, meshopt (about 90–110 KB).

The tools for steps 2–4 are kept outside the repository. A model without fitting data (an ordinary standalone
model) still works: it's placed rigidly on its socket. Until a card has a model, it gets a placeholder part made
in code (`src/ui/three/grafts.ts`).

Done so far (fitted): `pred_bone_spur`, `pred_twitch_nerve`.

## The arena

Made from the prompts in `arena-prompts.md`. Both files are in `src/assets/models/`; without them the game
falls back to a built-in lab made in code.

- `arena.glb`: the TRELLIS.2 model, cut from 375k to about 143k triangles with 1536 px WebP textures (about
  2.8 MB). The game scales it to 7 units across, darkens it, and stands the Specimens on the floor at its middle.
- `arena-sky.jpg`: the panorama ("Teal Biomech Containment Vault"). Its left and right edges were blended into
  each other so it can repeat. The game wraps it three times around a dome over the arena, which makes its tanks a
  third of the size (further off), turned so a tank stands behind the arena in the default view.

The prompts for both are in `arena-prompts.md`. See the top of `src/ui/three/arena.ts` for how they're placed.
