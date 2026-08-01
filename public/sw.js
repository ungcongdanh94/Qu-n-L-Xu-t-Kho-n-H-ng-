// Service Worker - chay nen, tach biet voi trang web thong thuong.
// Nhiem vu duy nhat: nhan su kien 'push' tu server va hien thi thong bao he dieu hanh,
// hoat dong ke ca khi nguoi dung da dong het cac tab/trinh duyet.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Thông báo', body: '', url: '/' };
  try {
    data = event.data.json();
  } catch (err) {
    data.body = event.data ? event.data.text() : '';
  }

  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Thông báo', options));
});

// Khi nguoi dung bam vao thong bao: mo lai app (hoac focus tab dang mo san)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
