// Offline shell. Pages and app code: fresh copy from the network when online, saved copy when offline.
// Large libraries and icons never change, so they are served straight from the saved copy.
const CACHE = 'police-defterim-v3';
const FILES = ['./', 'index.html', 'app.js', 'xlsx.full.min.js', 'manifest.webmanifest', 'pdf.min.js', 'pdf.worker.min.js', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => Promise.all(FILES.map(f => fetch(f, {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error(f); return c.put(f, r); })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const fixed = /\.min\.js$|\.png$/.test(url.pathname);
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, {ignoreSearch: true});
    if (fixed && hit) return hit;
    const net = fetch(e.request, {cache: 'no-cache'}).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    const fresh = hit ? await Promise.race([net, new Promise(r => setTimeout(() => r(null), 3000))]) : await net;
    return (fresh && fresh.ok ? fresh : hit) || fresh || (await c.match('index.html')) || Response.error();
  }));
});
