// Kopiert die Bibliotheken der App aus node_modules in den Ordner lib/.
// Läuft automatisch bei jeder Veröffentlichung auf Netlify (siehe netlify.toml).
// Fehlt eine Datei, bricht der Vorgang ab: Netlify veröffentlicht dann nichts
// und die bisherige Version bleibt online.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ZIEL = 'lib';
const MODULE = 'node_modules';

// Pfad der Browser-Datei von supabase-js aus dessen package.json lesen,
// weil sich die Ordnerstruktur zwischen Versionen ändern kann.
function supabaseDatei() {
  const paket = JSON.parse(
    readFileSync(join(MODULE, '@supabase/supabase-js/package.json'), 'utf8')
  );
  const pfad = paket.jsdelivr || paket.unpkg || 'dist/umd/supabase.js';
  return join(MODULE, '@supabase/supabase-js', pfad);
}

const KOPIEN = [
  { von: supabaseDatei(), nach: 'supabase.js' },
  { von: join(MODULE, 'html2canvas/dist/html2canvas.min.js'), nach: 'html2canvas.min.js' },
  { von: join(MODULE, 'jspdf/dist/jspdf.umd.min.js'), nach: 'jspdf.umd.min.js' },
  { von: join(MODULE, 'leaflet/dist/leaflet.js'), nach: 'leaflet/leaflet.js' },
  { von: join(MODULE, 'leaflet/dist/leaflet.css'), nach: 'leaflet/leaflet.css' },
  { von: join(MODULE, 'leaflet/dist/images'), nach: 'leaflet/images', ordner: true }
];

rmSync(ZIEL, { recursive: true, force: true });

for (const k of KOPIEN) {
  if (!existsSync(k.von)) {
    console.error('FEHLT: ' + k.von);
    process.exit(1);
  }
  const ziel = join(ZIEL, k.nach);
  mkdirSync(k.ordner ? ziel : dirname(ziel), { recursive: true });
  cpSync(k.von, ziel, { recursive: Boolean(k.ordner) });
  console.log('kopiert: ' + k.von + ' -> ' + ziel);
}

console.log('Bibliotheken bereit.');
