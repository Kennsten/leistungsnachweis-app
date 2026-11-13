// Setzt beim Veröffentlichen (Netlify-Build) das Datum hinter der Versionsnummer
// auf den Tag der Veröffentlichung, damit es immer aktuell ist.
import fs from 'node:fs';

const datei = new URL('../index.html', import.meta.url);
const heute = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric'
}).format(new Date());

const alt = fs.readFileSync(datei, 'utf8');
const neu = alt.replace(/const APP_STAND='[^']*';/, `const APP_STAND='${heute}';`);
if (neu === alt && !alt.includes(`const APP_STAND='${heute}';`)) {
  console.error('APP_STAND nicht gefunden – Datum nicht gesetzt.');
  process.exit(1);
}
fs.writeFileSync(datei, neu);
console.log('Stand gesetzt:', heute);
