// Service Worker fuer "Qualifizierte Assistenz All Inclusiv"
// Strategie: NETWORK FIRST - das Netz gewinnt immer.
// Der Cache ist nur ein Notfall-Fallback, wenn kein Internet da ist.
// Dadurch bekommst du nach jedem Netlify-Deploy sofort die neue Version.

const CACHE_NAME = 'qa-all-inclusiv-v1';

// Diese Dateien werden beim ersten Start als Offline-Reserve gespeichert.
// Wenn du weitere Seiten hast, hier ergaenzen.
const OFFLINE_DATEIEN = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 1. Installation: Offline-Reserve anlegen, sofort aktiv werden
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(OFFLINE_DATEIEN))
      .catch(() => null)
  );
  self.skipWaiting();
});

// 2. Aktivierung: alte Caches loeschen, sofort Kontrolle uebernehmen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((namen) =>
      Promise.all(
        namen
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// 3. Anfragen abfangen
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Nur normale GET-Anfragen behandeln
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // WICHTIG: Supabase und andere fremde Server NIE anfassen.
  // Datenbank-Anfragen muessen immer live sein.
  if (url.origin !== self.location.origin) return;

  // Netzwerk zuerst, Cache nur als Fallback
  event.respondWith(
    fetch(request)
      .then((antwort) => {
        // Erfolgreiche Antwort als Offline-Reserve mitspeichern
        if (antwort && antwort.status === 200 && antwort.type === 'basic') {
          const kopie = antwort.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, kopie));
        }
        return antwort;
      })
      .catch(() => {
        // Kein Internet: aus der Reserve liefern
        return caches.match(request).then((treffer) => {
          if (treffer) return treffer;
          // Bei Seitenaufrufen notfalls die Startseite zeigen
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline und nicht im Zwischenspeicher.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
  );
});
