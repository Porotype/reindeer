# Share page (site)

A static page for showing the reindeer to other people: `index.html`, `style.css` and `app.js`, no build step.

- **Pose:** Original (the logo pose: turn 19°, tilt 15°), Straight (neutral), Manual (turn, tilt, roll, jaw sliders) and Follow pointer.
- **View:** drag to rotate, scroll to zoom, double-click to return to the logo view; logo colours, brand ramp or plain shading; the original artwork as an overlay; ASCII rendering.
- **Print the current pose:** writes a binary STL of the pose shown, Z up, scaled to the chosen height in millimetres. It is the five skinned parts as they are, not the fused and checked solid that `scripts/export.py` writes.
- **Download:** links to `exports/reindeer-normalized.stl`, `exports/reindeer-straight-normalized.stl`, `exports/reindeer.glb` and `model/reindeer.blend`.

The page reads `../exports/reindeer.glb` and `../reference/Reindeer.png` by relative path, so it is served from the repository root, with the page at `/site/`. The root `index.html` redirects there and `.nojekyll` stops GitHub Pages from filtering files.

```sh
node web/server.mjs     # then open http://localhost:8317/site/
```

To publish on GitHub Pages: repository Settings, Pages, "Deploy from a branch", branch `main`, folder `/ (root)`. Any static host that serves the repository root works the same way.

Three.js 0.170.0 (MIT, licence in `vendor/LICENSE`) is vendored in `site/vendor/`: `three.module.js`, `loaders/GLTFLoader.js` and `utils/BufferGeometryUtils.js`, unmodified from the npm package. The import map in `index.html` points at them, so the page makes no external requests.

`app.js` shares its colour bake, artwork fit and ASCII renderer with `web/index.html`. The jaw thresholds and the pose constants follow the model; check them after a model change, as described in `web/README.md`.
