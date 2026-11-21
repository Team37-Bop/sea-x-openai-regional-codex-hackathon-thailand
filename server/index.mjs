import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bad, dateAt, normalize, source } from './domain.mjs';
import { findCity, weather } from './geo.mjs';
import { wikipediaPhoto } from './photos.mjs';
import { health, model } from './model.mjs';
import { candidates, planTrip, replan, transport, validatePlan } from './plan.mjs';

const root = fileURLToPath(new URL(process.env.NODE_ENV === 'production' ? '../dist/' : '../web/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
function json(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function body(request) {
  if (Number(request.headers['content-length']) > 2_097_152) { request.resume(); throw bad('ข้อมูลใหญ่เกินไป'); }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 2_097_152) { request.resume(); throw bad('ข้อมูลใหญ่เกินไป'); }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw bad('ข้อมูล JSON ไม่ถูกต้อง'); }
}
function demoSetup() {
  const today = new Date().toISOString().slice(0, 10);
  return normalize({ city: 'เชียงใหม่', startDate: dateAt(today, 1), endDate: dateAt(today, 3),
    arrive: { by: 'flight', from: 'DMK', time: '09:45' }, depart: { by: 'flight', to: 'DMK', time: '20:30' },
    members: ['มิน', 'ต้น', 'ฟ้า', 'ก้อง'].map(name => ({ name, budget: 2600, maxWalkKm: 4 })) });
}
const streams = new Map([
  ['/api/plan', (input, ctx) => planTrip(normalize(input?.setup), ctx)],
  ['/api/plan/candidates', (input, ctx) => candidates(normalize(input?.setup), ctx)],
  ['/api/replan', (input, ctx) => replan(input ?? {}, ctx)],
  ['/api/transport-options', async (input, ctx) => ({ options: await transport(normalize(input?.setup), input?.dir, ctx) })],
  ['/api/weather-check', (input, ctx) => weather(validatePlan(input.plan ?? input), ctx.signal)],
  ['/api/place-info', async (input, ctx) => {
    const stop = input?.stop;
    if (typeof stop?.id !== 'string' || typeof stop.n !== 'string' || !stop.n.trim()) throw bad('ไม่มีข้อมูลสถานที่ (stop.id, stop.n)');
    ctx.step('Bop กำลังค้นรายละเอียดสถานที่');
    const { value, verified } = await model('ค้นข้อมูลสถานที่ คืน {summary,details:{what,highlights,price,hours,rating,booking,address},hours,phone,tips,dishes:[{name,price,priceLocal:{amount,currency}}],rate,sources:[{url,title}]} ให้เบอร์เฉพาะเมื่อมีแหล่งยืนยัน', {
      name: stop.n.slice(0, 120), city: String(input.city ?? '').slice(0, 120), kind: stop.k,
    }, { ...ctx, quick: true, searches: 3 });
    const sources = (Array.isArray(value.sources) ? value.sources : []).slice(0, 6).map(item => source(item, verified)).filter(item => item.checked === 'web');
    const dishes = stop.k === 'food' && Array.isArray(value.dishes) ? value.dishes.slice(0, 6).map(dish => {
      const local = dish.priceLocal;
      const convert = Number.isFinite(local?.amount) && value.rate > 0 && (!Number.isFinite(dish.price) || (dish.price === local.amount && value.rate < .5));
      return { ...dish, price: convert ? local.amount * value.rate : Number.isFinite(dish.price) ? dish.price : null };
    }) : [];
    ctx.step(sources.length ? 'อ่านผลค้น ' + sources.length + ' หน้า' : 'ไม่พบข้อมูลที่เชื่อถือได้ ใช้ข้อมูลประมาณ');
    const photo = await wikipediaPhoto(stop.n, stop.ll, /[\u0e00-\u0e7f]/.test(stop.n) ? 'th' : 'en', ctx.signal);
    return { info: { ...value, dishes, sources, phone: sources.length ? value.phone : undefined, photos: photo ? [photo] : [], confidence: sources.length ? 'web' : 'estimate' } };
  }],
]);
async function stream(response, signal, work) {
  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  const emit = event => { if (!signal.aborted) response.write(JSON.stringify(event) + '\n'); };
  const step = text => emit({ type: 'step', text });
  const heartbeat = setInterval(() => step('Bop กำลังจัดเวลาให้ทันเวลาเปิด–ปิด'), 15_000);
  try { emit({ ...(await work({ signal, emit, step, usage: {} })), type: 'done' }); }
  catch (error) {
    if (!signal.aborted) {
      const code = ['bad_request', 'no_key', 'auth', 'rate_limit', 'refusal', 'upstream'].includes(error.code) ? error.code : 'upstream';
      emit({ type: 'error', code, message: code !== 'upstream' ? error.message : 'Bop ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง' });
    }
  } finally {
    clearInterval(heartbeat);
    if (!signal.aborted) response.end();
  }
}
export async function handleRequest(request, response) {
  const abort = new AbortController();
  response.on('close', () => { if (!response.writableFinished) abort.abort(); });
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/health') return json(response, await health());
    if (request.method === 'GET' && url.pathname === '/api/city') {
      const name = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
      const found = name && await findCity(name, abort.signal);
      return found ? json(response, found) : json(response, { error: 'not_found' }, 404);
    }
    if (request.method === 'GET' && url.pathname === '/api/demo') {
      return stream(response, abort.signal, ctx => planTrip(demoSetup(), ctx, true));
    }
    if (request.method === 'POST' && streams.has(url.pathname)) {
      return stream(response, abort.signal, async ctx => streams.get(url.pathname)(await body(request), ctx));
    }
    if (url.pathname.startsWith('/api/') || request.method !== 'GET') return json(response, { error: 'not_found' }, 404);
    const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const path = resolve(root, '.' + name);
    const contentType = mime[extname(path)];
    if (!path.startsWith(resolve(root) + sep) || !contentType) return json(response, { error: 'not_found' }, 404);
    const contents = await readFile(join(path));
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(contents);
  } catch (error) {
    if (!abort.signal.aborted) json(response, { error: error.code === 'bad_request' ? 'bad_request' : 'not_found' }, error.code === 'bad_request' ? 400 : 404);
  }
}
export const server = http.createServer(handleRequest);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787;
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log('Bop on http://localhost:' + port));
}
