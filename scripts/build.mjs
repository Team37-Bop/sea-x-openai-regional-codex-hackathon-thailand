import { createHash } from 'node:crypto';
import { copyFile, cp, lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
await rm('dist', { force: true, recursive: true });
await mkdir('dist/assets', { recursive: true });
// The release only contains reviewed public files. Reject symlinks at each allowlisted path.
const publicFiles = [
  'app.js',
  'assets/anuphan-ofl.txt',
  'assets/anuphan-variable.woff2',
  'booking-tasks.css',
  'booking-tasks.js',
  'lodging-chooser.css',
  'lodging-chooser.js',
  'lodging-state.js',
  'candidate-survey.css',
  'check-presentation.js',
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
  'trip-tools.js',
  'workspace-controls.js',
];
for (const name of publicFiles) {
  const source = 'web/' + name;
  if (!(await lstat(source)).isFile()) throw Error('Expected a regular file at ' + source);
  await copyFile(source, 'dist/' + name);
}
const mapAssets = [
  'maplibre-gl.mjs',
  'maplibre-gl-shared.mjs',
  'maplibre-gl-worker.mjs',
  'maplibre-gl.css',
];
for (const name of mapAssets) {
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
for (const [asset, consumer] of [
  ['sample.json', 'app.js'],
  ['sample-replan.js', 'app.js'],
  ['liff.js', 'liff.js'],
  ['anuphan-variable.woff2', 'planner-theme.css'],
]) {
  const content = await readFile('dist/assets/' + asset);
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const versioned = asset.replace(/(\.[^.]+)$/, '-' + digest + '$1');
  await writeFile('dist/assets/' + versioned, content);
  const source = await readFile('dist/' + consumer, 'utf8');
  await writeFile('dist/' + consumer, source.replaceAll('/assets/' + asset, '/assets/' + versioned));
}

// Keep the vendor modules and worker together so their relative imports resolve.
const mapDigest = createHash('sha256');
for (const name of mapAssets) mapDigest.update(name).update(await readFile('dist/assets/' + name));
const mapDirectory = 'assets/maplibre-' + mapDigest.digest('hex').slice(0, 12);
await mkdir('dist/' + mapDirectory);
let mapSource = await readFile('dist/map.js', 'utf8');
for (const name of mapAssets) {
  await copyFile('dist/assets/' + name, 'dist/' + mapDirectory + '/' + name);
  mapSource = mapSource.replaceAll('/assets/' + name, '/' + mapDirectory + '/' + name);
}
await writeFile('dist/map.js', mapSource);

// Bundle each load phase, keeping shared modules at their public URLs. An open
// planner can still import its lazy entry after a deployment.
const browserBuild = {
  bundle: true, format: 'esm', minify: true, charset: 'utf8', target: 'es2022',
  outdir: 'dist', allowOverwrite: true, external: ['/assets/*'],
};
const graph = await build({
  ...browserBuild, entryPoints: ['dist/app.js'], splitting: true, write: false, metafile: true,
});
const modules = new Set();
for (const output of Object.values(graph.metafile.outputs)) {
  for (const input of output.entryPoint ? [output.entryPoint] : Object.keys(output.inputs)) modules.add(input);
}
const moduleUrls = [...modules].map(file => './' + file.slice('dist/'.length));
await build({
  ...browserBuild, entryPoints: [...modules], external: [...browserBuild.external, ...moduleUrls],
});

let html = await readFile('dist/index.html', 'utf8');
const styleTags = [...html.matchAll(/<link rel="stylesheet" href="\/(\w[\w-]*\.css)"\s*\/?>/g)];
const styles = await Promise.all(styleTags.map(([, name]) => readFile('dist/' + name, 'utf8')));
const css = await transform(styles.join('\n'), { loader: 'css', minify: true, charset: 'utf8' });
await writeFile('dist/planner.css', css.code);
for (const [index, [tag]] of styleTags.entries())
  html = html.replace(tag, index === 0 ? '<link rel="stylesheet" href="/planner.css" />' : '');
await writeFile('dist/index.html', html);
