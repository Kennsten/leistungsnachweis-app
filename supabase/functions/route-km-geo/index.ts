// route-km-geo (Supabase Edge Function, Version 2)
// Gleiche Aufgabe und gleiche Antwort wie route-km, aber über Geoapify statt
// OpenRouteService (HeiGIT). Geoapify bietet einen Vertrag zur
// Auftragsverarbeitung (AVV) an, der Adressen ausdrücklich abdeckt.
//
// Anbieter: KEPTAGO LTD („Geoapify“), Paphos, Zypern (EU).
// Genutzt wird nur die EU-Adresse api-eu.geoapify.com: Verarbeitung in der EU,
// Server bei Hetzner (Deutschland, Finnland), Netz über BunnyCDN (Slowenien),
// nicht über Cloudflare.
//
// Der Zugangsschlüssel liegt nur hier als Secret GEOAPIFY_API_KEY und ist im
// App-Code nicht sichtbar.
//
// Ablauf:
// 1. Prüfen, ob die Anfrage von einem angemeldeten Nutzer kommt.
// 2. Jede Adresse in Koordinaten umwandeln (Adresssuche, nur Deutschland).
// 3. Strecke mit dem Auto über alle Punkte berechnen.
//
// Die App schickt nur Adressen, keine Namen und keinen Fahrtzweck.
// Hier wird nichts gespeichert und keine Adresse protokolliert.

const GEO_HOST = 'https://api-eu.geoapify.com';
const SUCHE_URL = GEO_HOST + '/v1/geocode/search';
const ROUTEN_URL = GEO_HOST + '/v1/routing';
const MAX_PUNKTE = 12;

// Supabase setzt SUPABASE_URL und SUPABASE_ANON_KEY in jeder Function selbst.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

type Treffer = { punkt: number[]; name: string; unsicher: boolean };

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method === 'GET') {
    return json(200, {
      status: 'Hilfsprogramm läuft.',
      dienst: 'Geoapify (EU)',
      version: 2,
      routentyp: 'less_maneuvers',
      region: Deno.env.get('SB_REGION') ?? null,
      schluessel: Boolean(Deno.env.get('GEOAPIFY_API_KEY'))
    });
  }
  if (request.method !== 'POST') {
    return json(405, { fehler: 'Nur POST erlaubt.' });
  }

  const schluessel = Deno.env.get('GEOAPIFY_API_KEY');
  if (!schluessel) {
    return json(503, { fehler: 'Der Zugangsschlüssel für Geoapify ist in Supabase noch nicht eingetragen.' });
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
  } catch (_problem) {
    return json(502, { fehler: 'Anmeldung konnte nicht geprüft werden.' });
  }

  let daten: { adressen?: unknown };
  try {
    daten = await request.json();
  } catch (_problem) {
    return json(400, { fehler: 'Ungültige Anfrage.' });
  }

  const adressen = (Array.isArray(daten.adressen) ? daten.adressen as unknown[] : [])
    .map((a: unknown) => String(a || '').trim().slice(0, 200))
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
    const gefunden = new Map<string, Treffer>();
    let bezug: number[] | null = null; // [lon, lat]

    for (const adresse of adressen) {
      if (gefunden.has(adresse)) continue;

      const werte = new URLSearchParams({
        text: adresse,
        filter: 'countrycode:de',
        limit: '1',
        lang: 'de',
        format: 'json',
        apiKey: schluessel
      });
      if (bezug) {
        werte.set('bias', 'proximity:' + bezug[0] + ',' + bezug[1]);
      }

      const antwort = await fetch(SUCHE_URL + '?' + werte.toString(), {
        headers: { Accept: 'application/json' }
      });
      const fehler = statusFehler(antwort.status);
      if (fehler) return fehler;
      if (!antwort.ok) {
        return json(502, {
          fehler: 'Adresssuche fehlgeschlagen (Status ' + antwort.status + ') bei: ' + adresse
        });
      }
      const ergebnis = await antwort.json();
      const t = ergebnis && Array.isArray(ergebnis.results) ? ergebnis.results[0] : null;

      if (!t || !Number.isFinite(t.lon) || !Number.isFinite(t.lat)) {
        return json(404, { fehler: 'Adresse nicht gefunden: ' + adresse });
      }

      const punkt = [t.lon, t.lat];
      gefunden.set(adresse, {
        punkt,
        name: kurzerName(t, adresse),
        unsicher: istUnsicher(adresse, t)
      });
      if (!bezug) bezug = punkt;
    }

    const punkte = adressen.map(a => gefunden.get(a)!);

    // 3. Strecke berechnen (Geoapify erwartet „Breite,Länge“, getrennt mit |)
    const routeWerte = new URLSearchParams({
      waypoints: punkte.map(p => p.punkt[1] + ',' + p.punkt[0]).join('|'),
      mode: 'drive',
      // Wie „balanced“ (Zeit, Kosten, Strecke), aber mit Abzügen für Abbiegen:
      // bevorzugt durchgehende, schnelle Straßen (Wunsch Olli, 10.11.2026)
      type: 'less_maneuvers',
      lang: 'de',
      apiKey: schluessel
    });
    const route = await fetch(ROUTEN_URL + '?' + routeWerte.toString(), {
      headers: { Accept: 'application/json' }
    });
    const routeFehler = statusFehler(route.status);
    if (routeFehler) return routeFehler;

    const routeDaten = await route.json().catch(() => null);
    const strecke = routeDaten && Array.isArray(routeDaten.features) ? routeDaten.features[0] : null;
    const meter = strecke && strecke.properties && strecke.properties.distance;

    if (!route.ok || !Number.isFinite(meter)) {
      const meldung =
        (routeDaten && (routeDaten.message || routeDaten.error)) || 'Keine Strecke gefunden.';
      return json(502, { fehler: 'Strecke nicht berechenbar: ' + meldung });
    }

    // Verlauf der Strecke für die Karte in der App. Die App erwartet dieselbe
    // kodierte Linie (Polyline, 5 Stellen) wie bisher von OpenRouteService.
    const linie = linieAusGeometrie(strecke.geometry);

    const unsicher = [...gefunden.entries()]
      .filter(([, g]) => g.unsicher)
      .map(([eingabe, g]) => ({ eingabe, gefunden: g.name }));

    return json(200, {
      km: Math.round(meter / 100) / 10,
      punkte: punkte.map(p => p.name),
      koordinaten: punkte.map(p => [p.punkt[1], p.punkt[0]]),
      linie,
      unsicher
    });
  } catch (problem) {
    return json(502, { fehler: 'Geoapify nicht erreichbar: ' + (problem as Error).message });
  }
});

// Verständliche Meldungen für typische Fehler von Geoapify
function statusFehler(status: number) {
  if (status === 401 || status === 403) {
    return json(502, { fehler: 'Der Geoapify-Schlüssel wird nicht angenommen. Bitte in Supabase prüfen.' });
  }
  if (status === 429) {
    return json(429, { fehler: 'Tageskontingent erreicht. Bitte später erneut versuchen.' });
  }
  return null;
}

// Kurze Bezeichnung: „Straße Nr., Ort" bzw. „Name, Ort"
function kurzerName(t: Record<string, any>, eingabe: string) {
  const ort = t.city || t.town || t.village || t.municipality || t.county || '';
  let vorne = '';

  if (t.street) {
    vorne = t.street + (t.housenumber ? ' ' + t.housenumber : '');
    if (t.result_type === 'amenity' && t.name && t.name !== t.street) {
      vorne = t.name + ', ' + vorne;
    }
  } else {
    vorne = t.name || '';
  }

  const text = [vorne, ort].filter(Boolean)
    .filter((x, i, alle) => alle.indexOf(x) === i)
    .join(', ');

  return text || t.formatted || eingabe;
}

// Ein Treffer gilt als unsicher, wenn die Suche nur grob passt:
// - nur Ort, Stadtteil oder Postleitzahl statt Gebäude/Straße/Geschäft
// - Hausnummer eingegeben, aber nur die Straße gefunden
// - geringe Trefferwahrscheinlichkeit
function istUnsicher(eingabe: string, t: Record<string, any>) {
  const typ = String(t.result_type || '');
  const genaueTypen = ['building', 'amenity', 'street'];
  if (!genaueTypen.includes(typ)) return true;

  const rang = t.rank || {};
  if (Number.isFinite(rang.confidence) && rang.confidence < 0.8) return true;

  const hatHausnummer = /\d+\s*[a-zA-Z]?\s*$/.test(String(eingabe).split(',')[0].trim());
  if (hatHausnummer && typ === 'street') return true;

  return false;
}

// Geometrie (LineString oder MultiLineString, Punkte als [Länge, Breite])
// in eine kodierte Polyline mit 5 Stellen umwandeln (Breite zuerst).
function linieAusGeometrie(geometrie: Record<string, any> | null | undefined) {
  if (!geometrie || !Array.isArray(geometrie.coordinates)) return null;
  const teile = geometrie.type === 'LineString' ? [geometrie.coordinates] : geometrie.coordinates;
  const punkte: number[][] = [];
  for (const teil of teile) {
    if (!Array.isArray(teil)) continue;
    for (const p of teil) {
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) punkte.push(p);
    }
  }
  if (!punkte.length) return null;
  return polylineKodieren(punkte);
}

function polylineKodieren(punkte: number[][]) {
  let text = '';
  let vorLat = 0, vorLon = 0;
  for (const [lon, lat] of punkte) {
    const la = Math.round(lat * 1e5);
    const lo = Math.round(lon * 1e5);
    text += zahlKodieren(la - vorLat) + zahlKodieren(lo - vorLon);
    vorLat = la;
    vorLon = lo;
  }
  return text;
}

function zahlKodieren(wert: number) {
  let v = wert < 0 ? ~(wert << 1) : (wert << 1);
  let text = '';
  while (v >= 0x20) {
    text += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return text + String.fromCharCode(v + 63);
}

function json(status: number, inhalt: unknown) {
  return new Response(JSON.stringify(inhalt), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
