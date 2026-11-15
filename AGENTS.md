# Working on this model

- Read `README.md`, `docs/model-notes.md`, and `project.json` before editing.
- `model/reindeer.blend` is the authoring source. Preserve the current design before experimenting; use Git for tracked history and `work/` for local trials.
- The V19 head and antlers are fitted to the logo through `Camera.Logo` (see `docs/model-notes.md`). Preserve that fit and the level, streamlined muzzle; check any head change in the logo view against `reference/Reindeer.svg` and from the front and side. Broad facets must be genuinely planar, with flat shading.
- Keep head turn adjustable relative to the neck/chest. Ears and asymmetrical antlers follow the head. Fit camera angle independently.
- Antlers must remain solid and connected in the printable derivative. Each forks at the crown corner with no stem. Do not replace the asymmetric branch arrangement with mirroring.
- Preserve the narrowed/tapered neck front and the broad rear cheek planes.
- Physical print size is undecided. Never treat the unitless STL as a final millimetre-sized print.
- After a model change, run the export command in `README.md`, inspect relevant views and update the current preview/notes. Commit one current set of exports, not every intermediate version.
- Web experiments live in `web/` and are documented in `web/README.md`; they read `exports/reindeer.glb` and never modify the master.
- Keep scripts portable: resolve paths from the repository, use Blender's bundled Python, and do not require MCP for export. Do not commit machine-specific paths or local scratch files.
