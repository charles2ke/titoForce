// Service worker of the installable web app (PWA): it keeps the app shell (index.html and the fingerprinted /assets files) so the app
// starts fast and opens without a network. Data is never cached: /api/ responses belong to one user of one organization.
const SHELL = 'titoforce-shell-v1';
const ASSETS = 'titoforce-assets-v1';
const MAX_ASSETS = 200;

self.addEventListener('install', (event) => {
  event.waitUntil(precache().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('titoforce-') && key !== SHELL && key !== ASSETS) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') event.respondWith(navigate(request));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(asset(request));
});

/** Caches index.html and the files it loads, so the first offline start works too. */
async function precache() {
  const response = await fetch('/', { cache: 'no-cache' });
  if (!response.ok || response.redirected) return;
  const html = await response.clone().text();
  await (await caches.open(SHELL)).put('/', response);
  const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await (await caches.open(ASSETS)).addAll(files);
}

/** Every route of the single-page app is index.html: the network's when online, the cached copy otherwise. */
async function navigate(request) {
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected && response.headers.get('content-type')?.includes('text/html')) {
      await (await caches.open(SHELL)).put('/', response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match('/', { cacheName: SHELL });
    if (cached) return cached;
    throw err;
  }
}

/** Files under /assets/ have a content hash in their name, so a cached copy never goes stale. */
async function asset(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
  }
  return response;
}
