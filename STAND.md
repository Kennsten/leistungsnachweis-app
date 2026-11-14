# Stand der Einrichtung (QA-App)

Gemeinsames Gedächtnis für jede Sitzung (Chat und Code-Agent). Regeln dazu: `CLAUDE.md`, Abschnitt 0.
Neueste Einträge oben in den jeweiligen Abschnitt, immer mit Datum.

## Adressen und Netlify
- **14.11.2026 – Bau und Sicherheitsregeln (netlify.toml).** Der Bau installiert seit 0.31 auch die
  Spracherkennungs-Bibliothek `@huggingface/transformers` (kopiert nach `lib/diktat/`, darin eine
  ca. 28 MB große Rechenkern-Datei; der Service Worker legt `lib/diktat/` bewusst nicht in den App-Speicher).
  Sicherheitsregeln (CSP) erlauben zusätzlich Hugging Face (`huggingface.co`, `*.huggingface.co`, `*.hf.co`)
  für die Sprachpakete; `Permissions-Policy` erlaubt das Mikrofon für die eigene Seite. Für `lib/diktat/*.mjs`
  und `*.wasm` sind die Dateiarten fest eingetragen.
- **14.11.2026 – Eigene Domain fertig.** Die App (Zweig `produkt`) läuft unter
  **https://app.qualifizierte-assistenz.de**.
  - Netlify-Projekt `eloquent-griffin-7c2566` (Anzeigename „app.qualifizierte-assistenz.de“),
    Hauptzweig (Production) = `produkt`. `app.qualifizierte-assistenz.de` ist Primary domain,
    HTTPS (Let's Encrypt) seit 13.11.2026, erneuert sich automatisch.
  - Alte Adresse `produkt--eloquent-griffin-7c2566.netlify.app` läuft parallel weiter.
  - Vorschau: `vorschau-km-offline--eloquent-griffin-7c2566.netlify.app` (Branch deploy im selben Projekt).
  - DNS bei IONOS funktioniert (Eintrag für `app`).
- Werbeseite: eigenes Netlify-Projekt `qualifizierte-assistenz` (Zweig `webseite`),
  `qualifizierte-assistenz.de` (primär) und `www.` – nicht anfassen.
  - **14.11.2026:** Impressum mit Telefon +49 174 9112571 und „Kleinunternehmer nach § 19 UStG, keine
    Umsatzsteuer ausgewiesen“; dieselbe Telefonnummer auch in der Website-Datenschutzerklärung und im
    Kontaktbereich der Startseite (vorher Platzhalter `@@TELEFON@@`).
  - Einstellungen (13.11.2026): Basisordner und Veröffentlichung `website`, Funktionen
    `website/netlify/functions`. Namensabfrage über die Funktion `/api/tor` (Netlify Blobs): nach
    10 falschen Versuchen 24 Stunden Sperre je IP-Adresse (gespeichert nur als Prüfwert). Seite ist für
    Suchmaschinen gesperrt (noindex). HTTPS aktiv.
  - Inhalt (13.11.2026): Einstieg mit zwei Wegen „Jetzt ausprobieren“ (Vorführung, ohne Anmeldung) und
    „7 Tage kostenlos testen“ (mit Anmeldung); Funktions-Karte „Diktieren statt tippen“.

## IONOS (Domain und DNS)
- Domain `qualifizierte-assistenz.de` liegt bei IONOS (nur Domain und DNS, kein Webspace, kein Postfach).
- Einträge (Stand 13.11.2026): `A @ → 75.2.60.5` und `CNAME www → qualifizierte-assistenz.netlify.app`
  (Werbeseite), Eintrag für `app` (App bei Netlify, siehe oben).
- **Nicht anfassen:** die Einträge für Brevo (Domain-Bestätigung, DKIM, DMARC) und für Tuta (Postfach
  kontakt@qualifizierte-assistenz.de). Netlify-DNS wird bewusst nicht genutzt.
- Optional aufräumen: alter TXT-Eintrag `subdomain-owner-verification` (wird nicht mehr gebraucht).

## Supabase
- Frankfurt, Projekt `leistungsnachweis-eu` (kostenloser Tarif). London nur noch Test (Zweig `dev`).
- **14.11.2026 geprüft:** Authentication → URL Configuration
  - Site URL: `https://app.qualifizierte-assistenz.de`
  - Redirect URLs: `https://app.qualifizierte-assistenz.de/**`,
    `https://produkt--eloquent-griffin-7c2566.netlify.app/**`,
    `https://vorschau-km-offline--eloquent-griffin-7c2566.netlify.app/**`
- Edge Function `pcloud-link` (CORS für alle Herkünfte, keine Adressbindung). **Über sie läuft der
  Datei-Abruf aus pCloud** (nicht über Netlify); Datenschutzerklärung (App 0.33.5) und Anwalt-Mappe
  sind seit 14.11.2026 entsprechend korrigiert.
- **E-Mail-Versand (12.11.2026):** Authentication → SMTP Settings → eigener SMTP-Server **Brevo**
  (`smtp-relay.brevo.com`, Port 587), Absender `kontakt@qualifizierte-assistenz.de`, Name
  „QA-App Qualifizierte Assistenz“; Rate Limit 30 E-Mails pro Stunde; Vorlagen „Confirm signup“ und
  „Reset password“ auf Deutsch. Der SMTP-Schlüssel steht nur bei Brevo/Supabase, nie in Dateien oder im Chat.
- **Testkonten (ab 0.25):** Sperre nach 7 Tagen und Löschung 30 Tage später werden auf dem Server
  durchgesetzt (Tabelle `konten`, Trigger, Zugriffsregeln, täglicher Auftrag in der Datenbank).
  Konto-Selbstlöschung in der App (Einstellungen → Konto und App löschen).
- Geoapify und HeiGIT/OpenRouteService werden seit 0.24.37 nicht mehr benutzt (Kilometer und Karte
  rechnet das Gerät mit dem Kartenpaket). Aufräumen laut `supabase/LIESMICH.md` – Stand unbekannt,
  siehe „Offen“.

## pCloud
- **14.11.2026 geprüft:** docs.pcloud.com → My Apps → „QA All inclusive“
  - Redirect URIs: `https://app.qualifizierte-assistenz.de/index.html`,
    `https://produkt--eloquent-griffin-7c2566.netlify.app/index.html`
  - Website: `https://app.qualifizierte-assistenz.de/`
  - Für die Vorschau (`vorschau-km-offline--…/index.html`) ist **keine** Redirect URI eingetragen:
    pCloud-Verbinden geht in der Vorschau erst nach diesem Eintrag.

## Weitere Dienste
- **Brevo** (Brevo GmbH, Berlin): Versand der App-E-Mails, Domain bestätigt mit DKIM und DMARC (12.11.2026).
- **Tuta** (Tutao GmbH, Hannover): Postfach kontakt@qualifizierte-assistenz.de.
- **Hugging Face** (Hugging Face, Inc., USA; seit 13.11.2026): Die Geräte laden von dort auf Wunsch das
  Sprachpaket fürs Diktieren – groß `onnx-community/whisper-large-v3-turbo-german-ONNX` (ca. 570–770 MB,
  für Computer) oder mittel `onnx-community/whisper-small-cv11-german-ONNX` (ca. 230–330 MB, für iPad und
  Handy). Lizenz Apache 2.0. Kein Vertrag; Hugging Face sieht nur die IP-Adresse beim Download; Sprache und
  Text bleiben auf dem Gerät. Das große Paket stürzt auf dem iPad ab, das mittlere läuft dort stabil.
  Sprachpakete gelten je Adresse (Vorschau und Haupt-App getrennt laden).
- **GitHub:** baut das Kartenpaket (Ablauf `kartenpaket.yml`, nur von Hand oder bei Änderungen am Werkzeug).
  Die Gratis-Minuten für November 2026 hat das Projekt **AktienMonitoring** verbraucht (2.000 Minuten);
  die QA-App brauchte 70 Minuten. Bezahlt wurde nichts. App, Vorschau und Website baut Netlify, nicht GitHub.

## Verträge zur Auftragsverarbeitung (AVV)
- Supabase: Teil der Nutzungsbedingungen, gilt automatisch (DPA Version 1, 01.08.2026; TIA vorhanden).
- Netlify: DPA Teil des Vertrags, gilt automatisch (Stand 09.06.2026; Data Privacy Framework).
- Brevo: Datenschutzvereinbarung = Anhang 3 der Nutzungsbedingungen.
- IONOS: nach Einschätzung nicht nötig (nur Domain/DNS).
- Tuta: offen.
- pCloud: Vertrag schließt jede Nutzerin selbst.
- Unterlagen: Datenschutz-Richtlinie (https://claude.ai/artifact/Sf1vvpjp3bKh8N5XGfbkmn) und
  Anwalt-Mappe (https://claude.ai/artifact/5kurUYJDg6GopNd3i5gf8n), beide am 14.11.2026 aktualisiert.

## Code und Adresse
- **14.11.2026 geprüft (Commit d1f0e0e): keine Änderung für die neue Adresse nötig.**
  Rücksprungadressen (Anmeldung, Registrierung, pCloud) werden aus `location.origin` gebildet,
  Einladungslink in `installieren.js` relativ, Passkey ohne feste `rpId`, Manifest relativ.
- `netlify/functions/pcloud-link.mjs` ist veraltet (App ruft die Supabase-Function auf); kann nach
  Ollis „Ja“ entfernt werden.

## Offen
- **Geoapify/HeiGIT aufräumen** – **14.11.2026 (Olli):** Edge Functions `route-km` und `route-km-geo`
  gelöscht; `pcloud-link` bleibt (wird gebraucht). Secrets per Foto geprüft (14.11.2026): unter
  „Custom secrets“ stehen noch `ORS_API_KEY` (08.11.2026) und `GEOAPIFY_API_KEY` (10.11.2026) – beide
  nicht mehr gebraucht (`pcloud-link` braucht kein Secret); die „Default secrets“ von Supabase bleiben.
  **14.11.2026: beide Secrets von Olli gelöscht.** Netlify per Foto geprüft (14.11.2026):
  einzige Umgebungsvariable im App-Projekt ist `ORS_API_KEY` (alle Kontexte, 18 Tage alt) – kein Code liest sie
  mehr. **14.11.2026: von Olli gelöscht** – das App-Projekt hat keine Umgebungsvariablen mehr.
  Geoapify per Foto geprüft (14.11.2026): Projekt „QA“ (angelegt 10.11.2026) bei myprojects.geoapify.com,
  kein Code nutzt Geoapify mehr. Noch zu tun: Projekt „QA“ löschen (Project settings → Delete project),
  danach ggf. das Geoapify-Konto selbst.
- Website-Datenschutzerklärung: Speicherdauer der Protokolle fehlt noch (Platzhalter, Abschnitt Server-Protokolle).
- Tuta: klären, ob es einen AVV gibt.
- IONOS: TXT-Eintrag `subdomain-owner-verification` optional löschen.
- Vorschau-Zweig `vorschau-km-offline` steht auf 0.33.1 und muss vor der nächsten Vorschau auf
  `origin/produkt` gebracht werden.
- Noch nicht gebaut: weitere Cloud-Anbieter (WebDAV: Nextcloud, HiDrive, MagentaCloud, Hetzner) und
  „Nur dieses Gerät“ für Dokumente/Belege. Ordner/externe Festplatte für die Datensicherung gibt es nur in
  Chrome/Edge am Computer (Apple erlaubt Webseiten keinen Ordnerzugriff).
- Galerie für die Website: 13 Bilder aus der Vorführung liegen bei Olli (QA-Galerie.zip); Auswahl offen.
- GitHub: Zeitplan von AktienMonitoring verbraucht alle Gratis-Minuten (seltener laufen lassen?).
- Geräte auf die neue Adresse umstellen (Olli, Kollegin): an alter Adresse abgleichen und sichern,
  neue Adresse zum Home-Bildschirm hinzufügen, anmelden, Tresor öffnen, Fingerabdruck/Face ID und
  pCloud neu verbinden; alte App erst löschen, wenn alles läuft.
