# Edge Functions in Supabase

Die Kilometer-Berechnung braucht **keine** Edge Function mehr: Sie läuft ab
Version 0.24.37 vollständig auf dem Gerät (Kartenpaket, siehe
`werkzeuge/kartenpaket/LIESMICH.md`). Geoapify und HeiGIT/OpenRouteService
werden nicht mehr benutzt.

## Aufräumen (einmalig, nach der Umstellung)
1. Supabase → Projekt „leistungsnachweis-eu“ → **Edge Functions** → `route-km-geo` → **Delete**.
2. Ebenso `route-km` löschen (falls noch vorhanden).
3. **Edge Functions → Secrets** → `GEOAPIFY_API_KEY` und `ORS_API_KEY` löschen.
4. Netlify → Site configuration → **Environment variables** → `ORS_API_KEY` löschen.
5. Bei Geoapify (myprojects.geoapify.com) das Konto bzw. den API-Schlüssel löschen.

---

# Edge Function „pcloud-link“ – Einrichtung (einmalig je Supabase-Projekt)

Die pCloud-Durchreiche (Dateien und Datensicherungen holen) läuft nicht mehr bei Netlify,
sondern in Supabase. Sie braucht **kein Secret**: das pCloud-Zugangszeichen schickt die App
bei jedem Aufruf selbst mit, hier wird nichts gespeichert.

1. Supabase → Projekt „leistungsnachweis-eu“ → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name: `pcloud-link`. Den Inhalt der Datei `supabase/functions/pcloud-link/index.ts` einfügen → **Deploy**.
3. In der Function **Details / Settings**: **„Verify JWT with legacy secret“ ausschalten**
   (die Anmeldung prüft die Function selbst).
4. Test: `https://luizzjsxufsezgpjypwx.supabase.co/functions/v1/pcloud-link?forceFunctionRegion=eu-central-1`
   im Browser öffnen → es muss `"status":"Hilfsprogramm läuft."`, `"version":6` und `"region":"eu-central-1"` erscheinen.

Für das London-Projekt (eigene App, Zweig dev) dieselben Schritte wiederholen.
Die alte Netlify-Datei `netlify/functions/pcloud-link.mjs` bleibt vorerst als Rückfall liegen.
