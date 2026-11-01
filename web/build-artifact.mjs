// Build a single self-contained page (GLB and reference PNG inlined) from web/index.html.
//   node web/build-artifact.mjs [output.html]      default: build/reindeer-motion-lab.html
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(process.argv[2] || resolve(ROOT, 'build/reindeer-motion-lab.html'));
const [html, glb, png] = await Promise.all([
  readFile(resolve(ROOT, 'web/index.html'), 'utf8'),
  readFile(resolve(ROOT, 'exports/reindeer.glb')),
  readFile(resolve(ROOT, 'reference/Reindeer.png')),
]);
const assets = `<script>window.REINDEER_ASSETS = ${JSON.stringify({
  glbBase64: glb.toString('base64'),
  png: 'data:image/png;base64,' + png.toString('base64'),
})};</script>`;
const page = html
  .replace(/<!--local:start-->[\s\S]*?<!--local:end-->\n?/g, '')
  .replace('<!--assets-->', () => assets);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`${out} (${(page.length / 1024).toFixed(0)} KB)`);
