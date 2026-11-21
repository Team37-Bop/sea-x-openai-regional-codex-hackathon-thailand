import { copyFile, lstat, mkdir, rm } from 'node:fs/promises';
await rm('dist', { force: true, recursive: true });
await mkdir('dist', { recursive: true });
for (const name of ['index.html', 'app.js', 'style.css']) {
  const source = `web/${name}`;
  if (!(await lstat(source)).isFile()) throw new Error(`Expected a regular file at ${source}`);
  await copyFile(source, `dist/${name}`);
}
console.log('Built web assets in dist/');
