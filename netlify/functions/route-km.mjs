// route-km.mjs  (Version 1)
// Dieses Programm läuft auf den Servern von Netlify, nicht im Browser.
// Es berechnet die Länge einer Autofahrt über OpenRouteService
// (HeiGIT, Heidelberg). Der Zugangsschlüssel liegt nur hier auf dem
// Server (Netlify-Umgebungsvariable ORS_API_KEY) und ist im App-Code
// nicht sichtbar.
//
// Ablauf:
// 1. Prüfen, ob die Anfrage von einem angemeldeten Nutzer der App kommt
//    (Supabase-Anmeldung). Sonst könnte jeder das Tageskontingent verbrauchen.
// 2. Jede Adresse in Koordinaten umwandeln (Geocoding, nur Deutschland).
// 3. Strecke mit dem Auto über alle Punkte berechnen.
//
// Datensparsam: Die App schickt nur Adressen ohne Hausnummer, keine Namen.
// Hier wird nichts gespeichert.

const ORS = 'https://api.openrouteservice.org';

// Supabase-Projekt der App. Für die Verkaufsversion (Frankfurt) können
// die Werte über Netlify-Umgebungsvariablen ersetzt werden.
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://bhrygputoysiwchzlygn.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_6l1Zi_OcdlxKQgvJWhZWYQ_ZOn6_j1C';

const MAX_PUNKTE = 12;

export default async (request) => {
  if (request.method === 'GET') {
    return json(200, {
      status: 'Hilfsprogramm läuft.',
      version: 1,
      schluessel: Boolean(process.env.ORS_API_KEY)
    });
  }

  if (request.method !== 'POST') {
    return json(405, { fehler: 'Nur POST erlaubt.' });
  }

  const schluessel = process.env.ORS_API_KEY;
  if (!schluessel) {
    return json(503, {
      fehler: 'Der Zugangsschlüssel für OpenRouteService ist bei Netlify noch nicht eingetragen.'
    });
  }

  // 1. Anmeldung prüfen
  const anmeldung = request.headers.get('authorization') || '';
  if (!anmeldung.startsWith('Bearer ')) {
    return json(401, { fehler: 'Bitte in der App anmelden.' });
  }

  try {
    const pruefung = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_KEY, Authorization: anmeldung }
    });
    if (!pruefung.ok) {
      return json(401, { fehler: 'Anmeldung abgelaufen. Bitte neu anmelden.' });
    }
  } catch (problem) {
    return json(502, { fehler: 'Anmeldung konnte nicht geprüft werden.' });
  }

  let daten;
  try {
    daten = await request.json();
  } catch (problem) {
    return json(400, { fehler: 'Ungültige Anfrage.' });
  }

  const adressen = (Array.isArray(daten.adressen) ? daten.adressen : [])
    .map(a => String(a || '').trim().slice(0, 200))
    .filter(Boolean);

  if (adressen.length < 2) {
    return json(400, { fehler: 'Mindestens Start und Ziel werden gebraucht.' });
  }
  if (adressen.length > MAX_PUNKTE) {
    return json(400, { fehler: 'Höchstens ' + MAX_PUNKTE + ' Punkte pro Fahrt.' });
  }

  try {
    // 2. Adressen in Koordinaten umwandeln. Gleiche Adressen nur einmal.
    // Die Startadresse dient als Bezugspunkt, damit z. B. „Marktkauf"
    // in der Nähe gesucht wird und nicht irgendwo in Deutschland.
    const gefunden = new Map();
    let bezug = null;

    for (const adresse of adressen) {
      if (gefunden.has(adresse)) continue;

      const werte = new URLSearchParams({
        api_key: schluessel,
        text: adresse,
        'boundary.country': 'DE',
        size: '1'
      });
      if (bezug) {
        werte.set('focus.point.lon', String(bezug[0]));
        werte.set('focus.point.lat', String(bezug[1]));
      }

      const antwort = await fetch(ORS + '/geocode/search?' + werte.toString());
      if (antwort.status === 429) {
        return json(429, { fehler: 'Tageskontingent erreicht. Bitte später erneut versuchen.' });
      }
      const ergebnis = await antwort.json();
      const treffer = ergebnis && ergebnis.features && ergebnis.features[0];

      if (!treffer) {
        return json(404, { fehler: 'Adresse nicht gefunden: ' + adresse });
      }

      const punkt = treffer.geometry.coordinates;
      gefunden.set(adresse, {
        punkt,
        name: (treffer.properties && treffer.properties.label) || adresse
      });
      if (!bezug) bezug = punkt;
    }

    const punkte = adressen.map(a => gefunden.get(a));

    // 3. Strecke berechnen
    const route = await fetch(ORS + '/v2/directions/driving-car', {
      method: 'POST',
      headers: {
        Authorization: schluessel,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ coordinates: punkte.map(p => p.punkt) })
    });

    if (route.status === 429) {
      return json(429, { fehler: 'Tageskontingent erreicht. Bitte später erneut versuchen.' });
    }

    const routeDaten = await route.json();
    const meter =
      routeDaten && routeDaten.routes && routeDaten.routes[0] &&
      routeDaten.routes[0].summary && routeDaten.routes[0].summary.distance;

    if (!Number.isFinite(meter)) {
      const meldung =
        (routeDaten && routeDaten.error && (routeDaten.error.message || routeDaten.error)) ||
        'Keine Strecke gefunden.';
      return json(502, { fehler: 'Strecke nicht berechenbar: ' + meldung });
    }

    return json(200, {
      km: Math.round(meter / 100) / 10,
      punkte: punkte.map(p => p.name)
    });
  } catch (problem) {
    return json(502, { fehler: 'OpenRouteService nicht erreichbar: ' + problem.message });
  }
};

function json(status, inhalt) {
  return new Response(JSON.stringify(inhalt), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
