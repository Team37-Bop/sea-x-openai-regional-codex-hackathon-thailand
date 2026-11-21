// API Gateway REST API response-streaming adapter for the existing Node HTTP API.
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { loadRuntimeSecrets } from './runtime-secrets.mjs';

let apiPromise;
async function getApi() {
  if (!apiPromise) {
    apiPromise = (async () => {
      const loaded = await loadRuntimeSecrets();
      if (loaded.length) console.info(`[bop] loaded ${loaded.length} runtime secret fields`);
      // The model module selects its provider and API key when it is imported.
      const { handleRequest } = await import('./index.mjs');
      return handleRequest;
    })().catch(error => {
      // Let a later invocation retry after transient Secrets Manager failures.
      apiPromise = undefined;
      throw error;
    });
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
  for (const [key, value] of Object.entries(event.queryStringParameters || {})) {
    if (!params.has(key) && value != null) params.append(key, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function requestHeaders(event) {
  const headers = {};
  for (const [key, value] of Object.entries(event.headers || {})) headers[key.toLowerCase()] = value;
  for (const [key, values] of Object.entries(event.multiValueHeaders || {})) {
    if (values?.length) headers[key.toLowerCase()] = values.join(', ');
  }
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
  get writableFinished() { return this.rawStream.writableFinished; }

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

  const body = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
    : Buffer.alloc(0);
  const request = Readable.from(body.length ? [body] : []);
  request.url = requestUrl(event);
  request.method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  request.headers = requestHeaders(event);

  const handleRequest = await getApi();
  const response = new LambdaResponse(responseStream, runtime.HttpResponseStream.from);
  await Promise.all([
    finished(responseStream, { readable: false, cleanup: true }),
    handleRequest(request, response),
  ]);
}

async function streamingHandler(event, responseStream, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  await handleApiGatewayEvent(event, responseStream);
}

export const handler = typeof globalThis.awslambda?.streamifyResponse === 'function'
  ? globalThis.awslambda.streamifyResponse(streamingHandler)
  : streamingHandler;
