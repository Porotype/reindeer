# Reindeer motion lab (web)

Browser experiments with the V18 model: logo-matched shading with a hover turn, head-only gaze, voice-driven talking and a live ASCII rendering. It's a single dependency-free page that uses Three.js 0.170.0 from jsDelivr through an import map.

| File | Purpose |
| --- | --- |
| `index.html` | The whole lab: markup, styles and one module script |
| `server.mjs` | Local server (Node 18+, no packages). Serves `web/`, `exports/`, `reference/` and mints OpenAI Realtime ephemeral keys |
| `build-artifact.mjs` | Inlines `exports/reindeer.glb` and `reference/Reindeer.png` into one self-contained HTML file (default `build/reindeer-motion-lab.html`, ignored by Git) |

```sh
node web/server.mjs                       # http://localhost:8317/ (synthetic voice, file, microphone)
OPENAI_API_KEY=sk-... node web/server.mjs # also enables "Talk to the reindeer"
node web/build-artifact.mjs [out.html]    # self-contained page; no mic or WebRTC in sandboxed hosts
```

Optional environment variables are `PORT`, `OPENAI_REALTIME_MODEL` (default `gpt-realtime`) and `OPENAI_REALTIME_VOICE` (default `marin`). The persona prompt is `INSTRUCTIONS` in `server.mjs`.

Status (2026-11-01): the shading, turn, gaze, jaw, ear motion and ASCII rendering have been checked in headless Chrome. The OpenAI Realtime path (`/v1/realtime/client_secrets` followed by an SDP POST to `/v1/realtime/calls`) follows the GA API but has **not been run against the API yet**. Accepted settings: voice as shipped (jaw 55% ≈ 5.5°, nods 45%, visual lead 60 ms, **throat glow 30%**).

## Model facts the code relies on

From `exports/reindeer.glb`, the only runtime asset besides `reference/Reindeer.png`:

- glTF space: Y up, muzzle toward **+Z**, X is width. Units are normalized design units.
- Five skinned meshes on one skin with two joints. **Chest** sits at the neck base and is never moved. **Head** is at (0, 4.798, −0.05) relative to the chest, near the jaw hinge. Ears and antlers are 100% Head. Neck vertices between y 3.6 and 4.6 are blended 10–33% to Chest, so rotating Head bends the upper neck softly.
- The artwork pose is a **9° head yaw** (`BASE_YAW`). The GLB's review animation is ignored, and the pose is set directly on the Head bone.
- GLTFLoader sanitizes node names (`Camera.Logo` becomes `CameraLogo`). Look them up through `THREE.PropertyBinding.sanitizeNodeName`, as `byName()` does.
- `Camera.Logo` is orthographic with half-height 5.95, matched to the 287×500 artwork.

## Pipeline (in `index.html`, in order)

1. **Load.** Parse the GLB and the reference PNG, and copy `Camera.Logo`'s world transform into the live orthographic camera.
2. **Prepare meshes.** Convert to non-indexed geometry so every triangle owns its vertices (needed for per-facet colours) and keep the original GLB material for the comparison mode.
3. **Morph targets, added at load and kept out of the master.**
   - *Jaw:* head vertices with z > 1.5 and y < 4.76 (chin row, weight 1), y < 4.85 (weight 0.75), and the front throat row (weight 0.2) rotate about an X axis through (0, 5.0, 0.7). Full influence is 10° (`JAW_MAX`).
   - *Ear perk:* each ear rotates 14° about an axis through its base, chosen so the tip lifts. Negative influence droops the ear, which is used for flicks.
   - Morphs are applied before skinning, so they follow the head.
4. **Fit to the artwork** (`fitToArtwork`). Render a white silhouette, then match its area and centroid to the artwork's non-black pixels over three iterations. The result is a 2D frame (`frame2d`: scale ≈ 1.088, small offset) used by the camera and the overlay. The 3D camera angle is left alone.
5. **Bake colours** (`bake`).
   - Union coplanar neighbouring triangles into facet groups.
   - For each camera-facing group, project seven barycentric samples per triangle into `Reindeer.png`, snap each sample to the nearest of the 13 SVG fills, and take the area-weighted vote.
   - Fit `lum ≈ a + v·n` by least squares over the matched groups to recover the artwork's implied light.
   - Groups hidden at rest get a colour from the brand ramp. Each vertex stores `color` (linear), `restLight` (`a + v·n` at rest) and `glowMask` (head facets with 3.4 < y < 4.95 and z > 0.2, the throat and lower jaw).
6. **Material** (`facetMaterial`). `MeshBasicMaterial` patched with `onBeforeCompile`, so skinning and morphs keep working. The fragment shader takes the facet normal from screen-space derivatives (always flat).
   - Mode 0: `baked × (a + v·n) / restLight`. This reproduces the logo exactly at rest and relights believably as the model turns.
   - Mode 1: steps the same lighting through the 5-colour brand ramp.
   - `uGlow × glowMask` is added for the throat glow.
7. **Frame loop** (`frame`). Springs, then the head pose, then morph influences, then render. Rendering goes either straight to the canvas or through `renderAscii`.

## Behaviours and their parameters

- **Turn (tab 01).** Rotates the whole `Reindeer.Rig` about Y with an underdamped spring (k 38, ζ 0.62). The modes are face the viewer (default 48°), follow the pointer, and a 360° spin on enter.
- **Gaze (tab 02, and in 03 while "Keep following the pointer" is on).**
  - The pointer ray from the orthographic camera is moved `depth` units toward the viewer from the head pivot. That direction, in chest space, gives yaw and pitch.
  - Limits are yaw −30…65° (absolute, including the 9° base) and pitch −25…18°, then scaled by intensity.
  - "Glance and hold" only retargets when the target moves more than 6°, and uses a fast critically damped spring (k 75). "Smooth" uses k 22.
  - Roll is −0.12 × yaw.
  - After 3.5 s without pointer movement, the head returns to rest with random small glances. Idle life also adds ear flicks every 3–9 s and a ±0.35° bob.
- **Voice (tab 03).**
  - Every frame, `AnalyserNode` time-domain RMS is converted to dB and mapped from −52…−16 dB to 0…1.
  - The envelope follower uses 25 ms attack and 90 ms release, and a slow envelope uses 0.6 s.
  - Jaw = env^0.8 × slider, through a stiff spring (k 520).
  - An onset (env − slow > 0.16, at least 220 ms apart) kicks the nod spring and retargets a small yaw sway.
  - While speaking, the head lifts about 2.2° and the ears perk to 0.45. While the user is speaking (mic level or `input_audio_buffer.speech_started`), it lifts 1.5° and the ears perk to 0.6.
  - Glow = env × slider × 0.35.
  - The visual lead is a `DelayNode` on the audible path only, so analysis runs ahead of what you hear.
- **ASCII (checkbox in 03, works on every tab).**
  - Renders the normal shaded scene into a small target (2×2 samples per cell) and computes coverage plus perceptual luminance per cell, with eased auto-levels.
  - **Vaadin brand** set (default), read from the brand-site examples `reindeer-art-example2` and `reindeer-layout-example1`:
    - Glyphs ` :-=>+%a` on square, widely tracked cells (pitch 1.55 × font size).
    - Uneven tone thresholds (`VAADIN_LEVELS`) give `a` the bright half and `=`/`>` the mid-tones.
    - Each run of `a` starts with a prefix from `VAADIN_PREFIXES` (V, AV, Ad, Vn, A$…), or spells `Vaadin` when the run is at least 7 cells (30% of such runs).
    - About 3.5% of mid-tone cells get a stray `v d n i`.
    - Choices are hashed from row and column, so they don't flicker while still.
  - Other sets pack glyphs densely: `ramp` ` .:-=+*#%@`, `binary` ` .:01`, `code` ` .:;=+<>{}#`.
  - With "facet edges" on (off by default; brand examples don't use it), a luminance-gradient threshold (0.09) swaps in `- | / \` along facet and silhouette edges.
  - Colour: **sampled** (default) is a 4-stop ramp measured from the brand examples, `#0E3B61 → #0E70B5 → #11A5E2 → #11C5E4`. Letter prefixes sit one step brighter. The alternative is the brand gradient `#056ff0 → #03f7ff`.
  - The font is JetBrains Mono, standing in for the brand mono face NB International Mono.
  - The brand's own Vascii generator (linked as `github.com/vaadin/vascii`) was not accessible, so this matches its output by eye, not its algorithm.

## OpenAI Realtime wiring

1. The browser POSTs to `/api/realtime/session`. The server calls `POST https://api.openai.com/v1/realtime/client_secrets` with `{session: {type: "realtime", model, instructions, audio: {output: {voice}}}}` and relays the response (`value` = ephemeral key).
2. The browser creates an `RTCPeerConnection`, adds the mic track, and creates the `oai-events` data channel. It then POSTs the SDP offer to `https://api.openai.com/v1/realtime/calls` with `Authorization: Bearer <ephemeral key>` and `Content-Type: application/sdp`.
3. The remote track is attached to a **muted** `<audio>` element (Chrome only feeds remote WebRTC audio to WebAudio while an element consumes it). The same stream goes into WebAudio (analyser for motion, delay to speakers for sound).
4. Data-channel events used: `input_audio_buffer.speech_started` / `speech_stopped` for the listening pose. `output_audio_buffer.*`, `response.done` and `error` are logged. OpenAI sends no visemes, so all mouth motion comes from audio.

## Integrating into another app

Everything is in one module script, so lift it section by section. The `// ---------- … ----------` comments mark the sections.

- **Required:** loading, mesh preparation and morphs, `fitToArtwork` (only if you need exact logo framing; otherwise use `Camera.Logo` as is), `bake` with `solve4` and `facetMaterial`, `Spring`, and the head-pose composition in `frame`.
- **Voice:** `audio()`, `useSource()`, `analyse()` and the jaw/nod/lift/ear/glow lines in `frame`. Feed it any `AudioNode` or `MediaStream`. For a framework app, wrap these in an object with `attachStream(stream)`, `setGaze(ndcX, ndcY)`, `setMode(...)` and `dispose()`.
- **UI-only parts you can drop:** tabs, sliders and the HUD. Defaults are in the HTML `value` attributes, and `val(id)` reads them, so replace those calls with constants.
- **Keys:** keep `OPENAI_API_KEY` on a server and only hand out ephemeral keys, as `server.mjs` does.
- **Assets:** use `exports/reindeer.glb` (about 80 KB) and `reference/Reindeer.png` (only for baking colours). The bake could be precomputed into the GLB as vertex colours later, so the PNG and the fit wouldn't ship.

If the model changes, re-export the GLB with the command in the root README. The lab re-bakes and re-fits at load. Check the jaw weights (`jawWeight`) and `JAW_PIVOT` if the muzzle vertices move.
