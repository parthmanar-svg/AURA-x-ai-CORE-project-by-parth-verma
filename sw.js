// CORE service worker: app shell works offline; AI/network calls need internet.
const V = 'core-v28-offline-vision', KEEP = 'core-offvis-v1', SHELL = ['./', './index.html', './offvision.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const LIBS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'storage.googleapis.com'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== KEEP).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin && /\/(models|vendor)\//.test(u.pathname)) {   // offline-vision pack: cache first, never re-stored in the shell cache
    e.respondWith(caches.match(r).then(m => m || fetch(r)));
  } else if (u.origin === location.origin) {            // shell: network first, cache fallback (so updates land)
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); return res; }).catch(() => caches.match(r).then(m => m || caches.match('./index.html'))));
  } else if (LIBS.includes(u.hostname)) {        // libraries/fonts/models: cache first, refresh in background
    e.respondWith(caches.match(r).then(m => { const net = fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; }).catch(() => m); return m || net; }));
  }                                              // everything else (Puter AI, image gen, auth) goes straight to the network
});

// ---- background alerts: alarms mirrored into IndexedDB, fired by timer / periodic sync / sync ----
const idb = (m, k, v) => new Promise((res, rej) => { const o = indexedDB.open('core-bg', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onerror = rej;
  o.onsuccess = () => { const s = o.result.transaction('kv', m === 'get' ? 'readonly' : 'readwrite').objectStore('kv'); const r = m === 'get' ? s.get(k) : s.put(v, k); r.onsuccess = () => res(r.result); r.onerror = rej; }; });
async function due() { const a = (await idb('get', 'alarms')) || [], now = Date.now(), d = a.filter(x => x.at <= now);
  if (d.length) { await idb('put', 'alarms', a.filter(x => x.at > now)); for (const x of d) await self.registration.showNotification('CORE', { body: x.label, tag: String(x.id), requireInteraction: true, vibrate: [200, 100, 200] }); } }
const timers = {};
self.addEventListener('message', e => { const m = e.data || {}; if (m.type !== 'alarms') return;
  e.waitUntil(idb('put', 'alarms', m.alarms)); Object.values(timers).forEach(clearTimeout);
  m.alarms.forEach(a => { const ms = a.at - Date.now(); if (ms > 0 && ms < 3e5) timers[a.id] = setTimeout(due, ms + 50); }); });
self.addEventListener('periodicsync', e => { if (e.tag === 'core-due') e.waitUntil(due()); });
self.addEventListener('sync', e => { if (e.tag === 'core-due') e.waitUntil(due()); });
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.matchAll({ type: 'window' }).then(l => l[0] ? l[0].focus() : clients.openWindow('./index.html'))); });
