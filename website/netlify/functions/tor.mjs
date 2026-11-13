// Namensabfrage für die Startseite (Sichtschutz, kein Zugangsschutz für Geheimes).
// Prüft den eingegebenen Namen auf dem Server und sperrt eine IP-Adresse nach
// 10 Fehlversuchen hintereinander für 24 Stunden. Die IP-Adresse wird nur als
// Prüfsumme (SHA-256 mit Salz) gespeichert und nach 24 Stunden wertlos.
import { getStore } from '@netlify/blobs';

export const MAX_FEHLVERSUCHE = 10;
export const SPERRE_MS = 24 * 60 * 60 * 1000;

// „Oliver S.“ oder „Oliver S“ – Groß-/Kleinschreibung und Leerzeichen egal
export function nameRichtig(eingabe) {
  const t = String(eingabe || '').trim().replace(/\s+/g, ' ');
  return /^oliver s\.?$/i.test(t);
}

// Reine Prüflogik (ohne Speicher-Details), damit sie sich testen lässt
export async function pruefen(speicher, schluessel, eingabe, jetzt) {
  let e = (await speicher.get(schluessel)) || { fehl: 0, zuletzt: 0, bis: 0 };
  // Alte Einträge (über 24 Stunden, keine laufende Sperre) verfallen
  if (e.zuletzt && jetzt - e.zuletzt > SPERRE_MS && !(e.bis > jetzt)) e = { fehl: 0, zuletzt: 0, bis: 0 };
  if (e.bis > jetzt) return { status: 429, antwort: { ok: false, gesperrt: true, bis: e.bis } };
  if (nameRichtig(eingabe)) {
    await speicher.loeschen(schluessel);
    return { status: 200, antwort: { ok: true } };
  }
  e.fehl += 1;
  e.zuletzt = jetzt;
  if (e.fehl >= MAX_FEHLVERSUCHE) e.bis = jetzt + SPERRE_MS;
  await speicher.setzen(schluessel, e);
  if (e.bis > jetzt) return { status: 429, antwort: { ok: false, gesperrt: true, bis: e.bis } };
  return { status: 200, antwort: { ok: false, rest: MAX_FEHLVERSUCHE - e.fehl } };
}

async function pruefsumme(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const json = (daten, status = 200) => new Response(JSON.stringify(daten), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export default async (req, context) => {
  if (req.method !== 'POST') return json({ ok: false, fehler: 'Nur POST' }, 405);
  let name = '';
  try { ({ name } = await req.json()); } catch (f) { /* leer */ }
  if (typeof name !== 'string' || name.length > 60) name = '';

  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'unbekannt';
  const salz = (globalThis.Netlify && Netlify.env.get('TOR_SALZ')) || process.env.TOR_SALZ || 'qa-tor-salz-2026';
  const schluessel = await pruefsumme(salz + '|' + ip);

  const store = getStore('tor-versuche');
  const speicher = {
    get: (k) => store.get(k, { type: 'json' }),
    setzen: (k, wert) => store.setJSON(k, wert),
    loeschen: (k) => store.delete(k)
  };
  const { status, antwort } = await pruefen(speicher, schluessel, name, Date.now());
  return json(antwort, status);
};

export const config = { path: '/api/tor' };
