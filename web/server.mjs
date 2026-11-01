// Local server for the motion lab: serves the repository's web/, exports/ and reference/
// folders and mints short-lived OpenAI Realtime keys so the API key never reaches the browser.
//
//   OPENAI_API_KEY=sk-... node web/server.mjs        then open http://localhost:8317/
//
// Optional: PORT, OPENAI_REALTIME_MODEL (default gpt-realtime), OPENAI_REALTIME_VOICE (default marin).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 8317);
const SERVED = ['web', 'exports', 'reference'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const INSTRUCTIONS = `You are the Vaadin reindeer, the mascot of Vaadin, the Java web framework company from Turku, Finland.
Speak calmly and warmly, with dry Nordic understatement. Keep answers short: one to three sentences.`;

async function session(res) {
  const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
        instructions: INSTRUCTIONS,
        audio: { output: { voice: process.env.OPENAI_REALTIME_VOICE || 'marin' } },
      },
    }),
  });
  res.writeHead(r.status, { 'Content-Type': 'application/json' });
  res.end(await r.text());
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/') { res.writeHead(302, { Location: '/web/' }); return res.end(); }
    if (url.pathname === '/api/realtime/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ configured: Boolean(process.env.OPENAI_API_KEY) }));
    }
    if (url.pathname === '/api/realtime/session' && req.method === 'POST') {
      if (!process.env.OPENAI_API_KEY) { res.writeHead(503); return res.end('{"error":{"message":"OPENAI_API_KEY is not set"}}'); }
      return await session(res);
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    if (path.endsWith(sep) || path === 'web') path = join(path, 'index.html');
    if (!SERVED.includes(path.split(sep)[0])) { res.writeHead(404); return res.end(); }
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
}).listen(PORT, () => console.log(`Reindeer motion lab: http://localhost:${PORT}/`));
