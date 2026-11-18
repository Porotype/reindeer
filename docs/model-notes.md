# Current modeling state

The source is V21. The head/neck mesh has 60 vertices and 108 polygons, including planar crown, forehead, eye, nasal ridge, muzzle side, nose pad and broad rear cheek surfaces. The five mesh objects stay separate in the master so the rig and shapes remain editable. Exporting creates a joined printable derivative.

Local coordinates: X is width, Z is up, and the muzzle points toward negative Y. The rest (neutral) pose is level and straight ahead. The artwork pose is a 19-degree head turn and a 15-degree upward tilt relative to the chest (`head_yaw_deg`, `head_pitch_deg` on `Reindeer.Rig`); camera framing is independent. The internal `.L` antler is on negative X (the animal's right), with four upper tips. The opposite antler has three. Their upper forks are deliberately asymmetric. The branches have square sections and capped ends.

## V19: head and antlers fitted to the logo

V18 matched the artwork at the crown and neck, but in the `Camera.Logo` view its muzzle pointed lower and was about 25% longer than drawn, the nose was a slim wedge, the jaw line sat low, and each antler rose on a stem before forking.

V19 solves the head landmarks from `reference/Reindeer.svg` as seen by `Camera.Logo` (42 SVG units per model unit, image centre at 143.5, 250). Mirrored pairs that are visible on both sides fix their half-width from the image separation; near-only points keep a chosen half-width or are placed on a panel plane. Only vertex positions changed: topology, indices, weights and the neck are as in V18.

- The nasal ridge is shorter and more level, and ends in a broad planar nose pad (five vertices, three triangles) with a distinct chin below it.
- The muzzle side (eye corner, nose top, lower nose corner, mouth corner, jaw corner) is one plane, as in the artwork. This is why the muzzle widens toward the mouth.
- The nose top half-width is 0.42. The artwork implies about 0.555; it was moderated for the front view. This is the main judgement call.
- The jaw corner, throat row and nape corner moved up to the artwork's positions. The rear cheek quad stays planar; the jaw corner half-width became 1.01.
- A few facet materials were reassigned so the bright ridge strip and the muzzle side read as drawn.
- The ears only moved back 0.15 to stay seated. The artwork's ears are larger, and its far ear cannot be reproduced.

Antlers were rebuilt from the V07 paths with the stem removed. The main beam and brow tine fork from one node buried under each crown corner, so the fork is the contact with the head, as in the artwork. Path nodes moved in the image plane to the artwork and kept their previous camera depth. The far antler's drawn base is close to where the mirrored seat projects. `work/refine_v19.py` (local) holds the landmark table and the path targets.

## V20: larger head turn, longer and slimmer muzzle

Turned freely, the V19 muzzle read short and wide. The logo shows the head from one angle only, so the real muzzle length follows from the assumed head turn: the further the head is turned toward the viewer, the more the muzzle is foreshortened and the longer it must be to draw the same outline. V20 raises `head_yaw_deg` from 9 to 19 and re-solves the V19 landmark and antler fit at that turn, with the chosen muzzle half-widths scaled by 0.88.

- The muzzle (ridge top to nose pad) is 2.29 instead of 2.03, about 13% longer; the nose top half-width is 0.37 instead of 0.42.
- The outline through `Camera.Logo` is the same as V19. Panels remain planar and the print mesh is one closed component.
- Turn and width are independent dials in `work/refine_v20.py` (local; runs on the V18 master).

## V21: tilt in the rig, neutral pose straight

Until V20 only the turn was a rig property; the upward tilt of the logo pose was part of the head shape. V21 adds `head_pitch_deg` (driver on the Head bone's X rotation, positive is up) and counter-rotates the rest meshes about the Head bone by 15 degrees, per vertex with its Head weight. Neutral (yaw 0, pitch 0) is level and straight; yaw 19, pitch 15 reproduces V20 to within 0.02 units, and only in the blended upper neck.

- The 15 degrees is a judgement: in V20 the mouth line was level and the crown flat, which reads as chin-up. Neutral now has the mouth line 15 degrees down and the nose bridge about 28.
- The export writes two printable unions: `reindeer-normalized.stl` in the logo pose and `reindeer-straight-normalized.stl` in the neutral pose. Both are checked the same way.
- Tried and rejected (V22 trial, `work/refine_v22.py`): reading the ridge down the artwork's neck as the front of a chest facing the viewer, with a 71-degree head turn. A symmetric chest loses the artwork's neck outline (the left edge bulges low, the right edge higher, as a neck seen from the side does), and the neutral pose wrings the throat join.

## Web motion lab

`web/` runs the exported GLB in the browser (see `web/README.md`). Jaw and ear motion are runtime morph targets there, not part of the master. A silhouette fit against `Reindeer.png` suggests that `Camera.Logo` framing needs about 1.088× scale and a small offset to match the artwork. In V19 the head and antlers follow the artwork in this view; the neck is about 10% narrower at the back than drawn. The jaw morph thresholds follow the V21 bind pose, and the lab sets the artwork pose (19° yaw, 15° tilt) on the Head bone.

## Remaining decisions

- Review V21 away from the logo view: muzzle length and width, the flatter skull in side view, ear size, and the neck's rear width.
- Continue fitting the logo view so the static artwork can transition into a moving 3D character.
- Choose physical print height/process/material, then validate antler thickness, slicing and a test print.
- Choose the final web animation range and integration behavior. The exported head-turn clip is a review animation.

The supplied AI/Fusion STL is a volume reference, not the reconstructed surface topology. The original illustration has a simulated 3D appearance, so a single physical model cannot necessarily reproduce every drawn facet exactly.
