# Working on this model

- Read `README.md`, `docs/model-notes.md`, and `project.json` before editing.
- `model/reindeer.blend` is the authoring source. Preserve the current design before experimenting; use Git for tracked history and `work/` for local trials.
- The head and antlers are fitted to the logo through `Camera.Logo` (see `docs/model-notes.md`). Preserve that fit, the pose it was solved at (`head_yaw_deg` 19, `head_pitch_deg` 15), and the slender muzzle; check any head change in the logo view against `reference/Reindeer.svg` and from the front and side. Broad facets must be genuinely planar, with flat shading.
- Keep head turn and tilt adjustable relative to the neck/chest; the rest pose is neutral (level, straight ahead) and must stay mirror-symmetric apart from the antlers. Ears and asymmetrical antlers follow the head. Fit camera angle independently.
- Antlers must remain solid and connected in the printable derivative. Each forks at the crown corner with no stem. Do not replace the asymmetric branch arrangement with mirroring.
- Preserve the narrowed/tapered neck front and the broad rear cheek planes.
- Physical print size is undecided. Never treat the unitless STL as a final millimetre-sized print.
- After a model change, run the export command in `README.md`, inspect relevant views and update the current preview/notes. Commit one current set of exports, not every intermediate version.
- Web experiments live in `web/` and are documented in `web/README.md`; the public share page lives in `site/` (`site/README.md`). Both read `exports/reindeer.glb` and never modify the master. The colour bake, artwork fit and ASCII renderer in `site/app.js` are copies of the lab's; change them together.
- Keep scripts portable: resolve paths from the repository, use Blender's bundled Python, and do not require MCP for export. Do not commit machine-specific paths or local scratch files.
