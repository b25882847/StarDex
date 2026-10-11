import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const packageJson = JSON.parse(read('package.json'));
const index = read('index.html');
const serviceWorker = read('sw.js');
const workflow = read('.github/workflows/deploy.yml');

test('v5 應用版本、manifest 與 HTML 入口一致', () => {
  assert.equal(packageJson.version, '5.0.0');
  assert.match(read('js/config.js'), /APP_VERSION = '5\.0\.0'/);
  assert.match(index, /href="\.\/manifest\.json"/);
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
});

test('manifest 圖示尺寸與檔案實際存在', () => {
  const sizes = manifest.icons.map((icon) => icon.sizes).sort();
  assert.deepEqual(sizes, ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    const path = new URL(`../${icon.src.replace(/^\.\//, '')}`, import.meta.url);
    assert.equal(fs.existsSync(path), true);
    const png = fs.readFileSync(path);
    const [expectedWidth, expectedHeight] = icon.sizes.split('x').map(Number);
    assert.equal(png.readUInt32BE(16), expectedWidth);
    assert.equal(png.readUInt32BE(20), expectedHeight);
  }
});

test('所有入口資源在 GitHub Pages 子路徑內解析', () => {
  const base = new URL('https://example.github.io/StarDex/');
  for (const value of [manifest.id, manifest.start_url, manifest.scope, ...manifest.icons.map((icon) => icon.src)]) {
    const resolved = new URL(value, base);
    assert.equal(resolved.origin, base.origin);
    assert.equal(resolved.pathname.startsWith('/StarDex/'), true, value);
  }
  for (const match of index.matchAll(/(?:href|src)="(\.\/?[^"#?]+)"/g)) assert.equal(new URL(match[1], base).pathname.startsWith('/StarDex/'), true, match[1]);
});

test('Service Worker 使用 v5 scope 快取並等待使用者同意更新', () => {
  assert.match(serviceWorker, /stardex-offline-/);
  assert.match(serviceWorker, /v5\.0\.0/);
  assert.match(serviceWorker, /self\.registration\.scope/);
  assert.match(serviceWorker, /event\.data\?\.type === 'SKIP_WAITING'/);
  const installBlock = serviceWorker.slice(serviceWorker.indexOf("addEventListener('install'"), serviceWorker.indexOf("addEventListener('activate'"));
  assert.doesNotMatch(installBlock, /skipWaiting/);
  assert.doesNotMatch(serviceWorker, /localStorage|indexedDB\.deleteDatabase/);
});

test('GitHub Pages workflow 先測試與掃描，再只部署 dist', () => {
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run check:syntax/);
  assert.match(workflow, /run: npm run build/);
  assert.match(workflow, /run: npm run validate:public/);
  assert.match(workflow, /path: dist/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /force|git push/);
});
