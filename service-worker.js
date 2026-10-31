// Service Worker für „QA – Qualifizierte Assistenz“ (Verkaufsversion)
//
// Aufgabe: Die ganze App auf dem Gerät bereithalten, damit sie sich auch
// ohne Internet öffnet (Bauabschnitt 1 „Offline-Hülle“).
//
// Regeln:
// - Seiten (.html) und manifest.json: zuerst das Netz fragen (max. 4 Sekunden),
//   damit neue Versionen sofort ankommen. Ohne Netz: gespeicherte Fassung.
// - Bibliotheken, Symbole, Bilder, Schriften: aus dem Speicher, im Hintergrund
//   auffrischen (schnell und offline verfügbar).
// - Supabase, Netlify-Funktionen, Kartenkacheln und andere fremde Server:
//   nie anfassen, immer live.
//
// Bei jeder Lieferung CACHE_NAME erhöhen, dann wird alles neu geladen.

const CACHE_NAME = 'qa-produkt-0.8';
const NETZ_WARTEZEIT_MS = 4000;

const APP_DATEIEN = [
  './',
  './index.html',
  './dokumentation.html',
  './fahrtenbuch.html',
  './leistungsnachweis.html',
  './klientenbogen.html',
  './ausgaben.html',
  './manifest.json',
  './tresor.js',
  './lib/supabase.js',
  './lib/argon2.umd.min.js',
  './lib/qrcode.js',
  './lib/jsQR.js',
  './lib/html2canvas.min.js',
  './lib/jspdf.umd.min.js',
  './lib/leaflet/leaflet.js',
  './lib/leaflet/leaflet.css',
  './lib/leaflet/images/layers.png',
  './lib/leaflet/images/layers-2x.png',
  './lib/leaflet/images/marker-icon.png',
  './lib/leaflet/images/marker-icon-2x.png',
  './lib/leaflet/images/marker-shadow.png',
  './icons/icon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './bilder/hintergrund.jpg',
  './bilder/portrait-1.jpg',
  './bilder/portrait-2.jpg',
  './bilder/portrait-3.jpg',
  './bilder/portrait-4.jpg',
  './bilder/portrait-5.jpg',
  './schriften/bangers.woff'
];

// 1. Installation: alle App-Dateien speichern. Fehlt eine einzelne Datei,
//    werden die übrigen trotzdem gespeichert.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        APP_DATEIEN.map((datei) =>
          fetch(datei, { cache: 'reload' }).then((antwort) => {
            if (antwort.ok) return cache.put(datei, antwort);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

// 2. Aktivierung: alte Speicherstände löschen, sofort übernehmen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) =>
        Promise.all(
          namen
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

function istSeite(request, url) {
  return (
    request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('manifest.json')
  );
}

// Netz zuerst, aber nicht länger als NETZ_WARTEZEIT_MS warten
function netzZuerst(request) {
  return caches.open(CACHE_NAME).then((cache) => {
    const ausNetz = fetch(request).then((antwort) => {
      if (antwort && antwort.ok && antwort.type === 'basic') {
        cache.put(request, antwort.clone());
      }
      return antwort;
    });

    const ausSpeicher = () =>
      cache.match(request, { ignoreSearch: true }).then(
        (treffer) =>
          treffer ||
          (request.mode === 'navigate'
            ? cache.match('./index.html')
            : undefined)
      );

    const zeitlimit = new Promise((fertig) =>
      setTimeout(fertig, NETZ_WARTEZEIT_MS)
    ).then(ausSpeicher);

    return Promise.race([
      ausNetz,
      zeitlimit.then((treffer) => treffer || ausNetz)
    ]).catch(() =>
      ausSpeicher().then(
        (treffer) =>
          treffer ||
          new Response('Offline und nicht gespeichert.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          })
      )
    );
  });
}

// Aus dem Speicher, im Hintergrund auffrischen
function speicherZuerst(event) {
  const request = event.request;
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(request, { ignoreSearch: true }).then((treffer) => {
      const auffrischen = fetch(request)
        .then((antwort) => {
          if (antwort && antwort.ok && antwort.type === 'basic') {
            cache.put(request, antwort.clone());
          }
          return antwort;
        })
        .catch(() => undefined);
      if (treffer) {
        event.waitUntil(auffrischen);
        return treffer;
      }
      return auffrischen.then(
        (antwort) =>
          antwort ||
          new Response('', { status: 503 })
      );
    })
  );
}

// 3. Anfragen abfangen
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Fremde Server (Supabase, Karten, Cloud) und Netlify-Funktionen: immer live
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/')) return;

  if (istSeite(request, url)) {
    event.respondWith(netzZuerst(request));
  } else {
    event.respondWith(speicherZuerst(event));
  }
});
