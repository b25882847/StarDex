import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
if (!dist.startsWith(`${root}${sep}`)) throw new Error('部署目錄不在專案內');

const expected = new Set([
  '.nojekyll', 'index.html', 'styles.css', 'manifest.json', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'data/maplestar.seed.json', 'js/app.js', 'js/config.js', 'js/schema.js', 'js/storage.js'
]);
const forbiddenName = /(^|\/)(?:\.env(?:\..*)?|private|backups?|screenshots?)(\/|$)|\.(?:pem|key|p12|pfx)$|stardex-.*\.json$/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /aws_secret_access_key\s*[:=]/i
];
const textExtensions = new Set(['.html', '.css', '.js', '.json', '.svg', '']);
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else files.push(relative(dist, fullPath).replaceAll('\\', '/'));
  }
}

await walk(dist);
const unexpected = files.filter((file) => !expected.has(file));
const missing = [...expected].filter((file) => !files.includes(file));
if (unexpected.length) throw new Error(`部署產物含非白名單檔案：${unexpected.join(', ')}`);
if (missing.length) throw new Error(`部署產物缺少檔案：${missing.join(', ')}`);

for (const file of files) {
  if (forbiddenName.test(file)) throw new Error(`部署產物含敏感檔名：${file}`);
  if (!textExtensions.has(extname(file))) continue;
  const content = await readFile(join(dist, file), 'utf8');
  for (const pattern of secretPatterns) if (pattern.test(content)) throw new Error(`部署產物疑似含憑證：${file}`);
}

const seed = JSON.parse(await readFile(join(dist, 'data/maplestar.seed.json'), 'utf8'));
if ((seed.evidence || []).length) throw new Error('公開種子資料不可包含玩家私人證據');
if ((seed.prices || []).length) throw new Error('公開種子資料不可包含玩家價格紀錄');
if (JSON.stringify(seed).includes('screenshotDataUrl')) throw new Error('公開種子資料不可包含本機截圖');

const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
const base = new URL('https://example.github.io/StarDex/');
for (const value of [manifest.id, manifest.start_url, manifest.scope, ...manifest.icons.map((icon) => icon.src)]) {
  const resolved = new URL(value, base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) throw new Error(`manifest 子路徑不安全：${value}`);
}
for (const icon of manifest.icons) await stat(join(dist, new URL(icon.src, base).pathname.slice(base.pathname.length)));

const html = await readFile(join(dist, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:href|src)="(\.\/?[^"#?]+)"/g)) {
  const asset = match[1].replace(/^\.\//, '');
  await stat(join(dist, asset));
  const resolved = new URL(match[1], base);
  if (!resolved.pathname.startsWith(base.pathname)) throw new Error(`HTML 資源離開子路徑：${match[1]}`);
}
console.log(`Public artifact OK: ${files.length} allow-listed files, /StarDex/ paths resolved, no local evidence or common secret pattern found`);
