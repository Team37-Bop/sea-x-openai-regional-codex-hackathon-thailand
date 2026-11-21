import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

const maplibreWorker = {
  name: 'maplibre-worker-asset',
  async closeBundle() {
    const target = resolve(process.cwd(), 'dist/assets');
    await mkdir(target, { recursive: true });
    await copyFile(
      resolve(process.cwd(), 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'),
      resolve(target, 'maplibre-gl-worker.mjs'),
    );
  },
};

// /api/* runs inside the Vite dev server (same port). loadEnv with prefix ''
// reads .env.local into this server-side config; Vite exposes only VITE_* to browser code.
export default defineConfig(async ({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  // Import after environment setup because backend modules read tuning values at initialization.
  const { createApi } = await import('./server/api.mjs');
  const opts = {
    apiKey: env.ANTHROPIC_API_KEY,
    openaiKey: env.OPENAI_API_KEY || env.OPENAI_APIKEY,
    fake: env.BOP_FAKE_LLM === '1',
    provider: env.BOP_PROVIDER,
    claudeBin: env.BOP_CLAUDE_BIN,
  };
  return {
    build: {
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          liff: resolve(process.cwd(), 'liff.html'),
        },
      },
    },
    plugins: [maplibreWorker, {
      name: 'bop-api',
      configureServer(server) {
        const api = createApi(opts);
        server.middlewares.use((req, res, next) => api(req, res, next));
      },
      configurePreviewServer(server) {
        const api = createApi(opts);
        server.middlewares.use((req, res, next) => api(req, res, next));
      },
    }],
  };
});
