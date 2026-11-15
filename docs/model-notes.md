# Current modeling state

The source is V19. The head/neck mesh has 60 vertices and 108 polygons, including planar crown, forehead, eye, nasal ridge, muzzle side, nose pad and broad rear cheek surfaces. The five mesh objects stay separate in the master so the rig and shapes remain editable. Exporting creates a joined printable derivative.

Local coordinates: X is width, Z is up, and the muzzle points toward negative Y. The artwork pose uses a 9-degree head turn relative to the chest; camera framing is independent. The internal `.L` antler is on negative X (the animal's right), with four upper tips. The opposite antler has three. Their upper forks are deliberately asymmetric. The branches have square sections and capped ends.

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

## Web motion lab

`web/` runs the exported GLB in the browser (see `web/README.md`). Jaw and ear motion are runtime morph targets there, not part of the master. A silhouette fit against `Reindeer.png` suggests that `Camera.Logo` framing needs about 1.088× scale and a small offset to match the artwork. In V19 the head and antlers follow the artwork in this view; the neck is about 10% narrower at the back than drawn. The jaw morph thresholds were retuned for the V19 muzzle.

## Remaining decisions

- Review V19 away from the logo view: muzzle width from the front, the flatter skull in side view, ear size, and the neck's rear width.
- Continue fitting the logo view so the static artwork can transition into a moving 3D character.
- Choose physical print height/process/material, then validate antler thickness, slicing and a test print.
- Choose the final web animation range and integration behavior. The exported head-turn clip is a review animation.

The supplied AI/Fusion STL is a volume reference, not the reconstructed surface topology. The original illustration has a simulated 3D appearance, so a single physical model cannot necessarily reproduce every drawn facet exactly.
