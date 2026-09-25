// pcloud-link.mjs
// Dieses Programm läuft auf den Servern von Netlify, nicht im Browser.
// pCloud lehnt das Erzeugen von Freigabelinks ab, wenn die Anfrage
// von einer Webseite kommt (Fehler 7010). Von hier aus kommt sie
// ohne Webseiten-Kennung an.
//
// Das Zugangszeichen wird nur für diesen einen Aufruf weitergereicht
// und nirgends gespeichert.

// Nur diese beiden pCloud-Adressen sind erlaubt (Europa und USA).
const ERLAUBTE_HOSTS = ['eapi.pcloud.com', 'api.pcloud.com'];

export default async (request) => {
  // Aufruf im Browser (GET): nur ein Lebenszeichen zum Testen.
  if (request.method === 'GET') {
    return antwort(200, { status: 'Hilfsprogramm läuft.' });
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

  try {
    const ergebnis = await fetch(
      'https://' + host + '/getfilepublink?' + werte.toString(),
      { headers: { 'User-Agent': 'QA-All-Inclusiv/1.0' } }
    );
    const inhalt = await ergebnis.json();
    // pCloud-Antwort unverändert zurückgeben (result, link, code …)
    return antwort(200, inhalt);
  } catch (problem) {
    return antwort(502, {
      fehler: 'pCloud nicht erreichbar: ' + problem.message
    });
  }
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
