// pcloud-link.mjs
// Dieses Programm läuft auf den Servern von Netlify, nicht im Browser.
// pCloud lehnt das Erzeugen von Links ab, wenn die Anfrage von einer
// Webseite kommt (Fehler 7010). Von hier aus kommt sie ohne
// Webseiten-Kennung an.
//
// Ablauf:
// 1. Befristeten Freigabelink für die Datei erzeugen (getfilepublink).
// 2. Daraus den direkten Datei-Link holen (getpublinkdownload).
//    Der direkte Link öffnet die Datei selbst, z. B. ein PDF im
//    Safari-Betrachter mit allen Seiten. Die pCloud-Freigabeseite
//    zeigt dagegen nur eine Vorschau der ersten Seite.
// Klappt Schritt 2 nicht, wird wie bisher die Freigabeseite geliefert.
//
// Das Zugangszeichen wird nur für diesen einen Aufruf weitergereicht
// und nirgends gespeichert.

// Nur diese beiden pCloud-Adressen sind erlaubt (Europa und USA).
const ERLAUBTE_HOSTS = ['eapi.pcloud.com', 'api.pcloud.com'];

export default async (request) => {
  // Aufruf im Browser (GET): nur ein Lebenszeichen zum Testen.
  if (request.method === 'GET') {
    return antwort(200, { status: 'Hilfsprogramm läuft.', version: 2 });
  }

  if (request.method !== 'POST') {
    return antwort(405, { fehler: 'Nur POST erlaubt.' });
  }

  let daten;
  try {
    daten = await request.json();
  } catch (problem) {
    return antwort(400, { fehler: 'Ungültige Anfrage.' });
  }

  const token = daten.token;
  const fileid = daten.fileid;
  const expire = daten.expire;
  const host = ERLAUBTE_HOSTS.includes(daten.host)
    ? daten.host
    : 'eapi.pcloud.com';

  if (!token || !fileid) {
    return antwort(400, { fehler: 'Zugangszeichen oder Datei fehlt.' });
  }

  const werte = new URLSearchParams();
  werte.set('access_token', token);
  werte.set('fileid', String(fileid));
  if (expire) {
    werte.set('expire', String(expire));
  }

  let inhalt;

  try {
    const ergebnis = await fetch(
      'https://' + host + '/getfilepublink?' + werte.toString(),
      { headers: { 'User-Agent': 'QA-All-Inclusiv/1.0' } }
    );
    inhalt = await ergebnis.json();
  } catch (problem) {
    return antwort(502, {
      fehler: 'pCloud nicht erreichbar: ' + problem.message
    });
  }

  // Direkten Datei-Link ergänzen (nur wenn der Freigabelink klappte)
  if (daten.direkt && inhalt && inhalt.result === 0 && inhalt.code) {
    try {
      const weiter = new URLSearchParams();
      weiter.set('code', inhalt.code);

      const typ = inhalt.metadata && inhalt.metadata.contenttype;
      if (typ) {
        weiter.set('contenttype', typ);
      }

      const ergebnis = await fetch(
        'https://' + host + '/getpublinkdownload?' + weiter.toString(),
        { headers: { 'User-Agent': 'QA-All-Inclusiv/1.0' } }
      );
      const download = await ergebnis.json();

      if (
        download.result === 0 &&
        Array.isArray(download.hosts) &&
        download.hosts.length &&
        download.path
      ) {
        inhalt.direkt = 'https://' + download.hosts[0] + download.path;
      } else {
        inhalt.direktFehler =
          (download.error || 'Fehler') + ' (Code ' + download.result + ')';
      }
    } catch (problem) {
      inhalt.direktFehler = problem.message;
    }
  }

  // pCloud-Antwort zurückgeben (result, link, code, ggf. direkt …)
  return antwort(200, inhalt);
};

function antwort(status, inhalt) {
  return new Response(JSON.stringify(inhalt), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
