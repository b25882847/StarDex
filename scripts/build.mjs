import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
if (dirname(output) !== root || basename(output) !== 'dist') throw new Error('拒絕清除非專案 dist 目錄');

const publicFiles = [
  'index.html', 'styles.css', 'manifest.json', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'data/maplestar.seed.json', 'js/app.js', 'js/config.js', 'js/schema.js', 'js/storage.js'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const relative of publicFiles) {
  const destination = join(output, relative);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(root, relative), destination);
}
await writeFile(join(output, '.nojekyll'), '', 'utf8');
console.log(`Built ${publicFiles.length + 1} public files in ${output}`);
