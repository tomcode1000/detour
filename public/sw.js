// Detour service worker: keeps the app shell available so the installed app opens instantly.
// Live data (/api, /events) always goes to the network.
const CACHE = 'detour-shell-v9';
const SHELL = [
  '/app', '/traveller', '/manager',
  '/app.css', '/app-core.js', '/traveller.js', '/manager.js', '/img/app/ada.jpg', '/img/app/hotel.jpg', '/img/app/company.jpg',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Android "Share -> Detour": keep what was shared, then open the traveller app's share sheet.
// Nothing is read by Detour until the traveller presses Send.
async function receiveShare(request) {
  const form = await request.formData();
  const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n\n');
  const image = form.get('image');
  const cache = await caches.open('detour-share');
  await cache.put('/shared/text', new Response(text));
  if (image && image.size) await cache.put('/shared/image', new Response(image));
  return Response.redirect('/traveller?shared', 303);
}

// Network first (so a new deploy shows straight away), the cached shell when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname === '/share-target') {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api') || url.pathname === '/events') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && SHELL.includes(url.pathname)) caches.open(CACHE).then((c) => c.put(url.pathname, res.clone()));
        return res;
      })
      .catch(() => caches.match(url.pathname).then((hit) => hit || caches.match('/app'))),
  );
});

// Tapping a Detour notification brings the open app forward, or opens it.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const app = wins.find((w) => /\/(traveller|manager)/.test(new URL(w.url).pathname));
    return app ? app.focus() : self.clients.openWindow('/app');
  }));
});
