# Regeln für die Arbeit an der QA-App (verbindlich für jeden Chat)

Die App gehört Olli (kein Programmierer, arbeitet meist am iPad). Der Zweig `produkt` ist die
Verkaufsversion: **jeder Push dorthin ist sofort online.** Stand und Entscheidungen stehen in den
Projekt-Dokumenten (`claude/…`, zuerst `claude/version-2-stand-und-uebergabe.md` und die neuesten
`claude/stand-…`-Dokumente).

## 1. Vorher fragen
- **Größere Aktionen nur nach Ollis „Ja“.** Größer ist alles, was mehr als eine kleine, klar
  beauftragte Korrektur ist: Funktionen entfernen oder umbauen, mehrere Fenster ändern, Daten oder
  Datenbank berühren, Dateien löschen, Build/Netlify/Supabase-Einstellungen ändern, alles, was sich
  schwer zurücknehmen lässt. Vorher kurz und ohne Fachsprache beschreiben, was sich ändert.
- Im Zweifel fragen. Nichts „nebenbei“ mit aufräumen, was nicht beauftragt ist.
- **Vorschau-Regel (Olli, 14.11.2026):** Größere Umbauten gehen zuerst auf den festen Zweig
  `vorschau-km-offline` (Adresse `vorschau-km-offline--eloquent-griffin-7c2566.netlify.app`), nicht
  auf `produkt`. Der Name stammt von einem früheren Vorhaben; der Zweig ist bei Netlify bereits
  als Vorschau eingerichtet und dient jetzt für alle Vorschauen. Ablauf: den Zweig auf den Stand
  von `origin/produkt` bringen, Änderung dort liefern (mit allen Schritten aus Abschnitt 2), Olli
  testet, erst nach seinem „Ja“ per `git merge --ff-only` nach `produkt`. Direkt auf `produkt` nur
  kleine, klar beauftragte Korrekturen oder wenn Olli es ausdrücklich sagt. Keine weiteren
  Vorschau-Zweige anlegen (jeder braucht eigene Einträge bei Netlify und pCloud); diesen Zweig
  nicht löschen.

## 2. Vor jeder Lieferung (Pflicht, in dieser Reihenfolge)
1. `git fetch` und auf dem neuesten Stand von `origin/produkt` arbeiten.
2. `APP_VERSION` in `index.html` und `CACHE_NAME` in `service-worker.js` erhöhen (gleiche Nummer).
3. **`node scripts/pruefen.mjs` muss bestehen.** Meldet es Wegfälle:
   - Versehen → reparieren.
   - Absicht → `node scripts/pruefen.mjs --liste-erneuern`, die angezeigten Wegfälle **einzeln mit
     dem Auftrag vergleichen** und `scripts/pflichtliste.json` mitspeichern. Die Liste nie blind
     erneuern, nie von Hand ändern, die Prüfung nie abschalten oder umgehen.
   - Nach jeder Lieferung mit neuen Fenstern/Funktionen die Liste ebenfalls erneuern („Nichts fällt
     weg“ muss erscheinen), damit das Neue geschützt ist.
4. **Vergleich ansehen:** `git diff -U0 origin/produkt | grep '^@@'` und die entfernten Zeilen
   (`grep '^-'`) durchgehen. Es darf nur fehlen, was beauftragt war.
5. Im Test-Browser prüfen: das geänderte Fenster **und** die Startansicht in allen vier Designs
   (Standard, Comic = `moebius`, Dunkel = `dunkel`, Sommer = `blumen`) bei 390 und 360 px; dabei
   Hintergrund- und Schriftfarbe je Design kontrollieren, keine Skriptfehler.
6. Erst dann speichern und pushen. Danach das passende Projekt-Dokument aktualisieren und Olli
   ehrlich sagen, was getestet ist und was nicht.

## 3. Regeln beim Bearbeiten
- **Nie „von Marke bis Marke“ herausschneiden**, ohne vorher zu zählen, wie viele Zeilen dazwischen
  liegen, und den Ausschnitt anzusehen. (Am 14.11.2026 gingen so 420 Zeilen Gestaltungsregeln
  verloren; die Designs Dunkel und Sommer waren kaputt.) Lieber kleine, genau benannte Stücke
  ersetzen; bei jedem Ersetzen prüfen, dass die Fundstelle genau einmal vorkommt.
- Nach Skript-gestützten Änderungen immer die Zeilenbilanz (`git diff --stat`) mit der Erwartung
  vergleichen. Weicht sie deutlich ab: anhalten und nachsehen.
- Neue .js-Dateien in `APP_DATEIEN` (Service Worker) eintragen; gelöschte dort austragen.
- Daten liegen verschlüsselt im Gerätespeicher (`geraet.js`, Spaltenliste `SPALTEN`). Felder und
  Tabellen dort nicht entfernen, solange alte Daten oder Sicherungen sie enthalten können.

## 4. Sicherung bei Netlify
`netlify.toml` startet vor dem Veröffentlichen `node scripts/pruefen.mjs`. Schlägt die Prüfung
fehl, wird nicht veröffentlicht und die bisherige Version bleibt online. Diesen Schritt nicht
entfernen.
