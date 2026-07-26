/**
 * Service Worker for Push Notifications
 * Handles incoming push messages and displays notifications
 */

// Listen for push events
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'Notification',
      body: event.data.text(),
    };
  }

  const { title, body, data = {} } = payload;

  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.type || 'notification',
    data,
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Listen for notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { data } = event.notification;
  const url = data?.url || '/app';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a client with the target URL
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }

      // If not, open a new window/tab
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// Handle service worker updates
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Keep only recent caches
          if (cacheName.startsWith('v')) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Handle fetch events (if needed for caching)
self.addEventListener('fetch', (event) => {
  // Implement caching strategy if needed
  // For now, just let the network handle it
});
