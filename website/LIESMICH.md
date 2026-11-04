# Internetseite qualifizierte-assistenz.de

Statische Werbeseite für die „QA-App – Qualifizierte Assistenz“. Liegt im Ordner `website/` auf dem GitHub-Zweig `webseite`. Der Zweig ist bewusst **getrennt** von `dev` und `produkt`, damit die App-Adresse die Seite nicht mit ausliefert und App-Lieferungen die Seite nicht neu bauen.

## Dateien
- `index.html` – Startseite
- `impressum.html`, `datenschutz.html` – Pflichtseiten (Entwurf, siehe unten)
- `style.css` – Gestaltung (hell und dunkel, ohne fremde Schriften)
- `netlify.toml` – Sicherheits-Einstellungen für Netlify
- `icons/` – App-Symbol

## Vor dem Start ausfüllen
Gesucht und ersetzt werden diese Platzhalter (gelb markiert auf den Rechtsseiten):
- `@@EMAIL@@`, `@@TELEFON@@` (Telefon ohne Leerzeichen, z. B. +49511…)
- `@@STRASSE@@`, `@@PLZ_ORT@@`
- `@@UST_ZEILE@@` (Umsatzsteuer-Satz, z. B. Kleinunternehmer-Hinweis nach § 19 UStG oder USt-IdNr.)
- Datenschutz: Speicherdauer der Server-Protokolle und Rechtsgrundlage für die USA-Übermittlung prüfen
- Danach den gelben Entwurf-Kasten in beiden Rechtsseiten löschen

## Netlify einrichten (neues Projekt, einmalig)
1. Netlify → „Add new project“ → „Import an existing project“ → GitHub → Repository `leistungsnachweis-app`.
2. Branch: `webseite`.
3. Base directory: `website`. Build command: leer lassen. Publish directory: `website`.
4. „Deploy“ drücken. Die Seite ist dann unter einer netlify.app-Adresse zu sehen.
5. Domain: Project configuration → Domain management → „Add a domain“ → `qualifizierte-assistenz.de`. Netlify zeigt dann, welche DNS-Einträge beim Domain-Anbieter zu setzen sind. Das HTTPS-Zertifikat holt Netlify selbst.

## Freischalten für Suchmaschinen
In allen drei HTML-Dateien steht `<meta name="robots" content="noindex, nofollow">`. Diese Zeile erst entfernen, wenn Impressum und Datenschutz fertig sind.
