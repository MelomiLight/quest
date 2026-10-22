// Offline-first app shell. Bump VERSION when files are added or removed.
const VERSION = 'q2';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'data.js', 'ai.js', 'icons.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
const NETWORK_TIMEOUT = 2500; // after this the app opens from cache — weak/no internet must never mean a white screen
// Once the network has timed out, the rest of this launch goes straight to the cache
let slowUntil = 0;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Safari refuses redirected responses for page loads, so store a clean copy
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isPage = req.mode === 'navigate';
  const key = isPage ? './' : req;

  // Always refresh the cache from the network in the background
  const network = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then(clean)
    .then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(key, copy)); }
      return res;
    });
  e.waitUntil(network.catch(() => {}));

  const cached = caches.match(key, { ignoreSearch: true });
  const wait = Date.now() < slowUntil ? 0 : NETWORK_TIMEOUT;
  const timeout = new Promise(r => setTimeout(() => { if (wait) slowUntil = Date.now() + 15000; r(); }, wait));

  e.respondWith((async () => {
    // Fresh files when the network answers quickly, otherwise the cached app
    const fast = await Promise.race([network.catch(() => null), timeout]);
    if (fast && fast.ok) { slowUntil = 0; return fast; }
    const hit = await cached;
    if (hit) return hit;
    return network; // nothing cached yet — wait for the network after all
  })());
});
