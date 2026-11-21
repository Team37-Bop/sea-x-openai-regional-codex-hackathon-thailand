import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeSecrets } from './runtime-secrets.mjs';

await loadRuntimeSecrets();
export const { server, handleRequest } = await import('./http.mjs');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let host = process.env.HOST || '127.0.0.1';
  let port = Number(process.env.PORT) || 8787;
  try {
    const value = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
    const endpoint = new URL(value.includes('://') ? value : 'http://' + value);
    if (endpoint.hostname && endpoint.port) {
      host = endpoint.hostname;
      port = Number(endpoint.port);
    }
  } catch {
    /* Use the local bind settings. */
  }
  // When the development watcher restarts, finish accepted NDJSON streams first.
  process.once('SIGTERM', () => server.close());
  server.listen(port, host, () => console.log('Bop listening on ' + host + ':' + port));
}
