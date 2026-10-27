// LearnScribe LMS Service Worker
const CACHE_NAME = 'learnscribe-lms-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
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
  const url = new URL(req.url);

  // Stale-While-Revalidate for read-only GET API endpoints
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

  // Cache first for local static assets (scripts, styles, images)
  if (req.method === 'GET' && (url.origin === self.location.origin)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});

