// route-km (Supabase Edge Function, Version 6)
// Läuft in Supabase (Deno), im selben Vertragsverhältnis wie die Datenbank,
// nicht mehr bei Netlify. Berechnet die Länge einer Autofahrt über
// OpenRouteService (HeiGIT, Heidelberg). Der Zugangsschlüssel liegt nur hier
// als Secret ORS_API_KEY und ist im App-Code nicht sichtbar.
//
// Ablauf:
// 1. Prüfen, ob die Anfrage von einem angemeldeten Nutzer kommt.
// 2. Jede Adresse in Koordinaten umwandeln (Geocoding, nur Deutschland).
// 3. Strecke mit dem Auto über alle Punkte berechnen.
//
// Die App schickt nur Adressen, keine Namen und keinen Fahrtzweck.
// Hier wird nichts gespeichert und keine Adresse protokolliert.

const ROUTEN_URL = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car';
const SUCHE_URL = 'https://api.heigit.org/pelias/v1/search';
const MAX_PUNKTE = 12;

// Supabase setzt SUPABASE_URL und SUPABASE_ANON_KEY in jeder Function selbst.
// Deshalb gilt dieselbe Datei automatisch im Projekt, in dem sie läuft.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method === 'GET') {
    return json(200, {
      status: 'Hilfsprogramm läuft.',
      version: 6,
      region: Deno.env.get('SB_REGION') ?? null,
      schluessel: Boolean(Deno.env.get('ORS_API_KEY'))
    });
  }
  if (request.method !== 'POST') {
    return json(405, { fehler: 'Nur POST erlaubt.' });
  }

  const schluessel = Deno.env.get('ORS_API_KEY');
  if (!schluessel) {
    return json(503, { fehler: 'Der Zugangsschlüssel für OpenRouteService ist in Supabase noch nicht eingetragen.' });
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
    const gefunden = new Map<string, { punkt: number[]; name: string; unsicher: boolean }>();
    let bezug: number[] | null = null;

    for (const adresse of adressen) {
      if (gefunden.has(adresse)) continue;

      const werte = new URLSearchParams({
        api_key: schluessel,
        text: adresse,
        'boundary.country': 'DE',
        size: '1',
        lang: 'de'
      });
      if (bezug) {
        werte.set('focus.point.lon', String(bezug[0]));
        werte.set('focus.point.lat', String(bezug[1]));
      }

      const antwort = await fetch(SUCHE_URL + '?' + werte.toString(), {
        headers: { Authorization: schluessel, Accept: 'application/json' }
      });
      if (antwort.status === 429) {
        return json(429, { fehler: 'Tageskontingent erreicht. Bitte später erneut versuchen.' });
      }
      if (!antwort.ok) {
        return json(502, {
          fehler: 'Adresssuche fehlgeschlagen (Status ' + antwort.status + ') bei: ' + adresse
        });
      }
      const ergebnis = await antwort.json();
      const treffer = ergebnis && ergebnis.features && ergebnis.features[0];

      if (!treffer) {
        return json(404, { fehler: 'Adresse nicht gefunden: ' + adresse });
      }

      const punkt = treffer.geometry.coordinates;
      const p = treffer.properties || {};
      gefunden.set(adresse, {
        punkt,
        name: kurzerName(p, adresse),
        unsicher: istUnsicher(adresse, p)
      });
      if (!bezug) bezug = punkt;
    }

    const punkte = adressen.map(a => gefunden.get(a)!);

    // 3. Strecke berechnen
    const route = await fetch(ROUTEN_URL, {
      method: 'POST',
      headers: {
        Authorization: schluessel,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      // Schnellste Strecke, wie Google Maps sie meist vorschlägt
      body: JSON.stringify({
        coordinates: punkte.map(p => p.punkt),
        preference: 'fastest'
      })
    });

    if (route.status === 429) {
      return json(429, { fehler: 'Tageskontingent erreicht. Bitte später erneut versuchen.' });
    }

    const routeDaten = await route.json();
    // Verlauf der Strecke (kodierte Linie) für die Karte in der App
    const linie =
      routeDaten && routeDaten.routes && routeDaten.routes[0] &&
      typeof routeDaten.routes[0].geometry === 'string'
        ? routeDaten.routes[0].geometry
        : null;
    const meter =
      routeDaten && routeDaten.routes && routeDaten.routes[0] &&
      routeDaten.routes[0].summary && routeDaten.routes[0].summary.distance;

    if (!Number.isFinite(meter)) {
      const meldung =
        (routeDaten && routeDaten.error && (routeDaten.error.message || routeDaten.error)) ||
        'Keine Strecke gefunden.';
      return json(502, { fehler: 'Strecke nicht berechenbar: ' + meldung });
    }

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
    return json(502, { fehler: 'OpenRouteService nicht erreichbar: ' + (problem as Error).message });
  }
});

// Kurze Bezeichnung: „Straße Nr., Ort" bzw. „Name, Ort" statt
// „Engelbosteler Damm 83, Hanover, NI, Germany"
function kurzerName(p: Record<string, any>, eingabe: string) {
  const ort = p.locality || p.localadmin || p.county || '';
  let vorne = '';

  if (p.street) {
    vorne = p.street + (p.housenumber ? ' ' + p.housenumber : '');
    if (p.layer === 'venue' && p.name) vorne = p.name + ', ' + vorne;
  } else {
    vorne = p.name || '';
  }

  const text = [vorne, ort].filter(Boolean)
    .filter((t, i, alle) => alle.indexOf(t) === i)
    .join(', ');

  return text || p.label || eingabe;
}

// Ein Treffer gilt als unsicher, wenn die Suche nur grob passt:
// - nur Ort, Stadtteil oder Postleitzahl statt Adresse/Straße/Geschäft
// - Hausnummer eingegeben, aber nur die Straße gefunden
// - geringe Trefferwahrscheinlichkeit oder Ausweichsuche (fallback)
function istUnsicher(eingabe: string, p: Record<string, any>) {
  const ebene = String(p.layer || '');
  const genaueEbenen = ['address', 'venue', 'street'];
  if (!genaueEbenen.includes(ebene)) return true;
  if (p.match_type === 'fallback') return true;
  if (Number.isFinite(p.confidence) && p.confidence < 0.8) return true;

  const hatHausnummer = /\d+\s*[a-zA-Z]?\s*$/.test(String(eingabe).split(',')[0].trim());
  if (hatHausnummer && ebene === 'street') return true;

  return false;
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
