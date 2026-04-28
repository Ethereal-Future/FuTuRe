const CACHE_NAME = 'stellar-app-v1';
const STATIC_ASSETS = ['/', '/index.html'];

// Install: cache static shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static assets
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // API calls: network-first, queue if offline
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'You are offline. Request queued.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return res;
    }))
  );
});

// Background sync: notify the client to prompt for secret key re-entry.
// Queued items contain only the payment intent (no secret key), so the SW
// cannot replay them autonomously — the user must authorise each one.
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-transactions') {
    e.waitUntil(notifyClientToReplay());
  }
});

async function notifyClientToReplay() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: 'REPLAY_QUEUED_PAYMENTS' });
  }
}

// Minimal IndexedDB helper
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('stellar-offline', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('pending-transactions', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => {
      const db = req.result;
      resolve({
        getAll: (store) => new Promise((res, rej) => {
          const tx = db.transaction(store, 'readonly');
          const r = tx.objectStore(store).getAll();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        }),
        delete: (store, id) => new Promise((res, rej) => {
          const tx = db.transaction(store, 'readwrite');
          const r = tx.objectStore(store).delete(id);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        }),
      });
    };
    req.onerror = () => reject(req.error);
  });
}

// Push notifications
self.addEventListener('push', (e) => {
  const data = e.data?.json() ?? { title: 'Stellar', body: 'New notification' };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  );
});

// App update notification
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
