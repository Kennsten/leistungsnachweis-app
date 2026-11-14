// Sicherung gegen versehentlich gelöschte Teile der App.
//
// Läuft vor jeder Lieferung von Hand und bei jeder Veröffentlichung auf Netlify
// (siehe netlify.toml). Schlägt die Prüfung fehl, veröffentlicht Netlify nicht –
// die bisherige Version bleibt online.
//
//   node scripts/pruefen.mjs                   prüfen
//   node scripts/pruefen.mjs --liste-erneuern  Pflichtliste neu schreiben; zeigt vorher,
//                                              was gegenüber der alten Liste wegfällt
//
// Die Pflichtliste (scripts/pflichtliste.json) hält fest, was in der App vorhanden
// sein muss: Fenster und Felder (ids), Funktionen, Gestaltungsregeln (Klassen),
// die Regeln je Design und die Länge jeder Datei. Fehlt davon etwas, ist das
// entweder ein Versehen (dann reparieren) oder Absicht (dann die Liste erneuern
// und die angezeigten Wegfälle mit dem Auftrag vergleichen).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WURZEL = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LISTE = path.join(WURZEL, 'scripts', 'pflichtliste.json');
const ERNEUERN = process.argv.includes('--liste-erneuern');

// Eine Datei darf höchstens so viel kürzer werden, ohne dass die Liste erneuert wird.
const SCHWUND_ANTEIL = 0.01;
const SCHWUND_ZEILEN_MIN = 15;

const lesen = (name) => fs.readFileSync(path.join(WURZEL, name), 'utf8');
const dateien = fs.readdirSync(WURZEL)
  .filter((n) => /\.(html|js)$/.test(n))
  .sort();

const fehler = [];
const hinweise = [];
const melde = (text) => fehler.push(text);

const einmalig = (liste) => [...new Set(liste)].sort();
const alle = (text, muster, gruppe = 1) => einmalig([...text.matchAll(muster)].map((m) => m[gruppe]));

function inlineSkripte(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}
function stilBloecke(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

// ---------- 1. Skripte müssen fehlerfrei lesbar sein ----------
function syntaxPruefen(name, code, nr) {
  const istModul = /^\s*(import|export)\s/m.test(code);
  const tmp = path.join(os.tmpdir(), 'qa-pruefen-' + process.pid + '-' + name.replace(/\W/g, '_') + '-' + nr + (istModul ? '.mjs' : '.cjs'));
  fs.writeFileSync(tmp, code);
  const lauf = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.rmSync(tmp, { force: true });
  if (lauf.status !== 0) {
    const zeile = (lauf.stderr || '').split('\n').filter((z) => z.trim() && !z.includes(tmp)).slice(0, 4).join(' | ');
    melde('Skript-Fehler in ' + name + (nr ? ' (Skript-Block ' + nr + ')' : '') + ': ' + zeile);
  }
}

// ---------- Bestand einer Datei aufnehmen ----------
function bestand(name) {
  const text = lesen(name);
  const eintrag = { zeilen: text.split('\n').length };
  if (name.endsWith('.html')) {
    const skripte = inlineSkripte(text);
    skripte.forEach((code, i) => syntaxPruefen(name, code, i + 1));
    const code = skripte.join('\n');
    const stil = stilBloecke(text);
    eintrag.ids = alle(text.replace(/<script[\s\S]*?<\/script>/g, ''), /\sid="([A-Za-z][\w-]*)"/g);
    eintrag.funktionen = alle(code, /(?:^|[\s;}])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g);
    eintrag.klassen = alle(stil, /\.([A-Za-z][\w-]*)(?=[\s{,.:>+~\[)#])/g);
    const designs = {};
    for (const d of alle(stil, /\[data-theme="([\w-]+)"\]/g)) {
      designs[d] = (stil.match(new RegExp('\\[data-theme="' + d + '"\\]', 'g')) || []).length;
    }
    eintrag.designs = designs;
  } else {
    syntaxPruefen(name, text, 0);
    eintrag.funktionen = alle(text, /(?:^|[\s;}])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g);
  }
  return eintrag;
}

const jetzt = {};
for (const name of dateien) jetzt[name] = bestand(name);

// ---------- 2. Feste Prüfungen (unabhängig von der Liste) ----------
if (!jetzt['index.html']) melde('index.html fehlt.');
else {
  const index = lesen('index.html');
  const sw = fs.existsSync(path.join(WURZEL, 'service-worker.js')) ? lesen('service-worker.js') : '';

  const version = (index.match(/const APP_VERSION='(\d+(?:\.\d+)+)/) || [])[1];
  const cache = (sw.match(/const CACHE_NAME = '[^']*?(\d+(?:\.\d+)+)'/) || [])[1];
  if (!version) melde('APP_VERSION in index.html nicht gefunden.');
  if (!cache) melde('CACHE_NAME in service-worker.js nicht gefunden.');
  if (version && cache && version !== cache) {
    melde('Version passt nicht zusammen: APP_VERSION ' + version + ', CACHE_NAME ' + cache + '.');
  }

  // Jedes wählbare Design braucht eigene Gestaltungsregeln.
  const wahl = (index.match(/<select id="themeSelect">([\s\S]*?)<\/select>/) || [])[1] || '';
  const designs = alle(wahl, /<option value="([\w-]+)"/g).filter((d) => d !== 'standard');
  if (designs.length < 3) melde('Design-Auswahl (themeSelect) unvollständig: ' + designs.join(', '));
  for (const d of designs) {
    const zahl = jetzt['index.html'].designs[d] || 0;
    if (zahl < 5) melde('Design „' + d + '“ hat nur ' + zahl + ' Gestaltungsregeln – vermutlich fehlen welche.');
  }

  // Alle Dateien, die die App offline bereithält, müssen vorhanden sein
  // (lib/ entsteht erst beim Veröffentlichen und wird hier nicht geprüft).
  const liste = (sw.match(/const APP_DATEIEN = \[([\s\S]*?)\];/) || [])[1] || '';
  for (const eintrag of alle(liste, /'\.\/([^']+)'/g)) {
    if (eintrag.startsWith('lib/')) continue;
    if (!fs.existsSync(path.join(WURZEL, eintrag))) melde('Im Service Worker eingetragen, aber nicht vorhanden: ' + eintrag);
  }
  // Eingebundene eigene Skripte und Seiten müssen vorhanden sein.
  for (const name of dateien.filter((n) => n.endsWith('.html'))) {
    for (const ziel of alle(lesen(name), /<script[^>]*\bsrc="(?:\.\/)?([^"?#]+)"/g)) {
      if (ziel.startsWith('lib/') || /^https?:/.test(ziel)) continue;
      if (!fs.existsSync(path.join(WURZEL, ziel))) melde(name + ' bindet ein fehlendes Skript ein: ' + ziel);
    }
  }
}

// ---------- 3. Vergleich mit der Pflichtliste ----------
const alt = fs.existsSync(LISTE) ? JSON.parse(fs.readFileSync(LISTE, 'utf8')).dateien : null;
const wegfall = [];

if (alt) {
  for (const [name, soll] of Object.entries(alt)) {
    const ist = jetzt[name];
    if (!ist) { wegfall.push('Datei fehlt: ' + name); continue; }
    const erlaubt = Math.max(SCHWUND_ZEILEN_MIN, Math.round(soll.zeilen * SCHWUND_ANTEIL));
    if (soll.zeilen - ist.zeilen > erlaubt) {
      wegfall.push(name + ': ' + (soll.zeilen - ist.zeilen) + ' Zeilen kürzer (' + soll.zeilen + ' → ' + ist.zeilen + '), erlaubt ohne Bestätigung: ' + erlaubt);
    }
    for (const [art, wort] of [['ids', 'Fenster/Felder (id)'], ['funktionen', 'Funktionen'], ['klassen', 'Gestaltungsregeln (Klasse)']]) {
      const fehlt = (soll[art] || []).filter((x) => !(ist[art] || []).includes(x));
      if (fehlt.length) wegfall.push(name + ': ' + fehlt.length + ' ' + wort + ' fehlen: ' + fehlt.join(', '));
    }
    for (const [d, zahl] of Object.entries(soll.designs || {})) {
      const neu = (ist.designs || {})[d] || 0;
      if (neu < zahl) wegfall.push(name + ': Design „' + d + '“ hat nur noch ' + neu + ' statt ' + zahl + ' Gestaltungsregeln');
    }
  }
} else if (!ERNEUERN) {
  melde('Pflichtliste fehlt (scripts/pflichtliste.json). Mit --liste-erneuern anlegen.');
}

// ---------- Ergebnis ----------
if (ERNEUERN) {
  if (fehler.length) {
    console.error('Die Pflichtliste wird nicht erneuert, solange diese Fehler bestehen:\n- ' + fehler.join('\n- '));
    process.exit(1);
  }
  if (wegfall.length) {
    console.log('ACHTUNG – gegenüber der bisherigen Pflichtliste fällt weg:\n- ' + wegfall.join('\n- '));
    console.log('\nNur in Ordnung, wenn genau das beauftragt war. Sonst: reparieren und die Liste zurücksetzen (git checkout scripts/pflichtliste.json).\n');
  } else {
    console.log('Nichts fällt weg.');
  }
  const inhalt = {
    hinweis: 'Automatisch erzeugt von scripts/pruefen.mjs --liste-erneuern. Nicht von Hand ändern.',
    dateien: jetzt,
  };
  fs.writeFileSync(LISTE, JSON.stringify(inhalt, null, 1) + '\n');
  console.log('Pflichtliste geschrieben: ' + Object.keys(jetzt).length + ' Dateien.');
  process.exit(0);
}

for (const w of wegfall) melde(w);
if (fehler.length) {
  console.error('PRÜFUNG NICHT BESTANDEN – es wird nicht veröffentlicht.\n- ' + fehler.join('\n- '));
  console.error('\nVersehen: reparieren. Absicht: „node scripts/pruefen.mjs --liste-erneuern“ ausführen, die Wegfälle mit dem Auftrag vergleichen und die Liste mitspeichern.');
  process.exit(1);
}
for (const h of hinweise) console.log('Hinweis: ' + h);
const summe = Object.values(jetzt).reduce((s, e) => s + e.zeilen, 0);
console.log('Prüfung bestanden: ' + Object.keys(jetzt).length + ' Dateien, ' + summe + ' Zeilen, Version ' + ((lesen('index.html').match(/const APP_VERSION='([^']*)'/) || [])[1] || '?') + '.');
