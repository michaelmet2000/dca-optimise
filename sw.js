// Service worker minimal : l'app s'ouvre hors ligne, mais les DONNÉES passent toujours par le réseau d'abord,
// pour ne jamais afficher un montant périmé quand une version plus récente existe.
// Augmenter VERSION à chaque modification des fichiers de l'app.
const VERSION = 'dca-v4';
const SHELL = [
  './', 'index.html', 'app.js', 'style.css', 'lien.html', 'lien.js',
  'lib/model.js', 'lib/format.js', 'lib/prefs.js', 'vendor/qrcode.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Tout passe par le réseau d'abord (code et données toujours à jour) ; le cache ne sert que hors ligne.
  // La page vérifie elle-même la date des données et signale un retard.
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
