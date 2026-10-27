// App shell cached for offline/home-screen use; NBA data is always network-first.
const SHELL = "pixel-court-v1";
const FILES = ["./", "index.html", "style.css", "app.js", "manifest.json", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin === location.origin) {
    // Stale-while-revalidate for the app's own files.
    e.respondWith(caches.open(SHELL).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  } else if (url.hostname.endsWith("espn.com")) {
    // Network first, fall back to the last copy so the app still opens offline.
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open("pc-data").then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.open("pc-data").then(c => c.match(e.request))));
  }
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(cs => cs[0] ? cs[0].focus() : self.clients.openWindow("./")));
});
