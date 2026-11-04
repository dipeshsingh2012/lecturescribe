// LearnScribe LMS Service Worker
const CACHE_NAME = 'learnscribe-lms-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || !req.url) return;
  const url = new URL(req.url);

  // 1. Navigation / Document requests: ALWAYS Network-First with cache fallback
  // This prevents stale index.html from requesting non-existent hashed bundles
  if (req.mode === 'navigate' || req.destination === 'document' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html') || caches.match('/')))
    );
    return;
  }

  // 2. Stale-While-Revalidate for read-only GET API endpoints
  if (
    req.method === 'GET' &&
    (url.pathname.startsWith('/api/course/') ||
      url.pathname.startsWith('/api/calendar/events') ||
      url.pathname.startsWith('/api/videos/'))
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedRes = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              cache.put(req, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() => cachedRes);
        return cachedRes || fetchPromise;
      })
    );
    return;
  }

  // 3. Static hashed assets (scripts, styles) under /assets/
  if (req.method === 'GET' && url.origin === self.location.origin) {
    if (url.pathname.startsWith('/assets/')) {
      event.respondWith(
        caches.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              const resClone = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
            }
            return networkRes;
          });
        })
      );
      return;
    }

    // Default network-first for other origin requests
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
  }
});
