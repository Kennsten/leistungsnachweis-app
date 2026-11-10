# Kilometer auf dem Gerät – Kartenpaket

Die App kann Kilometer **ohne Weitergabe von Adressen** berechnen. Dafür lädt
sie einmalig ein Kartenpaket von der eigenen App-Adresse herunter und
speichert es auf dem Gerät. Danach passiert alles auf dem Gerät: Es wird keine
Adresse an Geoapify, Google oder einen anderen Dienst geschickt, und es werden
keine Kartenbilder von fremden Servern geladen.

## Was ist im Paket?

- **Straßennetz:** alle mit dem Auto befahrbaren Straßen aus OpenStreetMap,
  mit Länge, üblichem Tempo und Einbahnstraßen.
- **Adressverzeichnis:** Straßen mit Hausnummern, PLZ und Ort sowie bekannte
  Orte (Apotheken, Geschäfte, Ämter …), damit man auch „Apotheke“ oder
  „Marktkauf“ als Stopp eintippen kann.

Kartendaten © OpenStreetMap-Mitwirkende, Lizenz ODbL
(https://www.openstreetmap.org/copyright). Der Hinweis steht in der App bei
der Karte und in den Einstellungen.

## Dateien

| Datei | Aufgabe |
|---|---|
| `km-geraet.js` | Rechen-Helfer in der App: Adresse suchen, Strecke berechnen, Paket laden/speichern |
| `werkzeuge/kartenpaket/bauen.py` | baut das Paket aus OpenStreetMap-Daten |
| `werkzeuge/kartenpaket/pruefen.js` | rechnet nach dem Bauen Probe-Strecken nach |
| `.github/workflows/kartenpaket.yml` | GitHub baut das Paket automatisch |
| `karten/pakete.json` | Liste der Pakete, die die App anbietet |
| `karten/<name>-strassen.bin.gz`, `karten/<name>-adressen.json.gz` | das Paket selbst |

## Paket neu bauen (z. B. alle 3–6 Monate)

1. GitHub → Reiter **Actions** → links **„Kartenpaket bauen“**.
2. Rechts **„Run workflow“** → Zweig wählen → grüner Knopf **„Run workflow“**.
3. Nach etwa 15–40 Minuten ist das neue Paket im Zweig gespeichert, Netlify
   veröffentlicht es automatisch. Die App zeigt dann in den Einstellungen
   „neuere Fassung verfügbar“ und einen Knopf „Aktualisieren“.

## Gebiet

Zurzeit gibt es ein Paket: **Hannover und Region Hannover** mit etwa 5–10 km
Rand (Ausschnitt `--grenzen 52.10,9.25,52.75,10.35`, aus den Niedersachsen-Daten
von Geofabrik). Liegt eine Adresse außerhalb, meldet die App das, und man trägt
die Kilometer von Hand ein.

Weitere Gebiete: in `.github/workflows/kartenpaket.yml` einen zweiten
Bau-Schritt mit eigenem `--name`, `--titel` und `--grenzen` (oder einer anderen
Geofabrik-Datei ohne `--grenzen`) ergänzen. Die App zeigt dann alle Pakete aus
`karten/pakete.json` zur Auswahl.

## Wie wird gerechnet?

Gesucht wird die Strecke mit der kürzesten Fahrzeit, mit einem kleinen Zuschlag
für jede Kreuzung (bevorzugt durchgehende Straßen, ähnlich „less_maneuvers“ bei
Geoapify). Angezeigt werden die Kilometer dieser Strecke. Wie bisher gilt:
gemerkte Strecken und der Tacho bleiben maßgeblich, die Berechnung ist ein
Vorschlag.
