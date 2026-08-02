const CACHE_NAME = 'nook-shell-v2';
const SHELL_FILES = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only manage requests for our own shell files. Everything else
  // (Open-Meteo weather calls, geocoding, Google Fonts) passes straight
  // through to the network untouched.
  if (url.origin !== self.location.origin) return;

  // Network-first: always try to get the latest version when online.
  // Only fall back to the cached copy if there's no connection at all.
  // (The old cache-first version was the bug — it kept serving whatever
  // was cached on the very first visit and never picked up updates.)
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
