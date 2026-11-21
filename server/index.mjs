// Production server: serves dist/ and /api/*. Usage: npm run build && npm start.
// Lambda Web Functions advertises the required bind address through AWS_LAMBDA_HTTP_ENDPOINT.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadEnvFile } from './env.mjs';
import { loadRuntimeSecrets } from './runtime-secrets.mjs';
import { setSecurityHeaders } from './security.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const fileEnv = { ...loadEnvFile(path.join(ROOT, '.env')), ...loadEnvFile(path.join(ROOT, '.env.local')) };
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const loadedSecrets = await loadRuntimeSecrets();
if (loadedSecrets.length) console.info(`[bop] loaded ${loadedSecrets.length} runtime secret fields`);

// Import after local and AWS-managed configuration is loaded. Several server modules
// intentionally read tuning variables once, at module initialization.
const { createApi } = await import('./api.mjs');
const env = { ...fileEnv, ...process.env };
const api = createApi({
  apiKey: env.ANTHROPIC_API_KEY,
  openaiKey: env.OPENAI_API_KEY || env.OPENAI_APIKEY,
  fake: env.BOP_FAKE_LLM === '1',
  provider: env.BOP_PROVIDER,
  claudeBin: env.BOP_CLAUDE_BIN,
});

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); return res.end(); }
  let file = path.resolve(DIST, '.' + rel);
  if (file !== DIST && !file.startsWith(DIST + path.sep)) { res.writeHead(403); return res.end(); }
  try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html'); }
  catch {
    // Only navigation requests receive the SPA shell. Missing assets stay 404 instead
    // of returning HTML under a JavaScript or image content type.
    const acceptsHtml = String(req.headers.accept || '').includes('text/html');
    if (path.extname(rel) && !acceptsHtml) { res.writeHead(404); return res.end('Not found'); }
    file = path.join(DIST, 'index.html');
  }
  try {
    const data = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found (run npm run build)'); }
}

const server = http.createServer((req, res) => {
  setSecurityHeaders(res);
  api(req, res, () => serveStatic(req, res)).catch(error => {
    console.error('[bop]', error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

function listenTarget() {
  const advertised = env.AWS_LAMBDA_HTTP_ENDPOINT;
  if (advertised) {
    const split = advertised.lastIndexOf(':');
    const host = advertised.slice(0, split);
    const port = Number(advertised.slice(split + 1));
    if (host && Number.isInteger(port) && port > 0) return { host, port };
    throw new Error('AWS_LAMBDA_HTTP_ENDPOINT is invalid');
  }
  return { host: env.HOST || '0.0.0.0', port: Number(env.PORT) || 8787 };
}

const { host, port } = listenTarget();
server.listen(port, host, () => console.log(`[bop] listening on ${host}:${port}`));
