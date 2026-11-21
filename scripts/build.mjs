import { copyFile, cp, lstat, mkdir, rm, stat } from 'node:fs/promises';
import { build } from 'esbuild';
await rm('dist', { force: true, recursive: true });
await mkdir('dist/assets', { recursive: true });
// The release only contains reviewed public files. Reject symlinks at each allowlisted path.
const publicFiles = [
  'app.js',
  'assets/anuphan-ofl.txt',
  'assets/anuphan-variable.woff2',
  'booking-tasks.css',
  'booking-tasks.js',
  'lodging-state.js',
  'candidate-survey.css',
  'flight-panel.js',
  'forecast.js',
  'index.html',
  'integration-ui.js',
  'itinerary-facts.js',
  'leg-modes.js',
  'liff.html',
  'liff.js',
  'location-suggest.css',
  'location-suggest.js',
  'map.js',
  'operation-trace.js',
  'place-details.css',
  'place-details.js',
  'plan-review.css',
  'plan-review.js',
  'planner-theme.css',
  'sample-place-details.js',
  'saved-map.js',
  'setup-extras.js',
  'stop-note.js',
  'stream.js',
  'style.css',
  'transport-endpoints.js',
  'trip-integrations.js',
  'workspace-controls.js',
];
for (const name of publicFiles) {
  const source = 'web/' + name;
  if (!(await lstat(source)).isFile()) throw Error('Expected a regular file at ' + source);
  await copyFile(source, 'dist/' + name);
}
for (const name of [
  'maplibre-gl.mjs',
  'maplibre-gl-shared.mjs',
  'maplibre-gl-worker.mjs',
  'maplibre-gl.css',
]) {
  await cp('node_modules/maplibre-gl/dist/' + name, 'dist/assets/' + name);
}
await cp('node_modules/maplibre-gl/LICENSE.txt', 'dist/assets/maplibre-license.txt');
await build({
  stdin: { contents: "export {default} from '@line/liff'", resolveDir: process.cwd() },
  bundle: true,
  minify: true,
  format: 'esm',
  outfile: 'dist/assets/liff.js',
});
if (!(await stat('dist/assets/maplibre-gl-worker.mjs')).size) throw new Error('Empty MapLibre worker');
// Keep a locally usable sample when the application API is unreachable.
const { demoSetup } = await import('../server/http.mjs');
const { planTrip } = await import('../server/plan.mjs');
const sample = await planTrip(
  demoSetup('2026-11-20'),
  { signal: new AbortController().signal, emit() {}, step() {}, usage: {} },
  true,
);
const { writeFile } = await import('node:fs/promises');
await writeFile(
  'dist/assets/sample.json',
  JSON.stringify({ plan: sample.plan, routes: sample.routes, summary: sample.summary }),
);
await build({
  stdin: { contents: "export {replan} from './server/plan.mjs'", resolveDir: process.cwd() },
  bundle: true,
  format: 'esm',
  outfile: 'dist/assets/sample-replan.js',
  plugins: [
    {
      name: 'offline-sample',
      setup(bundler) {
        bundler.onResolve({ filter: /^\.\/(model|candidates|geo|flights)\.mjs$/ }, () => ({
          path: process.cwd() + '/scripts/sample-services.mjs',
        }));
      },
    },
  ],
});

// Published assets are cached for a year. Give application-generated files content-specific URLs.
const { createHash } = await import('node:crypto');
const { readFile } = await import('node:fs/promises');
for (const [asset, consumer] of [
  ['sample.json', 'app.js'],
  ['sample-replan.js', 'app.js'],
  ['liff.js', 'liff.js'],
]) {
  const content = await readFile('dist/assets/' + asset);
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const versioned = asset.replace(/(\.[^.]+)$/, '-' + digest + '$1');
  await writeFile('dist/assets/' + versioned, content);
  const source = await readFile('dist/' + consumer, 'utf8');
  await writeFile('dist/' + consumer, source.replaceAll('/assets/' + asset, '/assets/' + versioned));
}
