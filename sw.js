const CACHE = 'cercacasa-50f5a7ce';
const ASSETS = [
  './',
  './index.html',
  './css/style.css?v=bb09949d',
  './js/app.js?v=ffaa2daa',
  './vendor/leaflet.js?v=35b48eb9',
  './vendor/leaflet.css?v=c02c12fe',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' evita che il precache riprenda la copia vecchia
      // dalla cache HTTP (GitHub Pages serve con max-age=600)
      .then(c => Promise.all(ASSETS.map(u =>
        fetch(u, { cache: 'reload' }).then(r => c.put(u, r)).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;

  // Dati annunci: sempre rete (con fallback cache per l'offline)
  if (e.request.url.includes('/data/annunci.json')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // HTML: prima la rete (per gli aggiornamenti), cache come fallback offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Codice (css/js): prima la rete, così gli aggiornamenti si vedono subito;
  // la cache resta come riserva offline.
  if (/\.(css|js)$/.test(new URL(e.request.url).pathname)) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Immagini e altri asset: prima la cache (non cambiano quasi mai)
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached ||
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
    )
  );
});

// ---------- Notifiche di case nuove ----------
// Il server (Railway) manda l'avviso; qui lo si mostra. Se il messaggio
// arriva senza testo, si va comunque a leggere i dati per dire qualcosa.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { /* payload assente */ }
  const titolo = d.titolo || 'Case nuove su Cerca Casa';
  const opzioni = {
    body: d.corpo || 'Apri per vedere le novità.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'case-nuove',
    renotify: true,
    data: { url: d.url || './' },
  };
  e.waitUntil(self.registration.showNotification(titolo, opzioni));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || './';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    // se l'app è già aperta la porto in primo piano invece di aprirne un'altra
    for (const c of lista) {
      if (c.url.includes('cerca-casa') && 'focus' in c) return c.focus();
    }
    return clients.openWindow(url);
  }));
});
