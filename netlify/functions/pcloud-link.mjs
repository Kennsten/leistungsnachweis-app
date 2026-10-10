// pcloud-link.mjs  (Version 3)
// Dieses Programm läuft auf den Servern von Netlify, nicht im Browser.
// pCloud lehnt das Erzeugen von Links ab, wenn die Anfrage von einer
// Webseite kommt (Fehler 7010). Von hier aus kommt sie ohne
// Webseiten-Kennung an.
//
// Zwei Aufgaben:
// 1. Standard: befristeten Freigabelink für eine Datei erzeugen
//    (getfilepublink). Dafür wird das pCloud-Zugangszeichen gebraucht.
// 2. art = 'datei': die Datei selbst durchreichen. pCloud bindet
//    direkte Datei-Links an die Internetadresse (IP), die sie
//    angefordert hat. Deshalb holt dieses Programm Link UND Datei
//    selbst und gibt die Datei an die App weiter. Dafür genügt der
//    Code des Freigabelinks, das Zugangszeichen wird nicht gebraucht.
//
// Weder Zugangszeichen noch Dateien werden hier gespeichert.

// Nur diese beiden pCloud-Adressen sind erlaubt (Europa und USA).
const ERLAUBTE_HOSTS = ['eapi.pcloud.com', 'api.pcloud.com'];
const KENNUNG = { 'User-Agent': 'QA-All-Inclusiv/1.0' };

export default async (request) => {
  // Aufruf im Browser (GET): nur ein Lebenszeichen zum Testen.
  if (request.method === 'GET') {
    return json(200, { status: 'Hilfsprogramm läuft.', version: 3 });
  }

  if (request.method !== 'POST') {
    return json(405, { fehler: 'Nur POST erlaubt.' });
  }

  let daten;
  try {
    daten = await request.json();
  } catch (problem) {
    return json(400, { fehler: 'Ungültige Anfrage.' });
  }

  const host = ERLAUBTE_HOSTS.includes(daten.host)
    ? daten.host
    : 'eapi.pcloud.com';

  if (daten.art === 'datei') {
    return dateiDurchreichen(host, daten);
  }

  return freigabelink(host, daten);
};

async function freigabelink(host, daten) {
  const token = daten.token;
  const fileid = daten.fileid;

  if (!token || !fileid) {
    return json(400, { fehler: 'Zugangszeichen oder Datei fehlt.' });
  }

  const werte = new URLSearchParams();
  werte.set('access_token', token);
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
    return json(502, { fehler: 'pCloud nicht erreichbar: ' + problem.message });
  }
}

async function dateiDurchreichen(host, daten) {
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

    if (link.result !== 0 || !Array.isArray(link.hosts) || !link.hosts.length) {
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
        'Content-Type':
          daten.contenttype ||
          datei.headers.get('content-type') ||
          'application/octet-stream',
        'Cache-Control': 'no-store'
      }
    });
  } catch (problem) {
    return json(502, { fehler: 'pCloud nicht erreichbar: ' + problem.message });
  }
}

function json(status, inhalt) {
  return new Response(JSON.stringify(inhalt), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
