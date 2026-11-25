/* BibleBetter push notifications (imported by the generated service worker). */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'BibleBetter', body: event.data && event.data.text() }; }
  const base = self.registration.scope;
  event.waitUntil(self.registration.showNotification(d.title || 'BibleBetter', {
    body: d.body || '',
    icon: base + 'icon-192.png',
    badge: base + 'icon-192.png',
    tag: d.kind || 'bb',
    renotify: true,
    data: { url: base + (d.path || '?open=today'), kind: d.kind, fn: d.fn },
    actions: d.actions || [{ action: 'open', title: 'Open today’s reading' }, { action: 'snooze', title: 'Snooze 1 hour' }],
  }));
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = n.data || {};
  n.close();
  if (event.action === 'snooze' && data.fn) {
    event.waitUntil(self.registration.pushManager.getSubscription().then((sub) =>
      fetch(data.fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snooze: data.kind, endpoint: sub && sub.endpoint }) })));
    return;
  }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(data.url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(data.url);
  }));
});
