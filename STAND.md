# Stand der Einrichtung (QA-App)

Gemeinsames Gedächtnis für jede Sitzung (Chat und Code-Agent). Regeln dazu: `CLAUDE.md`, Abschnitt 0.
Neueste Einträge oben in den jeweiligen Abschnitt, immer mit Datum.

## Adressen und Netlify
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

## Supabase
- Frankfurt, Projekt `leistungsnachweis-eu` (kostenloser Tarif). London nur noch Test (Zweig `dev`).
- **14.11.2026 geprüft:** Authentication → URL Configuration
  - Site URL: `https://app.qualifizierte-assistenz.de`
  - Redirect URLs: `https://app.qualifizierte-assistenz.de/**`,
    `https://produkt--eloquent-griffin-7c2566.netlify.app/**`,
    `https://vorschau-km-offline--eloquent-griffin-7c2566.netlify.app/**`
- Edge Function `pcloud-link` (CORS für alle Herkünfte, keine Adressbindung).

## pCloud
- **14.11.2026 geprüft:** docs.pcloud.com → My Apps → „QA All inclusive“
  - Redirect URIs: `https://app.qualifizierte-assistenz.de/index.html`,
    `https://produkt--eloquent-griffin-7c2566.netlify.app/index.html`
  - Website: `https://app.qualifizierte-assistenz.de/`
  - Für die Vorschau (`vorschau-km-offline--…/index.html`) ist **keine** Redirect URI eingetragen:
    pCloud-Verbinden geht in der Vorschau erst nach diesem Eintrag.

## Code und Adresse
- **14.11.2026 geprüft (Commit d1f0e0e): keine Änderung für die neue Adresse nötig.**
  Rücksprungadressen (Anmeldung, Registrierung, pCloud) werden aus `location.origin` gebildet,
  Einladungslink in `installieren.js` relativ, Passkey ohne feste `rpId`, Manifest relativ.
- `netlify/functions/pcloud-link.mjs` ist veraltet (App ruft die Supabase-Function auf); kann nach
  Ollis „Ja“ entfernt werden.

## Offen
- Geräte auf die neue Adresse umstellen (Olli, Kollegin): an alter Adresse abgleichen und sichern,
  neue Adresse zum Home-Bildschirm hinzufügen, anmelden, Tresor öffnen, Fingerabdruck/Face ID und
  pCloud neu verbinden; alte App erst löschen, wenn alles läuft.
