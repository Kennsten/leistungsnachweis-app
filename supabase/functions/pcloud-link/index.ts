// pcloud-link (Supabase Edge Function, Version 6)
// Läuft in Supabase (Deno), im selben Vertragsverhältnis wie die Datenbank,
// nicht mehr bei Netlify.
//
// pCloud lehnt das Erzeugen von Links ab, wenn die Anfrage von einer
// Webseite kommt (Fehler 7010). Von hier aus kommt sie ohne
// Webseiten-Kennung an.
//
// Drei Aufgaben:
// 1. Standard: befristeten Freigabelink für eine Datei erzeugen
//    (getfilepublink). Dafür wird das pCloud-Zugangszeichen gebraucht.
// 2. art = 'datei': die Datei selbst durchreichen. pCloud bindet
//    direkte Datei-Links an die Internetadresse (IP), die sie
//    angefordert hat. Deshalb holt dieses Programm Link UND Datei
//    selbst und gibt die Datei an die App weiter. Dafür genügt der
//    Code des Freigabelinks, das Zugangszeichen wird nicht gebraucht.
// 3. art = 'inhalt': eine Datei mit Zugangszeichen und Datei-Nummer
//    holen, OHNE Freigabelink (für Datensicherungen).
//
// Weder Zugangszeichen noch Dateien werden hier gespeichert oder protokolliert.
// Alle Dateien sind schon im Gerät verschlüsselt; hier laufen nur unlesbare
// Bytes durch.
//
// Alle Aufrufe (außer dem Lebenszeichen per GET) verlangen eine gültige
// Anmeldung an der App (Supabase), wie bei route-km.

// Nur diese beiden pCloud-Adressen sind erlaubt (Europa und USA).
const ERLAUBTE_HOSTS = ['eapi.pcloud.com', 'api.pcloud.com'];
const KENNUNG = { 'User-Agent': 'QA-All-Inclusiv/1.0' };

// Supabase setzt SUPABASE_URL und SUPABASE_ANON_KEY in jeder Function selbst.
// Deshalb gilt dieselbe Datei automatisch im Projekt, in dem sie läuft.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

// Der Host einer Datei-Adresse muss zu pCloud gehören (Schutz davor, dass
// eine gefälschte Antwort die Funktion auf fremde Adressen lenkt).
function istPcloudHost(host: unknown): host is string {
  return typeof host === 'string' && /^[a-z0-9-]+\.pcloud\.com$/i.test(host);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method === 'GET') {
    return json(200, {
      status: 'Hilfsprogramm läuft.',
      version: 6,
      region: Deno.env.get('SB_REGION') ?? null
    });
  }
  if (request.method !== 'POST') {
    return json(405, { fehler: 'Nur POST erlaubt.' });
  }

  // Anmeldung prüfen
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

  // deno-lint-ignore no-explicit-any
  let daten: any;
  try {
    daten = await request.json();
  } catch (_problem) {
    return json(400, { fehler: 'Ungültige Anfrage.' });
  }

  const host = ERLAUBTE_HOSTS.includes(daten.host) ? daten.host : 'eapi.pcloud.com';

  if (daten.art === 'datei') return dateiDurchreichen(host, daten);
  if (daten.art === 'inhalt') return inhaltHolen(host, daten);
  return freigabelink(host, daten);
});

// deno-lint-ignore no-explicit-any
async function freigabelink(host: string, daten: any) {
  const token = daten.token;
  const fileid = daten.fileid;

  if (!token || !fileid) {
    return json(400, { fehler: 'Zugangszeichen oder Datei fehlt.' });
  }

  const werte = new URLSearchParams();
  werte.set('access_token', String(token));
  werte.set('fileid', String(fileid));
  if (daten.expire) {
    werte.set('expire', String(daten.expire));
  }

  try {
    const ergebnis = await fetch(
      'https://' + host + '/getfilepublink?' + werte.toString(),
      { headers: KENNUNG }
    );
    // pCloud-Antwort unverändert zurückgeben (result, link, code …)
    return json(200, await ergebnis.json());
  } catch (problem) {
    return json(502, { fehler: 'pCloud nicht erreichbar: ' + (problem as Error).message });
  }
}

// deno-lint-ignore no-explicit-any
async function dateiDurchreichen(host: string, daten: any) {
  if (!daten.code) {
    return json(400, { fehler: 'Code des Freigabelinks fehlt.' });
  }

  try {
    const werte = new URLSearchParams();
    werte.set('code', String(daten.code));
    if (daten.contenttype) {
      werte.set('contenttype', String(daten.contenttype));
    }

    const linkAntwort = await fetch(
      'https://' + host + '/getpublinkdownload?' + werte.toString(),
      { headers: KENNUNG }
    );
    const link = await linkAntwort.json();

    if (link.result !== 0 || !Array.isArray(link.hosts) || !link.hosts.length ||
        !istPcloudHost(link.hosts[0])) {
      return json(502, {
        fehler: 'Kein Datei-Link: ' + (link.error || 'Fehler') +
          ' (Code ' + link.result + ')'
      });
    }

    const datei = await fetch('https://' + link.hosts[0] + link.path, {
      headers: KENNUNG
    });

    if (!datei.ok || !datei.body) {
      return json(502, { fehler: 'Datei nicht abrufbar (Status ' + datei.status + ').' });
    }

    // Datei direkt weiterleiten (wird nicht zwischengespeichert)
    return new Response(datei.body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type':
          daten.contenttype ||
          datei.headers.get('content-type') ||
          'application/octet-stream',
        'Cache-Control': 'no-store'
      }
    });
  } catch (problem) {
    return json(502, { fehler: 'pCloud nicht erreichbar: ' + (problem as Error).message });
  }
}

// deno-lint-ignore no-explicit-any
async function inhaltHolen(host: string, daten: any) {
  if (!daten.token || !daten.fileid) {
    return json(400, { fehler: 'Zugangszeichen oder Datei fehlt.' });
  }

  try {
    const werte = new URLSearchParams();
    werte.set('access_token', String(daten.token));
    werte.set('fileid', String(daten.fileid));

    const linkAntwort = await fetch(
      'https://' + host + '/getfilelink?' + werte.toString(),
      { headers: KENNUNG }
    );
    const link = await linkAntwort.json();

    if (link.result !== 0 || !Array.isArray(link.hosts) || !link.hosts.length ||
        !istPcloudHost(link.hosts[0])) {
      return json(502, {
        fehler: 'Kein Datei-Link: ' + (link.error || 'Fehler') +
          ' (Code ' + link.result + ')'
      });
    }

    const datei = await fetch('https://' + link.hosts[0] + link.path, {
      headers: KENNUNG
    });

    if (!datei.ok || !datei.body) {
      return json(502, { fehler: 'Datei nicht abrufbar (Status ' + datei.status + ').' });
    }

    return new Response(datei.body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store'
      }
    });
  } catch (problem) {
    return json(502, { fehler: 'pCloud nicht erreichbar: ' + (problem as Error).message });
  }
}

function json(status: number, inhalt: unknown) {
  return new Response(JSON.stringify(inhalt), {
    status: status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
