// Offline support: cache the app files, serve them from cache first.
// Bump VERSION whenever any file below changes so phones pick up the update.
const VERSION = 'v5';
const CACHE = 'budget-planner-' + VERSION;
const FILES = [
  './',
  './index.html',
  '../style.css',
  '../app.js',
  './manifest.json',
  '../icons/icon.svg',
  '../icons/icon-192.png',
  '../icons/icon-512.png',
  '../icons/icon-maskable-512.png',
  '../icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('budget-planner-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request))
  );
});
