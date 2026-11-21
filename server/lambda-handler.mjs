// API Gateway REST API response-streaming adapter for the existing Node HTTP API.
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { loadRuntimeSecrets } from './runtime-secrets.mjs';
import { setSecurityHeaders } from './security.mjs';

let apiPromise;
async function getApi() {
  if (!apiPromise) {
    apiPromise = (async () => {
      const loaded = await loadRuntimeSecrets();
      if (loaded.length) console.info(`[bop] loaded ${loaded.length} runtime secret fields`);
      const { createApi } = await import('./api.mjs');
      return createApi({
        apiKey: process.env.ANTHROPIC_API_KEY,
        openaiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY,
        fake: process.env.BOP_FAKE_LLM === '1',
        provider: process.env.BOP_PROVIDER,
        claudeBin: process.env.BOP_CLAUDE_BIN,
      });
    })();
  }
  return apiPromise;
}

function requestUrl(event) {
  const path = event.path || event.rawPath || '/';
  if (event.rawQueryString) return `${path}?${event.rawQueryString}`;
  const params = new URLSearchParams();
  for (const [key, values] of Object.entries(event.multiValueQueryStringParameters || {})) {
    for (const value of values || []) params.append(key, value);
  }
  if (![...params].length) {
    for (const [key, value] of Object.entries(event.queryStringParameters || {})) {
      if (value != null) params.append(key, value);
    }
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function requestHeaders(event) {
  const headers = {};
  for (const [key, value] of Object.entries(event.headers || {})) headers[key.toLowerCase()] = value;
  return headers;
}

class LambdaResponse extends EventEmitter {
  constructor(rawStream, responseFactory) {
    super();
    this.rawStream = rawStream;
    this.responseFactory = responseFactory;
    this.headers = new Map();
    this.statusCode = 200;
    this.stream = null;
    this.writableEnded = false;
    rawStream.on?.('close', () => this.emit('close'));
  }

  setHeader(name, value) { this.headers.set(String(name).toLowerCase(), { name, value: String(value) }); }
  hasHeader(name) { return this.headers.has(String(name).toLowerCase()); }
  getHeader(name) { return this.headers.get(String(name).toLowerCase())?.value; }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    this.flushHeaders();
    return this;
  }

  flushHeaders() {
    if (this.stream) return;
    const headers = Object.fromEntries([...this.headers.values()].map(({ name, value }) => [name, value]));
    this.stream = this.responseFactory(this.rawStream, { statusCode: this.statusCode, headers });
  }

  write(chunk) {
    if (this.writableEnded) return false;
    this.flushHeaders();
    return this.stream.write(chunk);
  }

  end(chunk) {
    if (this.writableEnded) return;
    if (chunk !== undefined) this.write(chunk);
    else this.flushHeaders();
    this.writableEnded = true;
    this.stream.end();
  }
}

export async function handleApiGatewayEvent(event, responseStream, runtime = globalThis.awslambda) {
  if (!runtime?.HttpResponseStream?.from) throw new Error('Lambda response-streaming runtime is unavailable');
  const response = new LambdaResponse(responseStream, runtime.HttpResponseStream.from);
  setSecurityHeaders(response);

  const body = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
    : Buffer.alloc(0);
  const request = Readable.from(body.length ? [body] : []);
  request.url = requestUrl(event);
  request.method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  request.headers = requestHeaders(event);

  const api = await getApi();
  await api(request, response, () => {
    if (!response.writableEnded) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
    }
  });
  if (!response.writableEnded) response.end();
}

async function streamingHandler(event, responseStream, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  await handleApiGatewayEvent(event, responseStream);
}

export const handler = typeof globalThis.awslambda?.streamifyResponse === 'function'
  ? globalThis.awslambda.streamifyResponse(streamingHandler)
  : streamingHandler;
