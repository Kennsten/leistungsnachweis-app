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
