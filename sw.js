const CACHE_PREFIX = 'stardex-offline-';
const CACHE_NAME = `${CACHE_PREFIX}v5.0.0`;
const PRECACHE_PATHS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './data/maplestar.seed.json',
  './js/app.js',
  './js/config.js',
  './js/schema.js',
  './js/storage.js'
];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;
const scopedRequest = (path) => new Request(scopeUrl(path), { cache: 'reload' });

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_PATHS.map(scopedRequest)))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, fallbackPath) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fallback = await caches.match(scopeUrl(fallbackPath));
    if (fallback) return fallback;
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (requestUrl.origin !== scope.origin || !requestUrl.pathname.startsWith(scope.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, './index.html'));
    return;
  }
  if (requestUrl.pathname.endsWith('/data/maplestar.seed.json')) {
    event.respondWith(networkFirst(event.request, './data/maplestar.seed.json'));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});
