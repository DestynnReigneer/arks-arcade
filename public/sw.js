'use strict';

// The arcade's service worker: it only handles notifications (arcade/push.js).
// It shows each one, and tapping it opens the page it points to on this arcade,
// reusing a window that's already open. Nothing is cached, so the arcade works
// exactly as it does without it.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Only pages on this arcade; anything else opens the home page.
function here(url) {
  try {
    const u = new URL(url || '', self.registration.scope);
    return u.origin === self.location.origin ? u.href : self.registration.scope;
  } catch { return self.registration.scope; }
}

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* not ours: show a plain one */ }
  const tag = typeof d.tag === 'string' ? d.tag : undefined;
  e.waitUntil(self.registration.showNotification(String(d.title || 'Arcade').slice(0, 60), {
    body: String(d.body || '').slice(0, 200),
    // A newer one for the same game replaces the older one, and still buzzes.
    tag, renotify: !!tag,
    icon: here('custom/brand/app-icon-192.png'),
    data: { url: here(d.url) }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const same = list.find(c => c.url === url);
    if (same) return same.focus();
    const any = list.find(c => 'navigate' in c);
    if (any) return any.navigate(url).then(c => (c || any).focus()).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
