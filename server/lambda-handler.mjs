import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { loadSecrets } from './runtime-secrets.mjs';

function requestFrom(event) {
  const req = Readable.from(
    event.body == null ? [] : [Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')],
  );
  req.method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  const authorizer = event.requestContext?.authorizer;
  req.verifiedUser = authorizer?.claims?.sub || authorizer?.jwt?.claims?.sub || authorizer?.principalId;
  req.headers = {};
  for (const [name, value] of Object.entries(event.headers || {}))
    req.headers[name.toLowerCase()] = String(value);
  const query = new URLSearchParams();
  for (const [key, values] of Object.entries(
    event.multiValueQueryStringParameters || event.queryStringParameters || {},
  )) {
    for (const value of Array.isArray(values) ? values : [values]) query.append(key, value);
  }
  const raw = event.rawQueryString ?? query.toString();
  req.url = (event.rawPath || event.path || '/') + (raw ? '?' + raw : '');
  return req;
}
class ResponseStream extends Writable {
  constructor(stream, wrap) {
    super();
    this.stream = stream;
    this.wrap = wrap;
    this.statusCode = 200;
    this.headers = {};
    this.headersSent = false;
    stream.on('error', (err) => this.destroy(err));
  }
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }
  writeHead(code, headers = {}) {
    this.statusCode = code;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    this.flushHeaders();
    return this;
  }
  flushHeaders() {
    if (this.headersSent) return;
    this.headersSent = true;
    this.stream = this.wrap(this.stream, { statusCode: this.statusCode, headers: this.headers });
  }
  _write(chunk, enc, next) {
    this.flushHeaders();
    this.stream.write(chunk, enc, next);
  }
  _final(next) {
    this.flushHeaders();
    this.stream.end(next);
  }
}
let app;
export async function invoke(event, output, wrap) {
  app ??= Promise.resolve()
    .then(loadSecrets)
    .then(() => import('./http.mjs'))
    .catch((error) => {
      app = undefined;
      throw error;
    });
  const { handleRequest } = await app;
  const response = new ResponseStream(output, wrap);
  const done = finished(response);
  await handleRequest(requestFrom(event), response);
  await done;
}
export const handler = globalThis.awslambda.streamifyResponse((event, output) =>
  invoke(event, output, (stream, metadata) => globalThis.awslambda.HttpResponseStream.from(stream, metadata)),
);
