import { saveLocalTrip, readLocalTrip } from './local-showcase.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bad, dateAt, normalize } from './domain.mjs';
import { findCity, weather } from './geo.mjs';
import { lookupSuggestions } from './location-suggest.mjs';
import { drivePreview } from './drive-preview.mjs';
import { placeInfo } from './research.mjs';
import { candidates } from './candidates.mjs';
import { serveIntegrations, flightCapabilities } from './integrations.mjs';
import { health, requireReady } from './model.mjs';
import { planTrip, replan, transport } from './plan.mjs';

const base = process.env.LAMBDA_TASK_ROOT || fileURLToPath(new URL('../', import.meta.url));
const root = resolve(base, process.env.NODE_ENV === 'production' ? 'dist' : 'web');
const vendor = resolve(base, 'node_modules/maplibre-gl/dist');
const mapFiles = new Set([
  'maplibre-gl.mjs',
  'maplibre-gl.css',
  'maplibre-gl-shared.mjs',
  'maplibre-gl-worker.mjs',
]);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
function json(response, value, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}
async function body(request) {
  if (Number(request.headers['content-length']) > 2_097_152) {
    request.resume();
    throw bad('ข้อมูลใหญ่เกินไป');
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 2_097_152) {
      request.resume();
      throw bad('ข้อมูลใหญ่เกินไป');
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    throw new Error();
  } catch {
    throw bad('ข้อมูล JSON ไม่ถูกต้อง');
  }
}
export function demoSetup(today = new Date().toISOString().slice(0, 10)) {
  return normalize({
    city: 'เชียงใหม่',
    startDate: dateAt(today, 1),
    endDate: dateAt(today, 3),
    arrive: { by: 'flight', from: 'DMK', time: '09:45' },
    depart: { by: 'flight', to: 'DMK', time: '20:30' },
    members: [
      { name: 'มิน', budget: 2600 },
      { name: 'ต้น', maxWalkKm: 4 },
      { name: 'ฟ้า', avoid: 'เนื้อสัตว์ (กินมังสวิรัติ)' },
      { name: 'ก้อง', id: 'member-4', wants: ['ประตูท่าแพ'] },
    ],
  });
}
const streams = new Map([
  ['/api/plan', (input, ctx) => planTrip(normalize(input?.setup), ctx)],
  ['/api/plan/candidates', (input, ctx) => candidates(normalize(input?.setup), ctx)],
  ['/api/replan', (input, ctx) => replan(input ?? {}, ctx)],
  [
    '/api/transport-options',
    async (input, ctx) => {
      const start = performance.now();
      const options = await transport(normalize(input.setup), input.dir, ctx);
      return { options, ms: Math.round(performance.now() - start), usage: ctx.usage };
    },
  ],
  ['/api/drive-preview', async (input, ctx) => ({ drive: await drivePreview(input, ctx.signal) })],
  ['/api/weather-check', (input, ctx) => weather(input.plan ?? input, ctx.signal, undefined, input.setup)],
  ['/api/place-info', placeInfo],
]);
async function stream(response, signal, work) {
  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  const emit = (event) => {
    if (!signal.aborted) response.write(JSON.stringify(event) + '\n');
  };
  const step = (text) => emit({ type: 'step', text });
  const heartbeat = setInterval(() => emit({ type: 'heartbeat' }), 15_000);
  try {
    emit({ ...(await work({ signal, emit, step, usage: {} })), type: 'done' });
  } catch (error) {
    if (!signal.aborted) {
      const code = ['bad_request', 'no_key', 'auth', 'rate_limit', 'refusal', 'upstream'].includes(error.code)
        ? error.code
        : 'upstream';
      emit({
        type: 'error',
        code,
        message: code !== 'upstream' ? error.message : 'Bop ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง',
      });
    }
  } finally {
    clearInterval(heartbeat);
    if (!signal.aborted) response.end();
  }
}
export async function handleRequest(request, response) {
  const abort = new AbortController();
  response.on('close', () => {
    if (!response.writableFinished) abort.abort();
  });
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Strict-Transport-Security', 'max-age=31536000');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://tiles.openfreemap.org https://api.line.me https://*.line-scdn.net https://*.line.me; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  );
  try {
    const url = new URL(request.url, 'http://localhost');
    const saved = /^\/api\/local-trips\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (request.method === 'GET' && saved) {
      const trip = await readLocalTrip(request, saved[1]);
      return trip ? json(response, trip) : json(response, { error: 'not_found' }, 404);
    }
    if (await serveIntegrations(request, response, url, abort.signal)) return;
    if (request.method === 'GET' && url.pathname === '/api/health')
      return json(response, { ...(await health()), flights: flightCapabilities() });
    if (request.method === 'GET' && url.pathname === '/api/location-suggest') {
      const params = url.searchParams;
      const hasCenter = params.has('lat') || params.has('lon');
      const coordinate = (key) => params.get(key)?.trim() ? Number(params.get(key)) : NaN;
      const suggestions = await lookupSuggestions(params.get('q') || '', {
        kind: params.get('kind') || 'city',
        city: params.get('city') || '',
        center: hasCenter ? [coordinate('lat'), coordinate('lon')] : undefined,
        signal: abort.signal,
      });
      return json(response, { suggestions });
    }
    if (request.method === 'GET' && url.pathname === '/api/city') {
      const name = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
      const found = name && (await findCity(name, abort.signal));
      return found ? json(response, found) : json(response, { error: 'not_found' }, 404);
    }
    if (request.method === 'GET' && url.pathname === '/api/demo') {
      return stream(response, abort.signal, (ctx) => planTrip(demoSetup(), ctx, true));
    }
    if (request.method === 'POST' && streams.has(url.pathname)) {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
        request.resume();
        response.writeHead(415, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(
          JSON.stringify({
            type: 'error',
            code: 'bad_request',
            message: 'กรุณาส่งข้อมูลชนิด application/json',
          }) + '\n',
        );
        return;
      }
      return stream(response, abort.signal, async (ctx) => {
        const input = await body(request);
        if (!['/api/weather-check', '/api/drive-preview'].includes(url.pathname) && !(url.pathname === '/api/replan' && input.demo === true))
          await requireReady();
        const result = await streams.get(url.pathname)(input, ctx);
        if (url.pathname === '/api/plan') {
          const tripId = await saveLocalTrip(request, result);
          if (tripId) return { ...result, localTripId: tripId };
        }
        if (url.pathname === '/api/replan' && !input.demo && Array.isArray(result.options)) {
          await Promise.all(
            result.options.map(async (option) => {
              const id = await saveLocalTrip(request, {
                plan: option.plan,
                routes: result.routes,
                usage: result.usage,
                summary: option.line || option.title,
              });
              if (id) option.localTripId = id;
            }),
          );
        }
        return result;
      });
    }
    if (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method))
      return json(response, { error: 'not_found' }, 404);
    const name = decodeURIComponent(url.pathname);
    let path = resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!path.startsWith(root + sep)) return json(response, { error: 'not_found' }, 404);
    if (process.env.NODE_ENV !== 'production' && name.startsWith('/assets/')) {
      const asset = name.slice(8);
      if (mapFiles.has(asset)) path = resolve(vendor, asset);
      else if (['liff.js', 'sample.json', 'sample-replan.js'].includes(asset))
        path = resolve(base, 'dist/assets', asset);
    }
    let contents;
    try {
      contents = await readFile(path);
    } catch {
      if (extname(name) && !request.headers.accept?.includes('text/html'))
        return json(response, { error: 'not_found' }, 404);
      path = resolve(root, 'index.html');
      contents = await readFile(path);
    }
    const headers = {
      'Content-Type': mime[extname(path)] || 'application/octet-stream',
      'Content-Length': contents.length,
      'Cache-Control':
        name.startsWith('/assets/') && url.searchParams.has('v')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
    };
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch (error) {
    if (!abort.signal.aborted && !response.headersSent) json(response, { error: 'bad_request' }, 400);
  }
}
export const server = http.createServer(handleRequest);
