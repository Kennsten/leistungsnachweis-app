# Edge Function „route-km“ – Einrichtung (einmalig je Supabase-Projekt)

Die Kilometer-Berechnung läuft nicht mehr bei Netlify, sondern in Supabase
(Frankfurt-Projekt `luizzjsxufsezgpjypwx`).

## Weg über die Weboberfläche (ohne Programmierwerkzeuge)
1. Supabase → Projekt „leistungsnachweis-eu“ → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name: `route-km`. Den Inhalt der Datei `supabase/functions/route-km/index.ts` einfügen → **Deploy**.
3. In der Function oben **Details / Settings**: **„Verify JWT with legacy secret“ ausschalten**
   (die Anmeldung prüft die Function selbst).
4. **Edge Functions → Secrets** → neues Secret `ORS_API_KEY` mit dem OpenRouteService-Schlüssel
   (derselbe wie bisher bei Netlify unter Umgebungsvariablen).
5. Test: Adresse `https://luizzjsxufsezgpjypwx.supabase.co/functions/v1/route-km?forceFunctionRegion=eu-central-1`
   im Browser öffnen → es muss `"status":"Hilfsprogramm läuft."`, `"region":"eu-central-1"` und `"schluessel":true` erscheinen.

Für das London-Projekt (eigene App, Zweig dev) dieselben Schritte wiederholen.

---

# Edge Function „pcloud-link“ – Einrichtung (einmalig je Supabase-Projekt)

Die pCloud-Durchreiche (Dateien und Datensicherungen holen) läuft nicht mehr bei Netlify,
sondern in Supabase. Sie braucht **kein Secret**: das pCloud-Zugangszeichen schickt die App
bei jedem Aufruf selbst mit, hier wird nichts gespeichert.

1. Supabase → Projekt „leistungsnachweis-eu“ → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name: `pcloud-link`. Den Inhalt der Datei `supabase/functions/pcloud-link/index.ts` einfügen → **Deploy**.
3. In der Function **Details / Settings**: **„Verify JWT with legacy secret“ ausschalten**
   (die Anmeldung prüft die Function selbst, wie bei `route-km`).
4. Test: `https://luizzjsxufsezgpjypwx.supabase.co/functions/v1/pcloud-link?forceFunctionRegion=eu-central-1`
   im Browser öffnen → es muss `"status":"Hilfsprogramm läuft."`, `"version":6` und `"region":"eu-central-1"` erscheinen.

Für das London-Projekt (eigene App, Zweig dev) dieselben Schritte wiederholen.
Die alte Netlify-Datei `netlify/functions/pcloud-link.mjs` bleibt vorerst als Rückfall liegen.

---

# Edge Function „route-km-geo“ – Kilometer über Geoapify (Vorschau, ab 0.24.27)

Ersetzt `route-km` (HeiGIT), sobald die Vorschau freigegeben ist. Gleiche Antwort an die App,
aber Geoapify über die EU-Adresse `api-eu.geoapify.com`. Geoapify bietet einen AVV an
(geoapify.com/data-processing-agreement).

1. Bei Geoapify ein Konto anlegen (myprojects.geoapify.com), Projekt „QA“ anlegen, **API-Schlüssel** kopieren.
2. Supabase → Projekt „leistungsnachweis-eu“ → **Edge Functions** → **Deploy a new function** → **Via Editor**.
3. Name: `route-km-geo`. Den Inhalt der Datei `supabase/functions/route-km-geo/index.ts` einfügen
   (bis zur letzten Zeile `}` mitkopieren) → **Deploy**.
4. In der Function **Details / Settings**: **„Verify JWT with legacy secret“ ausschalten**.
5. **Edge Functions → Secrets** → neues Secret `GEOAPIFY_API_KEY` mit dem Geoapify-Schlüssel.
6. Test: `https://luizzjsxufsezgpjypwx.supabase.co/functions/v1/route-km-geo?forceFunctionRegion=eu-central-1`
   im Browser öffnen → `"dienst":"Geoapify (EU)"`, `"region":"eu-central-1"` und `"schluessel":true`.

Nach der Umstellung: Secret `ORS_API_KEY` und Function `route-km` erst löschen, wenn alles läuft.
