# Arena art prompts

Two optional files replace the built-in lab. Either one works on its own. Both go in `src/assets/models/`.

## 1. The arena set: `arena.glb`

Generate the image, cut it out, and run it through TRELLIS.2 with the same settings as the Specimen. Save the model
as `arena.glb`.

```
A circular sci-fi containment-lab fighting arena as a single 3D game asset: a wide, thin, flat circular floor plate tiled with dark hexagonal metal panels joined by thin glowing teal seams, a glowing teal ring along its outer edge; along the back half of the rim only, a curved row of six tall glass specimen tanks filled with glowing green and teal fluid, linked by dark metal pipes and thick cables; the front half of the floor completely open and empty; no creatures, no people. Isolated object, three-quarter view from slightly above, centered, the whole object in frame, plain pure white background, soft even studio lighting, sharp clean details, dark gunmetal and biomechanical materials with teal glowing accents.
```

Why it's worded this way:
- **Thin, flat floor plate.** The game stands the Specimens on the model's lowest point. A thick raised base would
  sink them into the floor.
- **Tanks on the back half only.** The default camera looks in from the front, so anything on the front edge would
  block the fight.
- **Front half empty.** That's where the pedestals and the fight go.

## 2. The backdrop: `arena-sky.jpg`

Generate this at a 2:1 size: 2048 × 1024 if the generator allows it, otherwise its largest 2:1 size. Save it as
`arena-sky.jpg`.

```
Seamless 360-degree equirectangular panorama: the inside of a vast dark underground bio-research containment facility, rows of tall glowing glass specimen tanks holding shadowy creature silhouettes, metal catwalks, pipes and hanging cables, distant teal and faint purple lights glowing through thin haze, a high dark ceiling with a few hanging lamps, the lower part of the image dark and empty, moody cinematic lighting, low contrast, mostly dark so it sits behind the action, no people, no text, the left and right edges match seamlessly.
```

Why it's worded this way:
- **Equirectangular, 2:1.** This is the format the game wraps around the arena.
- **Mostly dark and low contrast.** The Specimens are dark metal, so a bright backdrop would swallow them.
- **Edges that match.** The image's left and right edges meet behind one side of the arena, where the Orbit and
  Overhead views can see them.
