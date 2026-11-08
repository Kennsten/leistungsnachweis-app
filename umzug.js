/* =====================================================================
   Umzug – Daten aus London übernehmen (Bauabschnitt 7, Version 0.25)

   Einmaliges Werkzeug für Ollis eigene Daten. Es ist absichtlich nicht im
   Menü, sondern versteckt: 8× schnell auf den Titel „QA – Qualifizierte Assistenz“ in der Kopfkarte tippen.

   Was hier passiert:
   1. Du meldest dich mit deinem Londoner Konto an. Die App liest dort
      NUR (es wird nichts in London geändert oder gelöscht).
   2. Die Einträge werden auf diesem Gerät mit dem Tresor-Schlüssel
      verschlüsselt (über die normale Datenzugriff-Schicht) und danach wie
      jede Änderung nach Frankfurt abgeglichen. Der Server sieht nur
      verschlüsselte Pakete.
   3. Die Nummern (IDs) der Einträge bleiben gleich. Dadurch bleiben auch
      die Verknüpfungen zu Dateien in der Cloud gültig.
   4. Das Werkzeug kann mehrfach laufen: bereits übernommene Einträge werden
      aktualisiert, nichts wird doppelt angelegt.

   Nicht übernommen werden: alte Tabellen (app_settings, monthly_reports,
   service_entries), die ungenutzten Spalten ausfallstunde / wegepauschale
   und die Einstellungen (Name, Adresse, Sicherungsdatum – die gelten im
   neuen Konto neu).

   Nach der Übernahme dieses Werkzeug und die Londoner Adresse in der
   Sicherheitsregel (netlify.toml, connect-src) wieder entfernen.
   ===================================================================== */

(function () {
  'use strict';

  const LONDON_URL = 'https://bhrygputoysiwchzlygn.supabase.co';
  const LONDON_KEY = 'sb_publishable_6l1Zi_OcdlxKQgvJWhZWYQ_ZOn6_j1C';

  // Reihenfolge: zuerst die, auf die andere verweisen
  const REIHENFOLGE = [
    'clients', 'bewilligungen', 'dokumentationen', 'trip_entries',
    'termine', 'ausgaben', 'route_distances', 'trip_stop_suggestions',
    'textbausteine', 'verguetungssaetze', 'portraits'
  ];
  const NAMEN = {
    clients: 'Klienten', bewilligungen: 'Bewilligungen', dokumentationen: 'Dokumentationen',
    trip_entries: 'Fahrten', termine: 'Termine', ausgaben: 'Betriebsausgaben',
    route_distances: 'Gemerkte Strecken', trip_stop_suggestions: 'Gespeicherte Stopps',
    textbausteine: 'Textbausteine', verguetungssaetze: 'Vergütungssätze', portraits: 'Porträts'
  };
  const SEITE = 1000;   // so viele Zeilen je Abruf aus London
  const PAKET = 100;    // so viele Einträge je Schreibvorgang

  const e = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let dialog = null;
  let london = null;      // Supabase-Verbindung nach London (nur lesen)
  let gelesen = null;     // { tabelle: [Zeilen] | null }
  let laeuft = false;

  /* ---------- Aufbau des Fensters ---------- */

  function fensterBauen() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.id = 'umzugDialog';
    dialog.innerHTML =
      '<div class="top"><div><div class="muted">Einmaliger Umzug</div>' +
      '<h2>Daten aus London übernehmen</h2></div>' +
      '<button type="button" id="umzugZu" class="kn kn-schliessen secondary">Schließen</button></div>' +
      '<div id="umzugInhalt"></div>';
    document.body.appendChild(dialog);
    dialog.querySelector('#umzugZu').onclick = () => { if (!laeuft) dialog.close(); };
    dialog.addEventListener('cancel', (ev) => { if (laeuft) ev.preventDefault(); });
  }

  const inhalt = () => dialog.querySelector('#umzugInhalt');

  function anmeldeSeite(meldung) {
    inhalt().innerHTML =
      '<p class="muted small">Melde dich mit deinem <strong>Londoner</strong> Konto an (das Konto deiner bisherigen App). ' +
      'Die App liest dort nur. In London wird nichts geändert und nichts gelöscht. ' +
      'Das Passwort wird nicht gespeichert.</p>' +
      (meldung ? '<p class="small" style="color:#b3261e">' + e(meldung) + '</p>' : '') +
      '<label>E-Mail (London)<input id="umzugMail" type="email" autocomplete="off" autocapitalize="none"></label>' +
      '<label>Passwort (London)<input id="umzugPass" type="password" autocomplete="off"></label>' +
      '<div class="actions"><button type="button" id="umzugPruefen">Verbinden und prüfen</button></div>';
    inhalt().querySelector('#umzugPruefen').onclick = pruefen;
  }

  /* ---------- Lesen aus London ---------- */

  async function alleZeilen(tabelle) {
    const alle = [];
    for (let von = 0; ; von += SEITE) {
      const r = await london.from(tabelle).select('*').order('id', { ascending: true }).range(von, von + SEITE - 1);
      if (r.error) return { fehler: r.error.message };
      alle.push(...(r.data || []));
      if (!r.data || r.data.length < SEITE) break;
    }
    return { zeilen: alle };
  }

  async function pruefen() {
    const mail = dialog.querySelector('#umzugMail').value.trim();
    const pass = dialog.querySelector('#umzugPass').value;
    if (!mail || !pass) { anmeldeSeite('Bitte E-Mail und Passwort eingeben.'); return; }
    if (!Geraet.istOffen()) { anmeldeSeite('Der Tresor ist nicht geöffnet. Bitte zuerst entsperren.'); return; }

    inhalt().innerHTML = '<p>Verbinde mit London und lese die Daten …</p>';
    laeuft = true;
    try {
      london = supabase.createClient(LONDON_URL, LONDON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'qa-london-umzug' }
      });
      const a = await london.auth.signInWithPassword({ email: mail, password: pass });
      if (a.error) throw new Error('Anmeldung in London nicht möglich: ' + a.error.message);

      gelesen = {};
      for (const t of REIHENFOLGE) {
        const r = await alleZeilen(t);
        gelesen[t] = r.fehler ? { fehler: r.fehler } : r.zeilen;
      }
      laeuft = false;
      uebersicht();
    } catch (f) {
      laeuft = false;
      await abmelden();
      anmeldeSeite(f.message);
    }
  }

  async function abmelden() {
    try { if (london) await london.auth.signOut(); } catch (_f) { /* egal */ }
    london = null;
  }

  async function anzahlHier(t) {
    const r = await Daten.from(t).select('id', { count: 'exact', head: true });
    return r.error ? null : r.count;
  }

  async function uebersicht() {
    let zeilen = '';
    let gesamt = 0;
    for (const t of REIHENFOLGE) {
      if (!Geraet.tabellen().includes(t)) continue;
      const g = gelesen[t];
      const hier = await anzahlHier(t);
      const ldn = Array.isArray(g) ? g.length : null;
      if (ldn) gesamt += ldn;
      zeilen += '<tr><td>' + e(NAMEN[t] || t) + '</td><td style="text-align:right">' +
        (ldn === null ? '<span class="muted">nicht vorhanden</span>' : ldn) +
        '</td><td style="text-align:right">' + (hier === null ? '?' : hier) + '</td></tr>';
    }
    inhalt().innerHTML =
      '<p>Gelesen aus London. Noch nichts übernommen.</p>' +
      '<table style="width:100%"><thead><tr><th style="text-align:left">Art</th>' +
      '<th style="text-align:right">London</th><th style="text-align:right">Schon hier</th></tr></thead>' +
      '<tbody>' + zeilen + '</tbody></table>' +
      '<p class="muted small">„Schon hier“ sind Einträge in <strong>diesem</strong> Konto. ' +
      'Gleiche Einträge werden mit dem Stand aus London aktualisiert, nichts wird doppelt angelegt. ' +
      'Ein Konto, in dem schon echte Arbeit steht, solltest du nicht überschreiben.</p>' +
      (gesamt
        ? '<div class="actions"><button type="button" id="umzugStart">Jetzt übernehmen (' + gesamt + ' Einträge)</button>' +
          '<button type="button" id="umzugAbbruch" class="secondary">Abbrechen</button></div>'
        : '<p>In London wurden keine Einträge gefunden.</p><div class="actions"><button type="button" id="umzugAbbruch" class="secondary">Schließen</button></div>');
    const start = inhalt().querySelector('#umzugStart');
    if (start) start.onclick = uebernehmen;
    inhalt().querySelector('#umzugAbbruch').onclick = async () => { await abmelden(); dialog.close(); };
  }

  /* ---------- Umwandeln und Schreiben ---------- */

  // Nur Spalten behalten, die es hier gibt; user_id setzt der Gerätespeicher selbst
  function bereinigen(t, zeile) {
    const erlaubt = new Set(Geraet.spalten(t));
    const neu = {};
    for (const [k, v] of Object.entries(zeile)) {
      if (k === 'user_id' || !erlaubt.has(k)) continue;
      neu[k] = v;
    }
    return neu;
  }

  // Klienten ohne Kennung bekommen die nächste freie Nummer (K001, K002 …)
  function kennungenVergeben(zeilen, bereitsVergeben) {
    const benutzt = new Set(bereitsVergeben);
    let hoechste = 0;
    for (const z of zeilen) {
      const m = /^K(\d+)$/i.exec(String(z.client_code || '').trim());
      if (m) hoechste = Math.max(hoechste, parseInt(m[1], 10));
    }
    for (const c of benutzt) {
      const m = /^K(\d+)$/i.exec(String(c || '').trim());
      if (m) hoechste = Math.max(hoechste, parseInt(m[1], 10));
    }
    const ohne = zeilen
      .filter((z) => !String(z.client_code || '').trim())
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    for (const z of ohne) {
      hoechste += 1;
      z.client_code = 'K' + String(hoechste).padStart(3, '0');
    }
  }

  async function paketSchreiben(t, paket, fehlerListe) {
    const r = await Daten.from(t).upsert(paket, { onConflict: 'id' });
    if (!r.error) return paket.length;
    // Paket abgelehnt: einzeln versuchen, damit nur die fehlerhaften Einträge fehlen
    let ok = 0;
    for (const z of paket) {
      const r1 = await Daten.from(t).upsert(z, { onConflict: 'id' });
      if (r1.error) fehlerListe.push({ tabelle: t, id: z.id, text: r1.error.message });
      else ok++;
    }
    return ok;
  }

  async function uebernehmen() {
    if (!confirm('Daten aus London jetzt in dieses Konto übernehmen? In London wird nichts verändert.')) return;
    laeuft = true;
    const fehlerListe = [];
    const ergebnis = {};
    const ladenAnzeige = (text) => { inhalt().innerHTML = '<p>' + e(text) + '</p><p class="muted small">Bitte dieses Fenster nicht schließen.</p>'; };

    try {
      for (const t of REIHENFOLGE) {
        if (!Geraet.tabellen().includes(t)) continue;
        const quelle = gelesen[t];
        if (!Array.isArray(quelle)) continue;

        let zeilen = quelle.map((z) => bereinigen(t, z));
        if (t === 'clients') {
          const hier = await Daten.from('clients').select('id,client_code');
          const fremd = (hier.data || []).filter((h) => !zeilen.some((z) => z.id === h.id)).map((h) => h.client_code);
          kennungenVergeben(zeilen, fremd);
        }

        let geschrieben = 0;
        for (let i = 0; i < zeilen.length; i += PAKET) {
          ladenAnzeige((NAMEN[t] || t) + ': ' + Math.min(i + PAKET, zeilen.length) + ' von ' + zeilen.length + ' …');
          geschrieben += await paketSchreiben(t, zeilen.slice(i, i + PAKET), fehlerListe);
        }
        ergebnis[t] = { london: zeilen.length, geschrieben };
      }

      ladenAnzeige('Abgleich mit Frankfurt …');
      try { await Geraet.abgleichen(); } catch (_f) { /* wird unten angezeigt */ }

      // Gegenprobe: gleiche Nummern auch wirklich hier vorhanden?
      for (const t of Object.keys(ergebnis)) {
        const ids = new Set(((await Daten.from(t).select('id')).data || []).map((z) => z.id));
        const fehlt = gelesen[t].filter((z) => !ids.has(z.id)).length;
        ergebnis[t].fehlt = fehlt;
      }
    } catch (f) {
      fehlerListe.push({ tabelle: '-', id: '-', text: f.message });
    }

    await abmelden();
    laeuft = false;
    fertigSeite(ergebnis, fehlerListe);
  }

  function fertigSeite(ergebnis, fehlerListe) {
    let zeilen = '';
    let alleOk = fehlerListe.length === 0;
    for (const t of REIHENFOLGE) {
      const r = ergebnis[t];
      if (!r) continue;
      const ok = r.fehlt === 0 && r.geschrieben === r.london;
      if (!ok) alleOk = false;
      zeilen += '<tr><td>' + e(NAMEN[t] || t) + '</td><td style="text-align:right">' + r.london +
        '</td><td style="text-align:right">' + r.geschrieben + '</td><td>' + (ok ? '✓' : '⚠') + '</td></tr>';
    }
    const fehlerText = fehlerListe.length
      ? '<p class="small" style="color:#b3261e"><strong>Nicht übernommen (' + fehlerListe.length + '):</strong></p><ul class="small">' +
        fehlerListe.slice(0, 30).map((f) => '<li>' + e(NAMEN[f.tabelle] || f.tabelle) + ' ' + e(f.id) + ': ' + e(f.text) + '</li>').join('') +
        '</ul>' + (fehlerListe.length > 30 ? '<p class="small muted">… und weitere.</p>' : '')
      : '';
    inhalt().innerHTML =
      '<p><strong>' + (alleOk ? 'Alles übernommen.' : 'Übernahme mit Auffälligkeiten.') + '</strong></p>' +
      '<table style="width:100%"><thead><tr><th style="text-align:left">Art</th>' +
      '<th style="text-align:right">London</th><th style="text-align:right">Übernommen</th><th></th></tr></thead>' +
      '<tbody>' + zeilen + '</tbody></table>' + fehlerText +
      '<p class="muted small">Die Daten werden jetzt nach Frankfurt abgeglichen (verschlüsselt). ' +
      'Prüfe die Klienten, Bewilligungen und Fahrten in der App und vergleiche mit London, bevor du London pausierst.</p>' +
      '<div class="actions"><button type="button" id="umzugFertig">Schließen</button></div>';
    inhalt().querySelector('#umzugFertig').onclick = () => { dialog.close(); location.reload(); };
  }

  window.Umzug = {
    oeffnen() {
      if (!Geraet.istOffen()) { alert('Bitte erst anmelden und den Tresor entsperren.'); return; }
      fensterBauen();
      gelesen = null;
      anmeldeSeite();
      if (!dialog.open) dialog.showModal();
    }
  };
})();
