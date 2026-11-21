import { build } from 'esbuild';
import { chmod, cp, mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const destination = resolve('build/lambda');
if (!(await stat('dist/assets/maplibre-gl-worker.mjs')).size) throw Error('MapLibre worker missing');
await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });
await build({
  entryPoints: ['server/lambda-handler.mjs'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: join(destination, 'index.cjs'),
  define: { 'import.meta.url': 'moduleLocation' },
  banner: {
    js: "const moduleLocation = require('node:url').pathToFileURL(require('node:path').join(__dirname, 'server', 'index.mjs')).href;",
  },
});
await writeFile(join(destination, 'package.json'), '{"type":"commonjs"}\n');
await mkdir(join(destination, 'src'));
await cp('src/routes.json', join(destination, 'src/routes.json'));
const execution = spawnSync(process.execPath, ['scripts/check-package.mjs'], { stdio: 'inherit' });
if (execution.status !== 0) throw Error('Packaged health regression failed');
const epoch = Date.UTC(2000, 0, 1) / 1000;
async function normalize(path) {
  const entry = await stat(path);
  let bytes = entry.isFile() ? entry.size : 0;
  if (entry.isDirectory())
    for (const name of (await readdir(path)).sort()) bytes += await normalize(join(path, name));
  await chmod(path, entry.isDirectory() ? 0o755 : 0o644);
  await utimes(path, epoch, epoch);
  return bytes;
}
const bytes = await normalize(destination);
if (bytes > 250 * 1024 * 1024) throw Error('Package exceeds 250 MiB');
console.log('Packaged Lambda (' + bytes + ' bytes)');
