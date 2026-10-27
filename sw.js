// App shell cached for offline/home-screen use; NBA data is always network-first.
const SHELL = "pixel-court-v2";
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
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Pixel Court", {
    body: d.body || "Your morning NBA recap is ready.", icon: "icon-192.png", badge: "icon-192.png",
    tag: "morning-recap", data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(cs => {
    const c = cs.find(c => c.url.startsWith(self.registration.scope));
    return c ? c.navigate(url).then(c => c && c.focus()) : self.clients.openWindow(url);
  }));
});
