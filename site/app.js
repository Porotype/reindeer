// Vaadin Reindeer in 3D: a static page around exports/reindeer.glb.
// Pose presets, pointer following, free rotation, ASCII rendering, and STL export of the current pose.
// The colour bake, artwork fit and ASCII renderer are the motion lab's (web/index.html); keep them in step.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEG = Math.PI / 180;
const ASSETS = { glb: '../exports/reindeer.glb', png: '../reference/Reindeer.png' };
// The 13 fills used in reference/Reindeer.svg.
const SVG_FILLS = ['127CAB', '24AAE1', '10B7E8', '149BCF', '2CA5D6', '27A4D7', '269ECC', '2198C6', '17A3D9', '15ACD9', '14AAD5', '1395C7', '10A5D1'];
const RAMP_FILLS = ['127CAB', '1395C7', '149BCF', '24AAE1', '10B7E8'];
// Poses are head turn and upward tilt relative to the chest, in degrees (head_yaw_deg / head_pitch_deg in the master).
const ORIGINAL = { turn: 19, tilt: 15 }, STRAIGHT = { turn: 0, tilt: 0 };
const LOGO_YMAG = 5.95; // Camera.Logo orthographic half-height
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const ref = $('ref');
ref.src = ASSETS.png;

// ---------- loading ----------
async function loadGLB() {
  const buffer = await (await fetch(ASSETS.glb)).arrayBuffer();
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
}
function loadImage(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}
const hexToSrgb = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const linOf = (h) => hexToSrgb(h).map(toLinear);
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true });
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
const camBack = new THREE.Vector3();

let gltf, refImg;
try {
  [gltf, refImg] = await Promise.all([loadGLB(), loadImage(ASSETS.png)]);
} catch (err) {
  $('loading').textContent = 'The model could not be loaded. This page has to be served over http(s), next to the repository\'s exports/ and reference/ folders.';
  throw err;
}
scene.add(gltf.scene);
gltf.scene.updateMatrixWorld(true);
const byName = (name) => gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
const logoCamNode = byName('Camera.Logo');
logoCamNode.getWorldPosition(cam.position);
logoCamNode.getWorldQuaternion(cam.quaternion);
cam.updateMatrixWorld(true);
camBack.set(0, 0, 1).applyQuaternion(cam.quaternion);

const rig = byName('Reindeer.Rig');
const headBone = byName('Head');
const chestBone = byName('Chest');
// The GLB's bind pose is neutral. Turn is about the chest's vertical; tilt is about the head's own side axis (negative X raises the muzzle).
const setHead = (turn, tilt, roll) => headBone.quaternion.setFromEuler(new THREE.Euler(-tilt * DEG, turn * DEG, roll * DEG, 'YXZ'));
setHead(ORIGINAL.turn, ORIGINAL.tilt, 0); // the colour bake below needs the logo pose

// Lighting for the plain shading only.
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.copy(cam.position).add(new THREE.Vector3(-6, 8, 4));
scene.add(key);

// ---------- shared shading uniforms ----------
const U = {
  uA: { value: 0.3 }, uV: { value: new THREE.Vector3(0, 0.3, 0) }, uFloor: { value: 0.08 },
  uMode: { value: 0 }, uCamDir: { value: camBack },
  uPal: { value: RAMP_FILLS.map((h) => new THREE.Vector3(...linOf(h))) },
  uLmin: { value: 0 }, uLmax: { value: 1 },
  uGlow: { value: 0 }, uGlowColor: { value: new THREE.Vector3(...linOf('7FE3FF')) },
};
function facetMaterial() {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
attribute float restLight; attribute float glowMask;
varying vec3 vWP; varying float vRestL; varying float vGlowM;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vRestL = restLight; vGlowM = glowMask;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uA; uniform vec3 uV; uniform float uFloor; uniform int uMode; uniform vec3 uCamDir;
uniform vec3 uPal[5]; uniform float uLmin; uniform float uLmax; uniform float uGlow; uniform vec3 uGlowColor;
varying vec3 vWP; varying float vRestL; varying float vGlowM;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 fn = normalize(cross(dFdx(vWP), dFdy(vWP)));
if (dot(fn, uCamDir) < 0.0) fn = -fn;
float L = max(uA + dot(uV, fn), uFloor);
vec3 col;
if (uMode == 0) {
  col = diffuseColor.rgb * clamp(L / vRestL, 0.5, 1.8);
} else {
  float t = clamp((L - uLmin) / (uLmax - uLmin), 0.0, 0.999);
  col = uPal[int(floor(t * 5.0))];
}
col += uGlowColor * uGlow * vGlowM;
diffuseColor.rgb = col;`);
  };
  return m;
}

// ---------- mesh preparation: non-indexed facets, morphs, baked colours ----------
const parts = [];
gltf.scene.traverse((o) => {
  if (!o.isSkinnedMesh) return;
  let n = o, kind = null;
  while (n && !kind) { kind = /HeadNeck/.test(n.name) ? 'head' : /Ear/.test(n.name) ? 'ear' : /Antler/.test(n.name) ? 'antler' : null; n = n.parent; }
  o.geometry = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
  o.frustumCulled = false;
  o.userData.glbMaterial = o.material;
  o.material.flatShading = true;
  parts.push({ mesh: o, kind });
});

const v = new THREE.Vector3(), q = new THREE.Quaternion();
// Jaw hinge: rotate the chin rows about an X axis behind the mouth corner (bind space; muzzle is +Z, up is +Y).
const JAW_PIVOT = new THREE.Vector3(0, 5.12, 0.93), JAW_MAX = 10 * DEG;
const jawWeight = (p) => {
  if (p.z > 2.5 && p.y < 4.78) return 1;                 // chin corners, mouth front, chin underside
  if (p.z > 1.8 && p.y < 4.78) return 0.75;              // jaw underside
  if (p.z > 0.1 && p.z < 1 && p.y > 4.6 && p.y < 4.78) return 0.2;  // front throat row
  return 0;
};
for (const part of parts) {
  const g = part.mesh.geometry, pos = g.attributes.position;
  const disp = new Float32Array(pos.count * 3);
  if (part.kind === 'head') {
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const w = jawWeight(v);
      if (!w) continue;
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), JAW_MAX * w);
      const r = v.clone().sub(JAW_PIVOT).applyQuaternion(q).add(JAW_PIVOT).sub(v);
      disp.set([r.x, r.y, r.z], i * 3);
    }
  } else if (part.kind === 'ear') {
    // Perk: rotate about an axis through the ear base that lifts the tip.
    const pts = []; for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
    const byInner = [...pts].sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
    const pivot = byInner.slice(0, 4).reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(0.25);
    const tip = pts.reduce((best, p) => (p.distanceTo(pivot) > best.distanceTo(pivot) ? p : best), pts[0]);
    const axis = tip.clone().sub(pivot).cross(new THREE.Vector3(0, 1, 0)).normalize();
    q.setFromAxisAngle(axis, 14 * DEG);
    pts.forEach((p, i) => { const r = p.clone().sub(pivot).applyQuaternion(q).add(pivot).sub(p); disp.set([r.x, r.y, r.z], i * 3); });
    part.side = Math.sign(tip.x);
  }
  if (part.kind !== 'antler') {
    g.morphAttributes.position = [new THREE.BufferAttribute(disp, 3)];
    g.morphTargetsRelative = true;
    part.mesh.updateMorphTargets();
  }
}

// Bake: project each planar facet group through the logo camera and vote on its fill colour.
function bake() {
  const bakeCam = cam.clone();
  const ar = refImg.width / refImg.height;
  bakeCam.top = frame2d.cy + frame2d.ymag; bakeCam.bottom = frame2d.cy - frame2d.ymag;
  bakeCam.left = frame2d.cx - frame2d.ymag * ar; bakeCam.right = frame2d.cx + frame2d.ymag * ar;
  bakeCam.updateProjectionMatrix(); bakeCam.updateMatrixWorld(true);
  const cv = document.createElement('canvas'); cv.width = refImg.width; cv.height = refImg.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(refImg, 0, 0);
  const px = cx.getImageData(0, 0, cv.width, cv.height).data;
  const fills = SVG_FILLS.map((h) => ({ h, s: hexToSrgb(h), l: linOf(h) }));
  const snap = (x, y) => {
    const ix = Math.min(cv.width - 1, Math.max(0, Math.round(x))), iy = Math.min(cv.height - 1, Math.max(0, Math.round(y)));
    const o = (iy * cv.width + ix) * 4, c = [px[o], px[o + 1], px[o + 2]];
    let best = null, bd = 30 * 30;
    for (const f of fills) { const d = (f.s[0] - c[0]) ** 2 + (f.s[1] - c[1]) ** 2 + (f.s[2] - c[2]) ** 2; if (d < bd) { bd = d; best = f; } }
    return best;
  };
  const BARY = [[1/3, 1/3, 1/3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6], [.45, .45, .1], [.45, .1, .45], [.1, .45, .45]];
  const groups = [];
  for (const part of parts) {
    const m = part.mesh, g = m.geometry, pos = g.attributes.position, nTri = pos.count / 3;
    const world = [], tris = [];
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); world.push(v.clone().applyMatrix4(m.matrixWorld)); }
    for (let t = 0; t < nTri; t++) {
      const [a, b, c] = [world[3 * t], world[3 * t + 1], world[3 * t + 2]];
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      const area = n.length() / 2; n.normalize();
      tris.push({ a, b, c, n, area, parent: t });
    }
    // Union coplanar neighbours so a quad (or larger planar panel) gets one colour.
    const find = (t) => (tris[t].parent === t ? t : (tris[t].parent = find(tris[t].parent)));
    const key = (i) => { v.fromBufferAttribute(pos, i); return `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`; };
    const edges = new Map();
    for (let t = 0; t < nTri; t++) for (let e = 0; e < 3; e++) {
      const k1 = key(3 * t + e), k2 = key(3 * t + (e + 1) % 3), k = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
      const other = edges.get(k);
      if (other === undefined) edges.set(k, t);
      else if (tris[t].n.dot(tris[other].n) > 0.999) tris[find(t)].parent = find(other);
    }
    const byRoot = new Map();
    for (let t = 0; t < nTri; t++) { const r = find(t); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(t); }
    for (const list of byRoot.values()) {
      const n = tris[list[0]].n, votes = new Map();
      let area = 0;
      for (const t of list) area += tris[t].area;
      if (n.dot(camBack) > 0.03) {
        for (const t of list) {
          const { a, b, c } = tris[t];
          for (const [wa, wb, wc] of BARY) {
            const p = a.clone().multiplyScalar(wa).addScaledVector(b, wb).addScaledVector(c, wc).project(bakeCam);
            const f = snap((p.x + 1) / 2 * cv.width, (1 - p.y) / 2 * cv.height);
            if (f) votes.set(f, (votes.get(f) || 0) + tris[t].area);
          }
        }
      }
      let fill = null, best = 0;
      for (const [f, w] of votes) if (w > best) { best = w; fill = f; }
      groups.push({ part, list, n, area, fill, facing: n.dot(camBack) });
    }
  }
  // Fit the artwork's implied light: lum ≈ a + v·n, weighted by visible area.
  const M = Array.from({ length: 4 }, () => [0, 0, 0, 0]), B = [0, 0, 0, 0];
  for (const gr of groups) {
    if (!gr.fill) continue;
    const x = [1, gr.n.x, gr.n.y, gr.n.z], y = lum(gr.fill.l), w = gr.area * gr.facing;
    for (let i = 0; i < 4; i++) { B[i] += w * x[i] * y; for (let j = 0; j < 4; j++) M[i][j] += w * x[i] * x[j]; }
  }
  for (let i = 0; i < 4; i++) M[i][i] += 1e-4;
  const sol = solve4(M, B);
  U.uA.value = sol[0]; U.uV.value.set(sol[1], sol[2], sol[3]);
  const span = sol[0] + U.uV.value.length();
  U.uFloor.value = 0.22 * span;
  const rampL = RAMP_FILLS.map((h) => lum(linOf(h)));
  U.uLmin.value = rampL[0] - 0.5 * (rampL[1] - rampL[0]);
  U.uLmax.value = rampL[4] + 0.5 * (rampL[4] - rampL[3]);
  const rampAt = (L) => RAMP_FILLS[Math.min(4, Math.max(0, Math.floor((L - U.uLmin.value) / (U.uLmax.value - U.uLmin.value) * 5)))];
  // Write per-vertex attributes.
  const attrs = new Map();
  for (const part of parts) {
    const count = part.mesh.geometry.attributes.position.count;
    attrs.set(part, { color: new Float32Array(count * 3), rest: new Float32Array(count), glow: new Float32Array(count) });
  }
  let matched = 0;
  for (const gr of groups) {
    const L0 = Math.max(sol[0] + U.uV.value.dot(gr.n), U.uFloor.value);
    const col = gr.fill ? gr.fill.l : linOf(rampAt(L0));
    if (gr.fill) matched++;
    const at = attrs.get(gr.part), pos = gr.part.mesh.geometry.attributes.position;
    for (const t of gr.list) for (let k = 0; k < 3; k++) {
      const i = 3 * t + k;
      at.color.set(col, i * 3); at.rest[i] = L0;
      v.fromBufferAttribute(pos, i);
      at.glow[i] = gr.part.kind === 'head' && v.y > 3.4 && v.y < 4.8 && v.z > 0.2 ? 1 : 0;
    }
  }
  for (const [part, at] of attrs) {
    const g = part.mesh.geometry;
    g.setAttribute('color', new THREE.BufferAttribute(at.color, 3));
    g.setAttribute('restLight', new THREE.BufferAttribute(at.rest, 1));
    g.setAttribute('glowMask', new THREE.BufferAttribute(at.glow, 1));
    part.mesh.userData.facetMaterial = facetMaterial();
    part.mesh.material = part.mesh.userData.facetMaterial;
  }
  return { groups: groups.length, matched, light: U.uV.value.clone().normalize() };
}
function solve4(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[4] / r[i]);
}
// 2D fit: match the rendered silhouette's area and centroid to the artwork's, then frame the live camera with it.
// Camera.Logo is close but not exact; this keeps the overlay comparison honest without touching the 3D camera angle.
const frame2d = { cx: 0, cy: 0, ymag: LOGO_YMAG, zoom: 1 };
function fitToArtwork() {
  const W = refImg.width * 2, H = refImg.height * 2, a = refImg.width / refImg.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(refImg, 0, 0, W, H);
  const ref = cx.getImageData(0, 0, W, H).data;
  const moments = (get) => { let n = 0, sx = 0, sy = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (get(x, y)) { n++; sx += x; sy += y; } return { n, x: sx / n, y: sy / n }; };
  const mr = moments((x, y) => ref[(y * W + x) * 4 + 2] > 60);
  const rt = new THREE.WebGLRenderTarget(W, H);
  const fitCam = cam.clone(), white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const buf = new Uint8Array(W * H * 4);
  for (let iter = 0; iter < 3; iter++) {
    fitCam.top = frame2d.cy + frame2d.ymag; fitCam.bottom = frame2d.cy - frame2d.ymag;
    fitCam.left = frame2d.cx - frame2d.ymag * a; fitCam.right = frame2d.cx + frame2d.ymag * a;
    fitCam.updateProjectionMatrix();
    scene.overrideMaterial = white; renderer.setRenderTarget(rt); renderer.render(scene, fitCam);
    renderer.setRenderTarget(null); scene.overrideMaterial = null;
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    const mm = moments((x, y) => buf[((H - 1 - y) * W + x) * 4] > 127);
    const s = Math.sqrt(mr.n / mm.n);
    const toWorld = (px, py, ymag) => [frame2d.cx + (px / W * 2 - 1) * ymag * a, frame2d.cy + (1 - py / H * 2) * ymag];
    const [um, vm] = toWorld(mm.x, mm.y, frame2d.ymag);
    const ymag = frame2d.ymag / s;
    frame2d.cx = um - (mr.x / W * 2 - 1) * ymag * a;
    frame2d.cy = vm - (1 - mr.y / H * 2) * ymag;
    frame2d.ymag = ymag;
  }
  rt.dispose();
}
fitToArtwork();
const bakeInfo = bake();
bakeInfo.fit = { scale: +(LOGO_YMAG / frame2d.ymag).toFixed(3), dx: +frame2d.cx.toFixed(3), dy: +frame2d.cy.toFixed(3) };
$('loading').hidden = true;

// ---------- springs ----------
class Spring {
  constructor(k, zeta = 1, x = 0) { this.k = k; this.c = 2 * Math.sqrt(k) * zeta; this.x = x; this.v = 0; this.target = x; }
  step(dt) { const a = this.k * (this.target - this.x) - this.c * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; }
}
// ---------- ASCII: render to a small target, then draw one glyph per cell in the brand gradient ----------
// Brand cues (brand.vaadin.com): mono type for ASCII graphics, blue #056ff0 to #03f7ff on black.
const asciiCv = $('asciicv'), actx = asciiCv.getContext('2d');
const asciiRT = new THREE.WebGLRenderTarget(1, 1);
const ASCII_SETS = { vaadin: ' :-=>+%a', ramp: ' .:-=+*#%@', binary: ' .:01', code: ' .:;=+<>{}#' };
// Vaadin brand set, read from the brand examples: runs of the brightest glyph ('a') start with V, A, d or n,
// sometimes spelling the whole word; a few lowercase letters are sprinkled through darker areas.
const VAADIN_PREFIXES = ['V', 'V', 'AV', 'Ad', 'Vn', 'A$', 'dV', 'Vd', '$A', 'AA'];
const VAADIN_SPRINKLE = 'vdni';
// Lower tone bound per glyph of the brand set (index 1..7); 'a' takes the bright half, '=' and '>' the mid-tones.
const VAADIN_LEVELS = [0, 0, 0.1, 0.2, 0.33, 0.42, 0.48, 0.54];
const hash = (a, b) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const ASCII_SS = 2; // supersampling per cell side
// Colour ramps: 'sampled' is measured from the brand ASCII examples (dark navy to cyan), 'gradient' is the brand gradient.
const ASCII_STOPS = { sampled: ['0E3B61', '0E70B5', '11A5E2', '11C5E4'], gradient: ['056FF0', '03F7FF'] };
const asciiColors = Object.fromEntries(Object.entries(ASCII_STOPS).map(([k, stops]) => [k, Array.from({ length: 24 }, (_, i) => {
  const t = i / 23 * (stops.length - 1), j = Math.min(stops.length - 2, Math.floor(t)), f = t - j;
  const a = hexToSrgb(stops[j]), b = hexToSrgb(stops[j + 1]);
  return `rgb(${a.map((x, n) => Math.round(x + (b[n] - x) * f)).join(',')})`;
})]));
const asciiState = { buf: new Uint8Array(4), lo: 0.3, hi: 0.7 };
function renderAscii() {
  const dpr = Math.min(devicePixelRatio, 2), w = stage.clientWidth, h = stage.clientHeight;
  const setName = $('asciiset').value, brand = setName === 'vaadin';
  // The brand set uses square, widely tracked cells; the others pack glyphs densely.
  const size = val('asciisize'), cw = brand ? size * 1.55 : size * 0.6, chh = brand ? size * 1.55 : size * 1.1;
  const cols = Math.floor(w / cw), rows = Math.floor(h / chh), W = cols * ASCII_SS, H = rows * ASCII_SS;
  if (asciiCv.width !== Math.round(w * dpr) || asciiCv.height !== Math.round(h * dpr)) { asciiCv.width = Math.round(w * dpr); asciiCv.height = Math.round(h * dpr); }
  if (asciiRT.width !== W || asciiRT.height !== H) { asciiRT.setSize(W, H); asciiState.buf = new Uint8Array(W * H * 4); }
  renderer.setRenderTarget(asciiRT); renderer.render(scene, cam); renderer.setRenderTarget(null);
  const buf = asciiState.buf;
  renderer.readRenderTargetPixels(asciiRT, 0, 0, W, H, buf);
  // Per-cell coverage and perceptual luminance (render target holds linear values, rows bottom-up).
  const L = new Float32Array(cols * rows), cov = new Float32Array(cols * rows);
  let lo = 1, hi = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let n = 0, sum = 0;
    for (let y = 0; y < ASCII_SS; y++) for (let x = 0; x < ASCII_SS; x++) {
      const o = ((H - 1 - (r * ASCII_SS + y)) * W + c * ASCII_SS + x) * 4;
      if (buf[o] + buf[o + 1] + buf[o + 2] > 6) { n++; sum += Math.pow((0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2]) / 255, 1 / 2.2); }
    }
    const i = r * cols + c;
    cov[i] = n / (ASCII_SS * ASCII_SS);
    L[i] = n ? sum / n : 0;
    if (cov[i] >= 0.5) { lo = Math.min(lo, L[i]); hi = Math.max(hi, L[i]); }
  }
  // Auto-levels, eased so the glyphs don't flicker.
  asciiState.lo += (lo - asciiState.lo) * 0.1; asciiState.hi += (hi - asciiState.hi) * 0.1;
  const span = Math.max(0.05, asciiState.hi - asciiState.lo), set = ASCII_SETS[setName], edges = false;
  const palette = asciiColors['sampled'];
  actx.setTransform(dpr, 0, 0, dpr, 0, 0);
  actx.fillStyle = '#000'; actx.fillRect(0, 0, w, h);
  actx.font = `500 ${size}px ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace`;
  actx.textBaseline = 'middle'; actx.textAlign = 'center';
  const ox = (w - cols * cw) / 2, oy = (h - rows * chh) / 2;
  const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols || cov[r * cols + c] < 0.5 ? 0 : L[r * cols + c]);
  const top = set.length - 1;
  for (let r = 0; r < rows; r++) {
    // Brightest-glyph runs in this row, for the brand prefixes.
    const level = new Int8Array(cols), tones = new Float32Array(cols), glyph = new Array(cols).fill('');
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (cov[i] < 0.5) { level[c] = -1; continue; }
      tones[c] = Math.min(1, Math.max(0, (L[i] - asciiState.lo) / span));
      if (brand) { let l = top; while (l > 1 && tones[c] < VAADIN_LEVELS[l]) l--; level[c] = l; }
      else level[c] = 1 + Math.min(top - 1, Math.floor(tones[c] * top));
      glyph[c] = set[level[c]];
    }
    if (brand) {
      for (let c = 0; c < cols; c++) {
        if (level[c] === top && (c === 0 || level[c - 1] !== top)) {
          let end = c; while (end < cols && level[end] === top) end++;
          const len = end - c, h = hash(r, c);
          const word = len >= 7 && h < 0.3 ? 'Vaadin' : VAADIN_PREFIXES[Math.floor(h * VAADIN_PREFIXES.length)];
          for (let k = 0; k < Math.min(word.length, len); k++) glyph[c + k] = word[k];
        } else if (level[c] > 0 && level[c] < top && hash(c, r * 7 + 3) < 0.035) {
          glyph[c] = VAADIN_SPRINKLE[Math.floor(hash(r, c * 13) * VAADIN_SPRINKLE.length)];
        }
      }
    }
    for (let c = 0; c < cols; c++) {
    if (level[c] < 0) continue;
    const t = tones[c];
    let ch = glyph[c], tone = brand && /[VAdn$]/.test(ch) ? Math.min(1, t + 0.15) : t;
    if (edges) {
      const gx = at(r, c + 1) - at(r, c - 1), gy = at(r + 1, c) - at(r - 1, c);
      if (Math.hypot(gx, gy) > 0.09) {
        const ex = -gy, ey = gx; // edge direction, screen y down
        ch = Math.abs(ex) > 2 * Math.abs(ey) ? '-' : Math.abs(ey) > 2 * Math.abs(ex) ? '|' : ex * ey > 0 ? '\\' : '/';
        tone = Math.min(1, t + 0.35);
      }
    }
    actx.fillStyle = palette[Math.round(tone * 23)];
    actx.fillText(ch, ox + (c + 0.5) * cw, oy + (r + 0.5) * chh);
    }
  }
}

// ---------- state ----------
const pose = { turn: new Spring(60, 0.8, ORIGINAL.turn), tilt: new Spring(60, 0.8, ORIGINAL.tilt), roll: new Spring(60, 1), jaw: new Spring(200, 1) };
const ears = parts.filter((p) => p.kind === 'ear').map((p) => ({ part: p, s: new Spring(160, 0.35), nextFlick: 2 + Math.random() * 4 }));
const state = { mode: 'original', pointer: { x: 0, y: 0 }, lastMove: -10 };
const orbit = { yaw: 0, pitch: 0, zoom: 1, drag: null, pivot: new THREE.Vector3(0, 5.2, 0) };
const zoomOut = new Spring(30, 1, 1.1);
const val = (id) => +$(id).value;
const HINTS = {
  original: 'The pose of the logo: head turned 19° and lifted 15°.',
  straight: 'Neutral: head level, looking straight ahead. Everything except the antlers is mirror-symmetric.',
  manual: 'Set the head yourself. Turn and tilt are relative to the chest.',
  follow: 'The head follows your pointer; leave it still and the reindeer settles back with the odd glance.',
};
const fmt = { 'p-turn': (x) => x + '°', 'p-tilt': (x) => x + '°', 'p-roll': (x) => x + '°', 'p-jaw': (x) => (x / 100 * JAW_MAX / DEG).toFixed(0) + '°', asciisize: (x) => x + 'px' };
const showOut = (id) => { $(id + '-o').textContent = fmt[id](val(id)); };
const setSliders = (p) => { $('p-turn').value = p.turn; $('p-tilt').value = p.tilt; $('p-roll').value = 0; $('p-jaw').value = 0; for (const id of ['p-turn', 'p-tilt', 'p-roll', 'p-jaw']) showOut(id); };
function setMode(mode) {
  state.mode = mode;
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-checked', b.dataset.mode === mode);
  $('modehint').textContent = HINTS[mode];
  if (mode === 'original') setSliders(ORIGINAL);
  if (mode === 'straight') setSliders(STRAIGHT);
  if (mode !== 'original') $('artwork').checked = false;
  applyArtwork();
}
for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => setMode(b.dataset.mode));
for (const id of ['p-turn', 'p-tilt', 'p-roll', 'p-jaw']) $(id).addEventListener('input', () => { showOut(id); if (state.mode !== 'manual') setMode('manual'); });
$('asciisize').addEventListener('input', () => showOut('asciisize')); showOut('asciisize');

const applyShading = () => {
  const mode = val('shading');
  U.uMode.value = mode;
  for (const p of parts) p.mesh.material = mode === 2 ? p.mesh.userData.glbMaterial : p.mesh.userData.facetMaterial;
};
$('shading').addEventListener('change', applyShading);
const resetOrbit = () => { orbit.yaw = orbit.pitch = 0; orbit.zoom = 1; resize(); };
// The artwork overlay only lines up in the logo pose and view, so switching it on returns to both.
function applyArtwork() {
  const on = $('artwork').checked;
  if (on) { if (state.mode !== 'original') setMode('original'); resetOrbit(); $('ascii').checked = false; applyAscii(); }
  ref.style.opacity = on ? 1 : 0;
}
$('artwork').addEventListener('change', () => { if ($('artwork').checked && state.mode !== 'original') { setMode('original'); $('artwork').checked = true; } applyArtwork(); });
function applyAscii() { const on = $('ascii').checked; $('asciirow').hidden = $('asciisizerow').hidden = !on; }
$('ascii').addEventListener('change', () => { if ($('ascii').checked) { $('artwork').checked = false; ref.style.opacity = 0; } applyAscii(); });
$('resetview').addEventListener('click', resetOrbit);

// ---------- pointer: drag rotates the whole model, scroll zooms ----------
const dropArtwork = () => { if ($('artwork').checked) { $('artwork').checked = false; ref.style.opacity = 0; } };
stage.addEventListener('pointerdown', (e) => { orbit.drag = { x: e.clientX, y: e.clientY }; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); e.preventDefault(); });
stage.addEventListener('pointermove', (e) => {
  if (!orbit.drag) return;
  orbit.yaw += (e.clientX - orbit.drag.x) * 0.45;
  orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + (e.clientY - orbit.drag.y) * 0.45, -89, 89);
  orbit.drag = { x: e.clientX, y: e.clientY };
  dropArtwork();
});
for (const type of ['pointerup', 'pointercancel']) stage.addEventListener(type, () => { orbit.drag = null; stage.classList.remove('dragging'); });
stage.addEventListener('wheel', (e) => { e.preventDefault(); orbit.zoom = THREE.MathUtils.clamp(orbit.zoom * Math.exp(e.deltaY * 0.0015), 0.35, 2.5); dropArtwork(); resize(); }, { passive: false });
stage.addEventListener('dblclick', resetOrbit);
addEventListener('pointermove', (e) => {
  const r = stage.getBoundingClientRect();
  state.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  state.pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  state.lastMove = performance.now() / 1000;
});

// ---------- resize ----------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  const y = frame2d.ymag * zoomOut.x * orbit.zoom;
  cam.top = frame2d.cy + y; cam.bottom = frame2d.cy - y; cam.left = frame2d.cx - y * w / h; cam.right = frame2d.cx + y * w / h;
  cam.updateProjectionMatrix();
  ref.style.height = (100 / zoomOut.x) + '%';
  ref.style.top = (50 - 50 / zoomOut.x) + '%';
}
new ResizeObserver(resize).observe(stage);
resize();

// ---------- follow pointer ----------
const raycaster = new THREE.Raycaster(), pivot = new THREE.Vector3(), chestQ = new THREE.Quaternion();
let held = { ...ORIGINAL }, nextGlance = 0;
function followTarget(now) {
  if (now - state.lastMove > 3.5) {
    // Settle back to the logo pose with occasional small glances.
    if (now > nextGlance) {
      nextGlance = now + 2.5 + Math.random() * 3.5;
      held = !REDUCED && Math.random() < 0.6 ? { turn: ORIGINAL.turn + (Math.random() * 2 - 1) * 12, tilt: ORIGINAL.tilt + (Math.random() * 2 - 1) * 5 } : { ...ORIGINAL };
    }
    return held;
  }
  raycaster.setFromCamera(state.pointer, cam);
  headBone.getWorldPosition(pivot);
  const { origin, direction } = raycaster.ray;
  const t = pivot.clone().sub(origin).dot(direction);
  const d = origin.clone().addScaledVector(direction, t - 10).sub(pivot).applyQuaternion(chestBone.getWorldQuaternion(chestQ).invert());
  const turn = THREE.MathUtils.clamp(Math.atan2(d.x, d.z) / DEG, -45, 70);
  const lift = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)) / DEG, -22, 25);
  const next = { turn: ORIGINAL.turn + (turn - ORIGINAL.turn) * 0.75, tilt: ORIGINAL.tilt + lift * 0.75 };
  if (Math.hypot(next.turn - held.turn, next.tilt - held.tilt) > 6) held = next; // glance and hold
  return held;
}

// ---------- STL export of the current pose ----------
function posedTriangles() {
  // Positions with the jaw morph and the head pose applied, without the view rotation.
  const q0 = rig.quaternion.clone(), p0 = rig.position.clone();
  rig.quaternion.identity(); rig.position.set(0, 0, 0);
  scene.updateMatrixWorld(true);
  const out = [];
  for (const part of parts) {
    const m = part.mesh, count = m.geometry.attributes.position.count;
    m.skeleton.update();
    for (let i = 0; i < count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); out.push(v.x, -v.z, v.y); } // glTF Y-up to Z-up
  }
  rig.quaternion.copy(q0); rig.position.copy(p0); scene.updateMatrixWorld(true);
  return out;
}
function exportSTL() {
  const tri = posedTriangles(), n = tri.length / 9;
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 2; i < tri.length; i += 3) { zmin = Math.min(zmin, tri[i]); zmax = Math.max(zmax, tri[i]); }
  const mm = THREE.MathUtils.clamp(val('height') || 120, 20, 1000), s = mm / (zmax - zmin);
  const data = new DataView(new ArrayBuffer(84 + n * 50));
  const title = `Vaadin reindeer, posed, ${mm} mm tall, five unfused parts`;
  for (let i = 0; i < title.length; i++) data.setUint8(i, title.charCodeAt(i));
  data.setUint32(80, n, true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let t = 0, o = 84; t < n; t++, o += 50) {
    const k = t * 9;
    a.set(tri[k], tri[k + 1], (tri[k + 2] - zmin)).multiplyScalar(s);
    b.set(tri[k + 3], tri[k + 4], (tri[k + 5] - zmin)).multiplyScalar(s);
    c.set(tri[k + 6], tri[k + 7], (tri[k + 8] - zmin)).multiplyScalar(s);
    nrm.subVectors(b, a).cross(v.subVectors(c, a)).normalize();
    [nrm, a, b, c].forEach((p, j) => { data.setFloat32(o + j * 12, p.x, true); data.setFloat32(o + j * 12 + 4, p.y, true); data.setFloat32(o + j * 12 + 8, p.z, true); });
  }
  const r = (x) => Math.round(x);
  const name = `reindeer-turn${r(pose.turn.x)}-tilt${r(pose.tilt.x)}-${mm}mm.stl`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([data.buffer], { type: 'model/stl' }));
  link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  return { name, triangles: n, heightMm: mm, bytes: data.byteLength };
}
$('exportstl').addEventListener('click', exportSTL);

// ---------- frame loop ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20), now = clock.elapsedTime, wall = performance.now() / 1000;
  const mode = state.mode, follow = mode === 'follow';
  const target = follow ? followTarget(wall) : mode === 'manual' ? { turn: val('p-turn'), tilt: val('p-tilt') } : mode === 'straight' ? STRAIGHT : ORIGINAL;
  pose.turn.target = target.turn; pose.tilt.target = target.tilt;
  pose.roll.target = mode === 'manual' ? val('p-roll') : follow ? -(pose.turn.x - ORIGINAL.turn) * 0.12 : 0;
  pose.jaw.target = mode === 'manual' ? val('p-jaw') / 100 : 0;
  for (const s of Object.values(pose)) s.step(dt);
  const bob = follow && !REDUCED ? Math.sin(now * 1.3) * 0.35 : 0;
  setHead(pose.turn.x, pose.tilt.x + bob, pose.roll.x);
  for (const p of parts) if (p.kind === 'head') p.mesh.morphTargetInfluences[0] = Math.max(0, pose.jaw.x);
  for (const e of ears) {
    if (follow && !REDUCED && now > e.nextFlick) { e.s.v += (Math.random() < 0.5 ? -1 : 1) * 9; e.nextFlick = now + 3 + Math.random() * 6; }
    e.s.step(dt);
    e.part.mesh.morphTargetInfluences[0] = e.s.x;
  }

  // View: turntable yaw plus elevation about the screen's horizontal axis, around a pivot at head height.
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  rig.quaternion.setFromAxisAngle(right, orbit.pitch * DEG).multiply(q.setFromAxisAngle(v.set(0, 1, 0), orbit.yaw * DEG));
  rig.position.copy(orbit.pivot).sub(v.copy(orbit.pivot).applyQuaternion(rig.quaternion));

  // Exact logo framing while the artwork is shown; a little more room for the antlers otherwise.
  zoomOut.target = $('artwork').checked ? 1 : 1.1;
  if (Math.abs(zoomOut.target - zoomOut.x) > 1e-4 || Math.abs(zoomOut.v) > 1e-4) { zoomOut.step(dt); resize(); }
  $('hud-l').textContent = `turn ${pose.turn.x.toFixed(0).padStart(3)}°  tilt ${pose.tilt.x.toFixed(0).padStart(3)}°`;
  $('hud-r').textContent = orbit.yaw || orbit.pitch ? `view ${orbit.yaw.toFixed(0)}° / ${orbit.pitch.toFixed(0)}°` : 'logo view';
  const ascii = $('ascii').checked;
  asciiCv.hidden = !ascii; $('gl').style.visibility = ascii ? 'hidden' : 'visible';
  if (ascii) renderAscii(); else renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
setMode('original');
applyShading();
applyAscii();
frame();
window.__reindeer = { bakeInfo, state, orbit, pose, setMode, exportSTL, posedTriangles };
