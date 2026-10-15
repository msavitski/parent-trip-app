/* Offline support: keeps the app and the encrypted trip on the phone. */
const CACHE = 'our-trip-v3';
const CORE = ['./', 'index.html', 'app.js', 'trip.enc', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page, the code, the trip and translations: try the network for 3 seconds, otherwise use the saved copy.
// Translation files are saved the first time the app loads them.
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(reject, 3000))]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' && await cache.match('index.html'))
      || Response.error();
  }
}

// Icons and fonts: the saved copy first.
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !font) return;   // weather API: always live, the app keeps its own copy
  const fresh = !font && (req.mode === 'navigate' || /(\.html|\.js|\.json|\.enc|\/)$/.test(url.pathname));
  e.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});
