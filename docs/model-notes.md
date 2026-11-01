# Current modeling state

The source is V18. The head/neck mesh has 60 vertices and 108 polygons, including planar central forehead, eye, nasal ridge and broad rear cheek surfaces. The five mesh objects stay separate in the master so the rig and shapes remain editable. Exporting creates a joined printable derivative.

Local coordinates: X is width, Z is up, and the muzzle points toward negative Y. The artwork pose uses a 9-degree head turn relative to the chest; camera framing is independent. The internal `.L` antler is on negative X (the animal's right), with four upper tips. The opposite antler has three. Their lower sweeps are similar; their upper forks are deliberately asymmetric. The branches have square sections and capped ends.

## Latest eye and crown adjustment

The last two widening trials also broadened the crown. V18 follows the red-to-green corner movement in `reference/annotations/eye-corner.png`: the rear eye corner moves down, forward and inward; the eye quad banks farther onto the side. Its front outer corner follows to preserve a planar quad. The central forehead and nasal ridge stay fixed.

The rear crown follows `reference/annotations/rear-crown.png`. Its width is about 31% less than V17, increasing the inward taper while retaining the small flat crown. The nape, lower head, muzzle, neck, ears and antlers retain their coordinates. Only six mirrored vertex positions changed in V18. The broad rear cheek quads remain planar and avoid the earlier sharp side ridge.

Named surface polygon indices are in the head object's `panel_faces` custom property. The `landmark_remap` property maps the earlier semantic landmark numbers to current vertex indices. The rig has `Chest` and `Head` bones, with the adjustable yaw driving the head; upper face facets retain planarity through the review animation.

## Remaining decisions

- Visually review the latest eye/crown adjustment against the supplied sketches and original logo.
- Continue fitting the logo view so the static artwork can transition into a moving 3D character.
- Choose physical print height/process/material, then validate antler thickness, slicing and a test print.
- Choose the final web animation range and integration behavior. The exported head-turn clip is a review animation.

The supplied AI/Fusion STL is a volume reference, not the reconstructed surface topology. The original illustration has a simulated 3D appearance, so a single physical model cannot necessarily reproduce every drawn facet exactly.
