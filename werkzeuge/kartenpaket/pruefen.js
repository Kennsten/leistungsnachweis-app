// Prüft ein frisch gebautes Kartenpaket mit Probe-Strecken.
// Aufruf: node werkzeuge/kartenpaket/pruefen.js <ordner> <paketname>
// Bricht mit Fehler ab, wenn eine Probe nicht berechnet werden kann oder die
// Kilometer weit außerhalb des erwarteten Bereichs liegen.

const fs = require('fs');
const path = require('path');
const K = require(path.join(__dirname, '..', '..', 'km-geraet.js'));

const ordner = process.argv[2] || 'karten';
const name = process.argv[3] || 'niedersachsen';

// Erwartete Straßen-Kilometer (grob, wie Routenplaner sie ungefähr angeben)
const PROBEN = {
  niedersachsen: [
    { adressen: ['Ernst-August-Platz 1, 30159 Hannover', 'Trammplatz 2, 30159 Hannover'], von: 0.8, bis: 2.5 },
    { adressen: ['Ernst-August-Platz 1, 30159 Hannover', 'Flughafenstraße 4, 30855 Langenhagen'], von: 10, bis: 18 },
    { adressen: ['Ernst-August-Platz 1, 30159 Hannover', 'Markt 1, 31134 Hildesheim'], von: 28, bis: 42 },
    { adressen: ['Ernst-August-Platz 1, 30159 Hannover', 'Bahnhofsplatz 15, 28195 Bremen'], von: 110, bis: 140 },
    { adressen: ['Ernst-August-Platz 1, 30159 Hannover', 'Apotheke', 'Ernst-August-Platz 1, 30159 Hannover'], von: 0.1, bis: 6 }
  ]
};

(async () => {
  const lesen = d => { const b = fs.readFileSync(path.join(ordner, d)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const liste = JSON.parse(fs.readFileSync(path.join(ordner, 'pakete.json'), 'utf8')).pakete;
  const p = liste.find(x => x.name === name);
  if (!p) throw new Error('Paket ' + name + ' fehlt in pakete.json');

  let t = Date.now();
  const netz = K.netzLesen(await K.entpacken(lesen(p.dateien.strassen)));
  const verz = K.adressenLesen(new TextDecoder().decode(await K.entpacken(lesen(p.dateien.adressen))));
  console.log(`Paket geladen in ${Date.now() - t} ms: ${netz.N} Knoten, ${netz.E} Kanten, ${verz.strassen.length} Straßen`);

  let fehler = 0;
  for (const probe of PROBEN[name] || []) {
    t = Date.now();
    try {
      const r = K.routeBerechnen({ netz, verz }, probe.adressen);
      const ok = r.km >= probe.von && r.km <= probe.bis;
      if (!ok) fehler++;
      console.log(`${ok ? 'OK    ' : 'FEHLER'} ${r.km} km (erwartet ${probe.von}–${probe.bis}) in ${Date.now() - t} ms: ` +
        r.punkte.join(' → ') + (r.unsicher.length ? '  [unsicher: ' + r.unsicher.map(u => u.eingabe).join(', ') + ']' : ''));
    } catch (e) {
      fehler++;
      console.log('FEHLER ' + probe.adressen.join(' → ') + ': ' + e.message);
    }
  }
  if (fehler) {
    console.log(fehler + ' Probe(n) fehlgeschlagen.');
    process.exit(1);
  }
  console.log('Alle Proben bestanden.');
})().catch(e => { console.error(e); process.exit(1); });
