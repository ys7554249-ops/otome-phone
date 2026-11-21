self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('notificationclick', e => {
  const charId = e.notification.data && e.notification.data.charId;
  e.notification.close();
  if (!charId) return;
  e.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ type: 'openChat', charId });
        return;
      }
    }
    const url = new URL('./index.html', self.registration.scope);
    url.searchParams.set('openChat', charId);
    await self.clients.openWindow(url.href);
  })());
});

self.addEventListener('fetch', e => {
  // 只接管 GET：POST/PUT 等交给浏览器原生处理，离线时让调用方拿到真正的网络错误，
  // 而不是一个"成功但空内容"的假响应。
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() => new Response('Offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    }))
  );
});
