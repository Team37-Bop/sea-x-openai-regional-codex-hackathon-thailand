import { lineConfig, lineTrips } from './line-trips.mjs';
import { flightOperation, flightCapabilities } from './flights.mjs';
import { failure } from './operation-store.mjs';
export { flightCapabilities } from './flights.mjs';

const statuses = {
  bad_request: 400,
  invalid_json: 400,
  auth: 401,
  invalid_signature: 401,
  rate_limit: 429,
  no_key: 503,
  unsupported_media_type: 415,
};
function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}
async function read(request, raw = false) {
  if (!raw && !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    request.resume();
    throw failure('unsupported_media_type', 'กรุณาส่งข้อมูลชนิด application/json');
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 2_097_152) {
      request.resume();
      throw failure('bad_request', 'ข้อมูลใหญ่เกินไป');
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (raw) return bytes;
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    /* Report the same domain error for invalid JSON and non-object JSON. */
  }
  throw failure('bad_request', 'กรุณาส่งข้อมูล JSON ที่ถูกต้อง');
}
const routes = new Map([
  ['GET ', 'get'],
  ['DELETE ', 'remove'],
  ['POST plan', 'plan'],
  ['POST post', 'post'],
  ['POST vote', 'vote.start'],
  ['GET vote', 'vote.get'],
  ['POST vote/close', 'vote.close'],
  ['POST identity', 'identity'],
  ['POST vote/ballot', 'ballot'],
]);
export async function serveIntegrations(request, response, url, signal) {
  const path = url.pathname,
    method = request.method;
  const trip = /^\/api\/trips\/([^/]+)(?:\/(plan|post|vote(?:\/close|\/ballot)?|identity))?$/.exec(path);
  const flight = /^\/api\/flights\/(offer|order|cancel)$/.exec(path);
  if (method === 'GET' && path === '/api/config') {
    json(response, 200, lineConfig());
    return true;
  }
  if (method === 'POST' && flight) {
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
    try {
      const input = await read(request);
      const capability = flightCapabilities();
      if (
        flight[1] !== 'offer' &&
        capability?.mode === 'live' &&
        capability.booking &&
        !request.verifiedUser &&
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)
      ) {
        throw failure('auth', 'ต้องยืนยันตัวตนก่อนทำรายการจองจริง');
      }
      step('Bop กำลังตรวจสอบข้อมูลเที่ยวบิน');
      emit({ type: 'done', ...(await flightOperation(flight[1], input, { signal, step, emit })) });
    } catch (error) {
      const code = [
        'bad_request',
        'auth',
        'rate_limit',
        'no_key',
        'offer_expired',
        'not_enabled',
        'price_changed',
        'unsupported_media_type',
      ].includes(error.code)
        ? error.code
        : 'upstream';
      emit({
        type: 'error',
        code,
        message: code === 'upstream' ? 'บริการเที่ยวบินทำรายการไม่สำเร็จ' : error.message,
        ...error.extra,
      });
    } finally {
      if (!signal.aborted) response.end();
    }
    return true;
  }
  try {
    let result;
    if (method === 'POST' && path === '/api/line/webhook')
      result = await lineTrips.webhook(await read(request, true), request.headers['x-line-signature']);
    else if (method === 'POST' && path === '/api/trips') result = await lineTrips.create(await read(request));
    else if (trip) {
      const action = routes.get(method + ' ' + (trip[2] || ''));
      if (!action) return false;
      const data = method === 'POST' ? await read(request) : {};
      result = ['identity', 'ballot'].includes(action)
        ? await lineTrips.participant(trip[1], action, data)
        : await lineTrips.organizer(trip[1], request.headers['x-bop-trip-token'], action, data);
    } else return false;
    json(response, 200, result);
  } catch (err) {
    const status = statuses[err.code] ?? 502;
    json(response, status, {
      error: err.code in statuses ? err.code : 'upstream',
      message: status === 502 ? 'Bop ติดต่อบริการไม่สำเร็จ' : err.message,
    });
  }
  return true;
}
