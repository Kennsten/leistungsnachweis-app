/* =====================================================================
   Gerätespeicher – Bauabschnitt 4 und 5 (Version 0.13 Verkaufsversion)

   Was hier passiert:
   1. Alle Einträge der App (Klienten, Dokumentationen, Fahrten …) liegen
      auf dem Gerät in der Browser-Datenbank IndexedDB – jeder Eintrag als
      verschlüsseltes Paket (AES-256-GCM mit dem Datenschlüssel aus dem
      Tresor).
   2. Nach dem Entsperren werden alle Pakete in den Arbeitsspeicher
      entschlüsselt. Die Anfragen der App (über daten.js) laufen dann
      dort – ohne Internet.
   3. Die Regeln der bisherigen Datenbank (Standardwerte, Pflichtfelder,
      Prüfregeln, Eindeutigkeiten, Verknüpfungen mit Löschfolgen und der
      Zeitstempel bei Fahrten) bildet dieser Baustein nach. Fehler-
      meldungen lauten wie bisher.
   4. Jede Änderung kommt zusätzlich in den „Ausgang“. Der Abgleich
      schickt den Ausgang an den Server (Tabelle datensaetze) und holt
      Änderungen anderer Geräte. Der Server sieht nur verschlüsselte
      Pakete – nicht einmal, ob es ein Klient oder eine Fahrt ist.
   5. Konflikte (derselbe Eintrag auf zwei Geräten geändert): Die
      spätere Änderung gilt. Die andere Fassung wird verschlüsselt
      aufbewahrt (Liste „Abgleich prüfen“ folgt in Version 0.14).
   ===================================================================== */

(function () {
  'use strict';

  /* =================================================================
     A. Aufbau der Tabellen (aus Frankfurt ausgelesen am 31.10.2026)
     [Spalte, Typ, Pflicht, Standardwert]
     ================================================================= */

  const SPALTEN = {
    ausgaben: [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["user_id", "uuid", true, "auth.uid()"],
      ["beleg_jahr", "integer", true, null],
      ["beleg_nr", "integer", true, null],
      ["datum", "date", true, null],
      ["betrag", "numeric", true, null],
      ["kategorie", "text", true, null],
      ["zweck", "text", true, null],
      ["client_id", "uuid", false, null],
      ["documentation_id", "uuid", false, null],
      ["trip_id", "uuid", false, null],
      ["bewirtung_anlass", "text", false, null],
      ["bewirtung_teilnehmer", "text", false, null],
      ["beleg_vorhanden", "boolean", true, "false"],
      ["beleg_datei_id", "bigint", false, null],
      ["beleg_datei_name", "text", false, null],
      ["notizen", "text", false, null],
      ["created_at", "timestamp with time zone", true, "now()"],
      ["updated_at", "timestamp with time zone", true, "now()"],
    ],
    bewilligungen: [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["user_id", "uuid", true, "auth.uid()"],
      ["client_id", "uuid", true, null],
      ["beginn", "date", true, null],
      ["ende", "date", false, null],
      ["stundenkontingent", "numeric", true, null],
      ["wochen_fls", "numeric", false, null],
      ["fls_halbjahr_1", "numeric", false, null],
      ["fls_halbjahr_2", "numeric", false, null],
      ["bewilligungsjahr_beginn", "date", false, null],
      ["leistungstraeger_typ", "text", false, null],
      ["leistungstraeger_name", "text", false, null],
      ["kostentraeger", "text", false, null],
      ["ansprechpartner", "text", false, null],
      ["bemerkungen", "text", false, null],
      ["verlaufsbericht_am", "date", false, null],
      ["verlaufsbericht_faellig_am", "date", false, null],
      ["abschlussbericht_am", "date", false, null],
      ["abschlussbericht_erinnerung_am", "date", false, null],
      ["bescheid_datei_id", "bigint", false, null],
      ["bescheid_datei_name", "text", false, null],
      ["created_at", "timestamp with time zone", true, "now()"],
      ["gesamtplan_fortschreibung_am", "date", false, null],
    ],
    clients: [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["user_id", "uuid", true, "auth.uid()"],
      ["client_code", "text", true, null],
      ["name", "text", true, null],
      ["anrede", "text", false, null],
      ["aktenzeichen", "text", false, null],
      ["geburtstag", "date", false, null],
      ["telefon", "text", false, null],
      ["mobil", "text", false, null],
      ["strasse", "text", false, null],
      ["hausnummer", "text", false, null],
      ["plz", "text", false, null],
      ["ort", "text", false, null],
      ["kontaktperson1", "text", false, null],
      ["telefon1", "text", false, null],
      ["kontaktperson2", "text", false, null],
      ["telefon2", "text", false, null],
      ["bemerkungen", "text", false, null],
      ["portrait", "text", false, null],
      ["pcloud_folder_id", "bigint", false, null],
      ["pcloud_folder_name", "text", false, null],
      ["created_at", "timestamp with time zone", false, "now()"],
      ["updated_at", "timestamp with time zone", false, "now()"],
      ["kontakt1_rolle", "text", false, null],
      ["kontakt1_adresse", "text", false, null],
      ["kontakt1_email", "text", false, null],
      ["kontakt2_rolle", "text", false, null],
      ["kontakt2_adresse", "text", false, null],
      ["kontakt2_email", "text", false, null],
    ],
    dokumentationen: [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["user_id", "uuid", true, "auth.uid()"],
      ["client_id", "uuid", true, null],
      ["bewilligung_id", "uuid", false, null],
      ["datum", "date", true, null],
      ["beginn", "time without time zone", true, null],
      ["ende", "time without time zone", true, null],
      ["dauer_minuten", "integer", true, null],
      ["fls", "numeric", false, null],
      ["leistungsart", "text", true, "'Face-to-Face'::text"],
      ["ort_der_leistung", "text", false, null],
      ["kennziffer", "smallint", false, null],
      ["dokumentation", "text", true, null],
      ["besonderheiten", "text", false, null],
      ["created_at", "timestamp with time zone", true, "now()"],
      ["updated_at", "timestamp with time zone", true, "now()"],
    ],
    einstellungen: [
      ["user_id", "uuid", true, "auth.uid()"],
      ["auftragnehmer_name", "text", false, null],
      ["auftragnehmer_adresse", "text", false, null],
      ["letzte_sicherung", "timestamp with time zone", false, null],
      ["updated_at", "timestamp with time zone", true, "now()"],
    ],
    route_distances: [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["user_id", "uuid", true, "auth.uid()"],
      ["start_key", "text", true, null],
      ["stops_key", "text", true, "''::text"],
      ["destination_key", "text", true, null],
      ["start_address", "text", true, null],
      ["intermediate_stops", "text", false, null],
      ["destination_address", "text", true, null],
      ["kilometers", "numeric", true, null],
      ["created_at", "timestamp with time zone", true, "now()"],
      ["updated_at", "timestamp with time zone", true, "now()"],
    ],
    termine: [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["user_id", "uuid", true, "auth.uid()"],
      ["client_id", "uuid", true, null],
      ["datum", "date", true, null],
      ["beginn", "time without time zone", true, null],
      ["ende", "time without time zone", true, null],
      ["leistungsart", "text", false, null],
      ["ort", "text", false, null],
      ["notiz", "text", false, null],
      ["serie_id", "uuid", false, null],
      ["documentation_id", "uuid", false, null],
      ["created_at", "timestamp with time zone", true, "now()"],
    ],
    textbausteine: [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["user_id", "uuid", true, "auth.uid()"],
      ["titel", "text", true, null],
      ["text", "text", true, null],
      ["art", "text", true, "'inhalt'::text"],
      ["sortierung", "integer", true, "0"],
      ["created_at", "timestamp with time zone", true, "now()"],
    ],
    trip_entries: [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["user_id", "uuid", true, "auth.uid()"],
      ["client_id", "uuid", false, null],
      ["allgemein", "boolean", true, "false"],
      ["documentation_id", "uuid", false, null],
      ["trip_date", "date", true, null],
      ["start_address", "text", false, null],
      ["intermediate_stops", "text", false, null],
      ["destination_address", "text", false, null],
      ["kilometers", "numeric", false, "0"],
      ["purpose", "text", false, null],
      ["notes", "text", false, null],
      ["created_at", "timestamp with time zone", false, "now()"],
      ["updated_at", "timestamp with time zone", true, "now()"],
      ["tacho_start", "integer", false, null],
      ["tacho_ende", "integer", false, null],
    ],
    trip_stop_suggestions: [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["user_id", "uuid", true, "auth.uid()"],
      ["name", "text", true, null],
      ["created_at", "timestamp with time zone", true, "now()"],
    ],
    verguetungssaetze: [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["user_id", "uuid", true, "auth.uid()"],
      ["art", "text", true, null],
      ["gueltig_ab", "date", true, null],
      ["betrag", "numeric", true, null],
      ["bemerkung", "text", false, null],
      ["created_at", "timestamp with time zone", true, "now()"],
    ],
  };

  // Spalte, die einen Eintrag eindeutig kennzeichnet
  const SCHLUESSEL = { einstellungen: 'user_id' };
  const schluesselSpalte = (t) => SCHLUESSEL[t] || 'id';

  // Prüfregeln (CHECK). Wie in Postgres gilt eine Regel als erfüllt,
  // wenn ihr Ergebnis wegen leerer Felder „unbekannt“ ist.
  const leer = (v) => v === null || v === undefined;
  const PRUEFREGELN = {
    bewilligungen: [
      ['bewilligungen_check', (z) => leer(z.ende) || leer(z.beginn) || z.ende >= z.beginn],
      ['bewilligungen_fls_halbjahr_1_check', (z) => leer(z.fls_halbjahr_1) || z.fls_halbjahr_1 >= 0],
      ['bewilligungen_fls_halbjahr_2_check', (z) => leer(z.fls_halbjahr_2) || z.fls_halbjahr_2 >= 0],
      ['bewilligungen_leistungstraeger_typ_check', (z) => leer(z.leistungstraeger_typ) ||
        ['LH Hannover', 'Region Hannover', 'Sonstiger Leistungsträger'].includes(z.leistungstraeger_typ)],
      ['bewilligungen_stundenkontingent_check', (z) => leer(z.stundenkontingent) || z.stundenkontingent >= 0],
      ['bewilligungen_wochen_fls_check', (z) => leer(z.wochen_fls) || z.wochen_fls >= 0]
    ],
    clients: [
      ['clients_anrede_check', (z) => leer(z.anrede) || ['Herr', 'Frau', 'Divers'].includes(z.anrede)]
    ],
    dokumentationen: [
      ['dokumentationen_check', (z) => leer(z.ende) || leer(z.beginn) || z.ende > z.beginn],
      ['dokumentationen_dauer_minuten_check', (z) => leer(z.dauer_minuten) || z.dauer_minuten > 0]
    ],
    termine: [
      ['termine_check', (z) => leer(z.ende) || leer(z.beginn) || z.ende > z.beginn]
    ],
    textbausteine: [
      ['textbausteine_art_check', (z) => leer(z.art) || ['kontakt', 'befinden', 'inhalt'].includes(z.art)]
    ],
    trip_entries: [
      ['trip_entries_klient_oder_allgemein', (z) => leer(z.allgemein) ||
        (z.allgemein === true && leer(z.client_id) && leer(z.documentation_id)) ||
        (z.allgemein === false && !leer(z.client_id))],
      ['trip_entries_tacho_pruefen', (z) =>
        (leer(z.tacho_start) || z.tacho_start >= 0) &&
        (leer(z.tacho_ende) || z.tacho_ende >= 0) &&
        (leer(z.tacho_start) || leer(z.tacho_ende) || z.tacho_ende >= z.tacho_start)]
    ],
    verguetungssaetze: [
      ['verguetungssaetze_art_check', (z) => leer(z.art) || ['fls', 'wegepauschale'].includes(z.art)]
    ]
  };

  // Eindeutigkeiten (UNIQUE / PRIMARY KEY). Leere Felder gelten wie in
  // Postgres nie als doppelt.
  const EINDEUTIG = {
    ausgaben: [['ausgaben_pkey', ['id']], ['ausgaben_user_id_beleg_jahr_beleg_nr_key', ['user_id', 'beleg_jahr', 'beleg_nr']]],
    bewilligungen: [['bewilligungen_pkey', ['id']]],
    clients: [['clients_pkey', ['id']]],
    dokumentationen: [['dokumentationen_pkey', ['id']]],
    einstellungen: [['einstellungen_pkey', ['user_id']]],
    route_distances: [['route_distances_pkey', ['id']],
      ['route_distances_user_id_start_key_stops_key_destination_key_key', ['user_id', 'start_key', 'stops_key', 'destination_key']]],
    termine: [['termine_pkey', ['id']], ['termine_documentation_id_key', ['documentation_id']]],
    textbausteine: [['textbausteine_pkey', ['id']]],
    trip_entries: [['trip_entries_pkey', ['id']]],
    trip_stop_suggestions: [['trip_stop_suggestions_pkey', ['id']]],
    verguetungssaetze: [['verguetungssaetze_pkey', ['id']],
      ['verguetungssaetze_user_id_art_gueltig_ab_key', ['user_id', 'art', 'gueltig_ab']]]
  };

  // Verknüpfungen (FOREIGN KEY): [Name, Tabelle, Spalte, Ziel, beim Löschen des Ziels]
  const VERKNUEPFUNGEN = [
    ['ausgaben_client_id_fkey', 'ausgaben', 'client_id', 'clients', 'null'],
    ['ausgaben_documentation_id_fkey', 'ausgaben', 'documentation_id', 'dokumentationen', 'null'],
    ['ausgaben_trip_id_fkey', 'ausgaben', 'trip_id', 'trip_entries', 'null'],
    ['bewilligungen_client_id_fkey', 'bewilligungen', 'client_id', 'clients', 'loeschen'],
    ['dokumentationen_bewilligung_id_fkey', 'dokumentationen', 'bewilligung_id', 'bewilligungen', 'null'],
    ['dokumentationen_client_id_fkey', 'dokumentationen', 'client_id', 'clients', 'loeschen'],
    ['termine_client_id_fkey', 'termine', 'client_id', 'clients', 'loeschen'],
    ['termine_documentation_id_fkey', 'termine', 'documentation_id', 'dokumentationen', 'null'],
    ['trip_entries_client_id_fkey', 'trip_entries', 'client_id', 'clients', 'loeschen'],
    ['trip_entries_documentation_id_fkey', 'trip_entries', 'documentation_id', 'dokumentationen', 'null']
  ];

  // Trigger: Zeitstempel bei jeder Änderung einer Fahrt
  const BEIM_AENDERN = {
    trip_entries: (neu, jetzt) => { neu.updated_at = jetzt; }
  };

  // Spalten-Nachschlagetabelle
  const SPALTE = {};
  for (const [t, liste] of Object.entries(SPALTEN)) {
    SPALTE[t] = {};
    for (const [name, typ, pflicht, standard] of liste) SPALTE[t][name] = { name, typ, pflicht, standard };
  }

  /* =================================================================
     B. Werte umwandeln – genau wie Postgres sie speichert und Supabase
        sie zurückgibt
     ================================================================= */

  class DbFehler extends Error {}
  const fehler = (text) => new DbFehler(text);

  const UUID_MUSTER = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

  function zeitstempelText(ms) {
    const iso = new Date(ms).toISOString(); // 2026-10-31T11:13:00.120Z
    let [haupt, bruch] = iso.slice(0, -1).split('.');
    bruch = (bruch || '').replace(/0+$/, '');
    return haupt + (bruch ? '.' + bruch : '') + '+00:00';
  }

  function ungueltig(typ, wert) {
    return fehler('invalid input syntax for type ' + typ + ': "' + String(wert) + '"');
  }

  function umwandeln(typ, wert) {
    if (wert === null || wert === undefined) return null;
    switch (typ) {
      case 'uuid': {
        const s = String(wert).trim();
        if (!UUID_MUSTER.test(s)) throw ungueltig('uuid', wert);
        const h = s.replace(/-/g, '').toLowerCase();
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
      }
      case 'text':
        return typeof wert === 'object' ? JSON.stringify(wert) : String(wert);
      case 'integer':
      case 'smallint':
      case 'bigint': {
        if (typeof wert === 'boolean') throw ungueltig(typ, wert);
        const s = String(wert).trim();
        if (!/^[+-]?\d+$/.test(s)) throw ungueltig(typ, wert);
        return Number(s);
      }
      case 'numeric': {
        if (typeof wert === 'boolean') throw ungueltig('numeric', wert);
        const s = String(wert).trim();
        if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) throw ungueltig('numeric', wert);
        return Number(s);
      }
      case 'boolean': {
        if (typeof wert === 'boolean') return wert;
        const s = String(wert).trim().toLowerCase();
        if (['t', 'true', 'y', 'yes', 'on', '1'].includes(s)) return true;
        if (['f', 'false', 'n', 'no', 'off', '0'].includes(s)) return false;
        throw ungueltig('boolean', wert);
      }
      case 'date': {
        const s = String(wert).trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) throw ungueltig('date', wert);
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
          throw fehler('date/time field value out of range: "' + s + '"');
        }
        return s;
      }
      case 'time without time zone': {
        const s = String(wert).trim();
        const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/.exec(s);
        if (!m || +m[1] > 24 || +m[2] > 59 || (m[3] && +m[3] > 59)) throw ungueltig('time', wert);
        let bruch = (m[4] || '').replace(/0+$/, '');
        if (bruch === '.') bruch = '';
        return String(+m[1]).padStart(2, '0') + ':' + m[2] + ':' + (m[3] || '00') + bruch;
      }
      case 'timestamp with time zone': {
        const ms = typeof wert === 'number' ? wert : Date.parse(String(wert));
        if (!Number.isFinite(ms)) throw ungueltig('timestamp with time zone', wert);
        return zeitstempelText(ms);
      }
      default:
        return wert;
    }
  }

  // Vergleich zweier gespeicherter Werte gleichen Typs
  const SORTIERER = new Intl.Collator('en-US');
  function vergleichen(typ, a, b) {
    if (typ === 'text') return SORTIERER.compare(a, b);
    if (typ === 'timestamp with time zone') return Date.parse(a) - Date.parse(b);
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /* =================================================================
     C. Anfragen im Arbeitsspeicher ausführen
     ================================================================= */

  let daten = null;        // { tabelle: Map(schluessel → Zeile) }
  let reihenfolge = null;  // { tabelle: Map(schluessel → laufende Nummer) }
  let zaehler = 0;
  let nutzerId = null;

  function tabelleSicher(t) {
    if (!SPALTE[t]) throw fehler('relation "public.' + t + '" does not exist');
    return SPALTE[t];
  }

  function spalteSicher(t, s) {
    const sp = tabelleSicher(t)[s];
    if (!sp) throw fehler('column ' + t + '.' + s + ' does not exist');
    return sp;
  }

  function spaltenListe(t, text) {
    if (text === undefined || text === null) text = '*';
    const teile = String(text).split(',').map((s) => s.trim()).filter(Boolean);
    const liste = [];
    for (const teil of teile) {
      if (teil === '*') liste.push(...SPALTEN[t].map((s) => s[0]));
      else {
        spalteSicher(t, teil);
        liste.push(teil);
      }
    }
    return liste;
  }

  // Ein einzelner Filter: gibt true/false zurück (unbekannt = false)
  function filterPruefen(t, zeile, art, spalte, wert) {
    const sp = spalteSicher(t, spalte);
    const v = zeile[spalte];
    if (art === 'is') {
      if (wert === null || wert === 'null') return v === null;
      if (wert === true || wert === 'true') return v === true;
      if (wert === false || wert === 'false') return v === false;
      throw fehler('failed to parse filter (is.' + wert + ')');
    }
    if (art === 'in') {
      const liste = Array.isArray(wert) ? wert : String(wert).replace(/^\(|\)$/g, '').split(',');
      if (v === null) return false;
      return liste.some((w) => vergleichen(sp.typ, v, umwandeln(sp.typ, w)) === 0);
    }
    if (art === 'like' || art === 'ilike') {
      if (v === null) return false;
      const muster = '^' + String(wert).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.') + '$';
      return new RegExp(muster, art === 'ilike' ? 'is' : 's').test(String(v));
    }
    if (v === null || wert === null || wert === undefined) return false;
    const w = umwandeln(sp.typ, wert);
    const c = vergleichen(sp.typ, v, w);
    switch (art) {
      case 'eq': return c === 0;
      case 'neq': return c !== 0;
      case 'gt': return c > 0;
      case 'gte': return c >= 0;
      case 'lt': return c < 0;
      case 'lte': return c <= 0;
      default: throw fehler('Unbekannter Filter: ' + art);
    }
  }

  // „spalte.op.wert,spalte.op.wert“ (für .or)
  function oderTeile(ausdruck) {
    return String(ausdruck).split(',').map((teil) => {
      const a = teil.indexOf('.');
      const b = teil.indexOf('.', a + 1);
      if (a < 0 || b < 0) throw fehler('failed to parse logic tree (' + ausdruck + ')');
      const spalte = teil.slice(0, a).trim();
      let art = teil.slice(a + 1, b).trim();
      let wert = teil.slice(b + 1);
      let nicht = false;
      if (art === 'not') {
        nicht = true;
        const c = wert.indexOf('.');
        art = wert.slice(0, c);
        wert = wert.slice(c + 1);
      }
      return { spalte, art, wert, nicht };
    });
  }

  function passt(t, zeile, filter) {
    for (const f of filter) {
      if (f.art === 'or') {
        const teile = oderTeile(f.ausdruck);
        const eins = teile.some((p) => {
          const r = filterPruefen(t, zeile, p.art, p.spalte, p.wert);
          return p.nicht ? !r : r;
        });
        if (!eins) return false;
      } else if (f.art === 'not') {
        if (f.operator === 'is') {
          if (filterPruefen(t, zeile, 'is', f.spalte, f.wert)) return false;
        } else {
          if (zeile[f.spalte] === null) return false;
          if (filterPruefen(t, zeile, f.operator, f.spalte, f.wert)) return false;
        }
      } else if (!filterPruefen(t, zeile, f.art, f.spalte, f.wert)) {
        return false;
      }
    }
    return true;
  }

  function sortieren(t, zeilen, sortierung) {
    if (!sortierung.length) return zeilen;
    const regeln = sortierung.map((s) => {
      const sp = spalteSicher(t, s.spalte);
      const o = s.optionen || {};
      const auf = o.ascending !== false;
      const nullsZuerst = o.nullsFirst !== undefined ? o.nullsFirst : !auf;
      return { spalte: s.spalte, typ: sp.typ, auf, nullsZuerst };
    });
    return zeilen
      .map((z, i) => [z, i])
      .sort(([a, ia], [b, ib]) => {
        for (const r of regeln) {
          const va = a[r.spalte];
          const vb = b[r.spalte];
          if (va === null && vb === null) continue;
          if (va === null) return r.nullsZuerst ? -1 : 1;
          if (vb === null) return r.nullsZuerst ? 1 : -1;
          const c = vergleichen(r.typ, va, vb);
          if (c !== 0) return r.auf ? c : -c;
        }
        return ia - ib;
      })
      .map(([z]) => z);
  }

  // Zeilen einer Tabelle in Speicher-Reihenfolge (wie Postgres ohne Sortierung)
  function zeilenVon(stand, t) {
    const m = stand.daten[t];
    const nr = stand.reihenfolge[t];
    return [...m.values()].sort(
      (a, b) => nr.get(a[schluesselSpalte(t)]) - nr.get(b[schluesselSpalte(t)])
    );
  }

  function ausschnitt(zeile, spalten) {
    const o = {};
    for (const s of spalten) o[s] = kopie(zeile[s]);
    return o;
  }

  const kopie = (v) => (v !== null && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

  function antwortFormen(b, zeilen, spalten, mitZaehlung) {
    const anzahl = mitZaehlung ? zeilen.length : null;
    if (b.leseOptionen && b.leseOptionen.head) return { data: null, error: null, count: anzahl };
    let liste = zeilen.map((z) => ausschnitt(z, spalten));
    if (b.einzeln === 'single') {
      if (liste.length !== 1) throw fehler('JSON object requested, multiple (or no) rows returned');
      return { data: liste[0], error: null, count: anzahl };
    }
    if (b.einzeln === 'maybeSingle') {
      if (liste.length > 1) throw fehler('JSON object requested, multiple (or no) rows returned');
      return { data: liste[0] || null, error: null, count: anzahl };
    }
    return { data: liste, error: null, count: anzahl };
  }

  function lesen(b) {
    const t = b.tabelle;
    tabelleSicher(t);
    const spalten = spaltenListe(t, b.spalten);
    let zeilen = zeilenVon({ daten, reihenfolge }, t).filter((z) => passt(t, z, b.filter));
    const mitZaehlung = Boolean(b.leseOptionen && b.leseOptionen.count);
    const gesamt = zeilen.length;
    zeilen = sortieren(t, zeilen, b.sortierung);
    if (b.grenze !== null && b.grenze !== undefined) zeilen = zeilen.slice(0, b.grenze);
    const antwort = antwortFormen(b, zeilen, spalten, false);
    if (mitZaehlung) antwort.count = gesamt;
    return antwort;
  }

  /* ---------- Schreiben: erst alles im Entwurf prüfen, dann übernehmen ---------- */

  function entwurfAnlegen() {
    return { daten: Object.assign({}, daten), reihenfolge: Object.assign({}, reihenfolge), geaendert: {} };
  }

  function entwurfTabelle(e, t) {
    if (!e.geaendert[t]) {
      e.daten[t] = new Map(daten[t]);
      e.reihenfolge[t] = new Map(reihenfolge[t]);
      e.geaendert[t] = new Set();
    }
    return e.daten[t];
  }

  function entwurfSetzen(e, t, zeile) {
    const m = entwurfTabelle(e, t);
    const k = zeile[schluesselSpalte(t)];
    m.set(k, zeile);
    e.reihenfolge[t].set(k, ++zaehler); // geänderte Zeilen rutschen ans Ende (wie in Postgres)
    e.geaendert[t].add(k);
  }

  function entwurfLoeschen(e, t, k) {
    const m = entwurfTabelle(e, t);
    m.delete(k);
    e.reihenfolge[t].delete(k);
    e.geaendert[t].add(k);
  }

  function standardWert(sp, jetzt) {
    const s = sp.standard;
    if (s === null || s === undefined) return null;
    if (s === 'now()') return jetzt;
    if (s === 'gen_random_uuid()') return crypto.randomUUID();
    if (s === 'auth.uid()') return nutzerId;
    if (s === 'false') return false;
    if (s === 'true') return true;
    const text = /^'(.*)'::text$/.exec(s);
    if (text) return text[1].replace(/''/g, "'");
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return null;
  }

  // Werte aus der App in die Form bringen, in der sie gespeichert werden
  function werteUmwandeln(t, werte) {
    const sp = tabelleSicher(t);
    const aus = {};
    for (const [name, wert] of Object.entries(werte)) {
      if (!sp[name]) {
        throw fehler("Could not find the '" + name + "' column of '" + t + "' in the schema cache");
      }
      if (wert === undefined) continue;
      aus[name] = umwandeln(sp[name].typ, wert);
    }
    return aus;
  }

  function zeilePruefen(e, t, zeile) {
    for (const [name, typ, pflicht] of SPALTEN[t]) {
      if (pflicht && zeile[name] === null) {
        throw fehler('null value in column "' + name + '" of relation "' + t + '" violates not-null constraint');
      }
      void typ;
    }
    for (const [name, regel] of PRUEFREGELN[t] || []) {
      if (!regel(zeile)) throw fehler('new row for relation "' + t + '" violates check constraint "' + name + '"');
    }
  }

  function eindeutigPruefen(e, t, zeile) {
    const k = zeile[schluesselSpalte(t)];
    for (const [name, spalten] of EINDEUTIG[t] || []) {
      if (spalten.some((s) => zeile[s] === null)) continue;
      for (const andere of e.daten[t].values()) {
        if (andere[schluesselSpalte(t)] === k) continue;
        if (spalten.every((s) => andere[s] === zeile[s])) {
          throw fehler('duplicate key value violates unique constraint "' + name + '"');
        }
      }
    }
  }

  function verknuepfungenPruefen(e, t, zeile) {
    for (const [name, tab, spalte, ziel] of VERKNUEPFUNGEN) {
      if (tab !== t || zeile[spalte] === null) continue;
      if (!e.daten[ziel].has(zeile[spalte])) {
        throw fehler('insert or update on table "' + t + '" violates foreign key constraint "' + name + '"');
      }
    }
  }

  function einfuegen(e, t, werteListe, jetzt, konflikt) {
    const liste = Array.isArray(werteListe) ? werteListe : [werteListe];
    // Spalten, die in irgendeiner Zeile vorkommen, werden in den anderen
    // Zeilen leer gesetzt (wie bei Supabase); nur ganz fehlende Spalten
    // bekommen den Standardwert.
    const genannt = new Set();
    for (const w of liste) for (const [n, v] of Object.entries(w || {})) if (v !== undefined) genannt.add(n);
    const ergebnis = [];
    const pruefen = [];
    for (const w of liste) {
      const umgewandelt = werteUmwandeln(t, w || {});
      const neu = {};
      for (const [name] of SPALTEN[t]) {
        if (Object.prototype.hasOwnProperty.call(umgewandelt, name)) neu[name] = umgewandelt[name];
        else if (genannt.has(name)) neu[name] = null;
        else neu[name] = standardWert(SPALTE[t][name], jetzt);
      }

      let vorhanden = null;
      if (konflikt) {
        if (!konflikt.every((s) => SPALTE[t][s])) throw fehler('there is no unique or exclusion constraint matching the ON CONFLICT specification');
        if (!konflikt.some((s) => neu[s] === null)) {
          for (const z of e.daten[t].values()) {
            if (konflikt.every((s) => z[s] === neu[s])) { vorhanden = z; break; }
          }
        }
      }

      if (vorhanden) {
        const geaendert = Object.assign({}, vorhanden);
        for (const name of Object.keys(umgewandelt)) geaendert[name] = umgewandelt[name];
        for (const name of genannt) if (!(name in umgewandelt)) geaendert[name] = null;
        if (BEIM_AENDERN[t]) BEIM_AENDERN[t](geaendert, jetzt);
        zeilePruefen(e, t, geaendert);
        entwurfLoeschen(e, t, vorhanden[schluesselSpalte(t)]);
        entwurfSetzen(e, t, geaendert);
        pruefen.push(geaendert);
        ergebnis.push(geaendert);
      } else {
        zeilePruefen(e, t, neu);
        const k = neu[schluesselSpalte(t)];
        entwurfTabelle(e, t);
        if (e.daten[t].has(k)) {
          throw fehler('duplicate key value violates unique constraint "' + EINDEUTIG[t][0][0] + '"');
        }
        entwurfSetzen(e, t, neu);
        pruefen.push(neu);
        ergebnis.push(neu);
      }
    }
    for (const z of pruefen) {
      eindeutigPruefen(e, t, z);
      verknuepfungenPruefen(e, t, z);
    }
    return ergebnis;
  }

  function aendern(e, t, werte, filter, jetzt) {
    const umgewandelt = werteUmwandeln(t, werte || {});
    const treffer = zeilenVon(e, t).filter((z) => passt(t, z, filter));
    const ergebnis = [];
    for (const alt of treffer) {
      const neu = Object.assign({}, alt, umgewandelt);
      if (BEIM_AENDERN[t]) BEIM_AENDERN[t](neu, jetzt);
      zeilePruefen(e, t, neu);
      entwurfSetzen(e, t, neu);
      ergebnis.push(neu);
    }
    for (const z of ergebnis) {
      eindeutigPruefen(e, t, z);
      verknuepfungenPruefen(e, t, z);
    }
    return ergebnis;
  }

  // Löschen mit Löschfolgen: abhängige Einträge werden mitgelöscht oder
  // ihre Verknüpfung wird geleert – wie bisher in der Datenbank
  function loeschen(e, t, filter, jetzt) {
    const treffer = zeilenVon(e, t).filter((z) => passt(t, z, filter));
    for (const z of treffer) zeileLoeschen(e, t, z, jetzt);
    return treffer;
  }

  function zeileLoeschen(e, t, zeile, jetzt) {
    const k = zeile[schluesselSpalte(t)];
    if (!entwurfTabelle(e, t).has(k)) return;
    entwurfLoeschen(e, t, k);
    for (const [, tab, spalte, ziel, folge] of VERKNUEPFUNGEN) {
      if (ziel !== t) continue;
      for (const abh of zeilenVon(e, tab)) {
        if (abh[spalte] !== k) continue;
        if (folge === 'loeschen') zeileLoeschen(e, tab, abh, jetzt);
        else {
          const neu = Object.assign({}, abh, { [spalte]: null });
          if (BEIM_AENDERN[tab]) BEIM_AENDERN[tab](neu, jetzt);
          zeilePruefen(e, tab, neu);
          entwurfSetzen(e, tab, neu);
        }
      }
    }
  }

  function schreibenAusfuehren(b) {
    const t = b.tabelle;
    tabelleSicher(t);
    const e = entwurfAnlegen();
    const jetzt = zeitstempelText(Date.now());
    let zeilen;
    if (b.aktion === 'insert') zeilen = einfuegen(e, t, b.werte, jetzt, null);
    else if (b.aktion === 'upsert') {
      const o = b.schreibOptionen || {};
      const konflikt = o.onConflict
        ? String(o.onConflict).split(',').map((s) => s.trim())
        : [schluesselSpalte(t)];
      zeilen = einfuegen(e, t, b.werte, jetzt, konflikt);
    } else if (b.aktion === 'update') zeilen = aendern(e, t, b.werte, b.filter, jetzt);
    else if (b.aktion === 'delete') zeilen = loeschen(e, t, b.filter, jetzt);
    else throw fehler('Unbekannte Aktion: ' + b.aktion);

    let antwort = { data: null, error: null, count: null };
    if (b.rueckgabe !== null && b.rueckgabe !== undefined) {
      const spalten = spaltenListe(t, b.rueckgabe);
      antwort = antwortFormen(b, sortieren(t, zeilen, b.sortierung), spalten, false);
    } else if (b.einzeln) {
      antwort = antwortFormen(b, zeilen, spaltenListe(t, '*'), false);
      antwort.data = null;
    }
    return { e, antwort };
  }

  // Änderungen des Entwurfs: [{ tabelle, schluessel, zeile | null }]
  function entwurfAenderungen(e) {
    const liste = [];
    for (const [t, set] of Object.entries(e.geaendert)) {
      for (const k of set) {
        const neu = e.daten[t].get(k) || null;
        const alt = daten[t].get(k) || null;
        if (neu === alt) continue;
        liste.push({ tabelle: t, schluessel: k, zeile: neu });
      }
    }
    return liste;
  }

  /* =================================================================
     D. Verschlüsselung der Pakete
     ================================================================= */

  const TEXT = new TextEncoder();
  const LESEN = new TextDecoder();
  let schluesselHolen = null; // () => CryptoKey

  function zuBase64(bytes) {
    let s = '';
    const b = new Uint8Array(bytes);
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function ausBase64(text) {
    const s = atob(text);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }

  const zusatz = (id) => TEXT.encode('qa-daten-v1|' + nutzerId + '|' + id);

  function schluessel() {
    const k = schluesselHolen && schluesselHolen();
    if (!k) throw fehler('Der Tresor ist gesperrt.');
    return k;
  }

  // Inhalt eines Pakets: { t: Tabelle, z: Zeile oder null (gelöscht), g: Zeitpunkt der Änderung }
  async function verschluesseln(id, inhalt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const geheim = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: zusatz(id) },
      schluessel(),
      TEXT.encode(JSON.stringify(inhalt))
    );
    const alles = new Uint8Array(12 + geheim.byteLength);
    alles.set(iv, 0);
    alles.set(new Uint8Array(geheim), 12);
    return 'v1.' + zuBase64(alles);
  }

  async function entschluesseln(id, text) {
    if (typeof text !== 'string' || !text.startsWith('v1.')) throw new Error('Unbekanntes Paketformat');
    const alles = ausBase64(text.slice(3));
    const klar = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: alles.subarray(0, 12), additionalData: zusatz(id) },
      schluessel(),
      alles.subarray(12)
    );
    return JSON.parse(LESEN.decode(klar));
  }

  /* =================================================================
     E. IndexedDB (Speicher im Browser)
     ================================================================= */

  let db = null;
  const dbName = (id) => 'qa-geraet-' + id;

  function anfrage(r) {
    return new Promise((ok, nein) => {
      r.onsuccess = () => ok(r.result);
      r.onerror = () => nein(r.error);
    });
  }

  function dbOeffnen(id) {
    return new Promise((ok, nein) => {
      const r = indexedDB.open(dbName(id), 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('pakete', { keyPath: 'id' });
        d.createObjectStore('ausgang', { keyPath: 'id' });
        d.createObjectStore('meta');
        d.createObjectStore('konflikte', { keyPath: 'nr', autoIncrement: true });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => nein(r.error);
      r.onblocked = () => nein(new Error('Die Gerätedatenbank ist in einem anderen Fenster geöffnet.'));
    });
  }

  function vorgang(stores, art, arbeit) {
    return new Promise((ok, nein) => {
      const tx = db.transaction(stores, art);
      let ergebnis;
      Promise.resolve(arbeit(tx)).then((r) => { ergebnis = r; }, (f) => { try { tx.abort(); } catch (x) { /* schon beendet */ } nein(f); });
      tx.oncomplete = () => ok(ergebnis);
      tx.onerror = () => nein(tx.error);
      tx.onabort = () => nein(tx.error || new Error('Speichern auf dem Gerät abgebrochen.'));
    });
  }

  const alleLesen = (store) => vorgang([store], 'readonly', (tx) => anfrage(tx.objectStore(store).getAll()));
  const metaLesen = (k) => vorgang(['meta'], 'readonly', (tx) => anfrage(tx.objectStore('meta').get(k)));
  const metaSchreiben = (k, v) => vorgang(['meta'], 'readwrite', (tx) => { tx.objectStore('meta').put(v, k); });

  /* =================================================================
     F. Änderungen speichern (Arbeitsspeicher + Gerät + Ausgang)
     ================================================================= */

  let warteschlange = Promise.resolve();
  function nacheinander(arbeit) {
    const r = warteschlange.then(arbeit, arbeit);
    warteschlange = r.catch(() => {});
    return r;
  }

  // Schreibt die Änderungen eines Entwurfs verschlüsselt auf das Gerät
  // und übernimmt sie danach in den Arbeitsspeicher
  async function uebernehmen(e) {
    const aenderungen = entwurfAenderungen(e);
    if (aenderungen.length) {
      const g = Date.now();
      const pakete = [];
      for (const a of aenderungen) {
        const inhalt = await verschluesseln(a.schluessel, { t: a.tabelle, z: a.zeile, g });
        pakete.push({ id: a.schluessel, inhalt, geloescht: a.zeile === null });
      }
      await vorgang(['pakete', 'ausgang'], 'readwrite', async (tx) => {
        const ps = tx.objectStore('pakete');
        const as = tx.objectStore('ausgang');
        for (const p of pakete) {
          const altPaket = await anfrage(ps.get(p.id));
          const altAusgang = await anfrage(as.get(p.id));
          const version = altPaket ? altPaket.version : 0;
          ps.put({ id: p.id, version, inhalt: p.inhalt, geloescht: p.geloescht });
          as.put({
            id: p.id,
            basis: altAusgang ? altAusgang.basis : version,
            inhalt: p.inhalt,
            geloescht: p.geloescht,
            stand: (altAusgang ? altAusgang.stand : 0) + 1
          });
        }
      });
    }
    for (const t of Object.keys(e.geaendert)) {
      daten[t] = e.daten[t];
      reihenfolge[t] = e.reihenfolge[t];
    }
    if (aenderungen.length) {
      wartendZahl = await ausgangZahl();
      statusMelden();
      abgleichBald();
    }
  }

  const ausgangZahl = () => vorgang(['ausgang'], 'readonly', (tx) => anfrage(tx.objectStore('ausgang').count()));

  // Der Speicher für daten.js
  const speicher = {
    name: 'geraet',
    ausfuehren(b) {
      if (!daten) return Promise.resolve({ data: null, count: null, error: { message: 'Der Gerätespeicher ist nicht geöffnet.' } });
      if (b.aktion === 'select') {
        // Lesen wartet auf laufende Schreibvorgänge, damit die Reihenfolge stimmt
        return warteschlange.then(() => {
          try { return lesen(b); } catch (f) { return fehlerAntwort(f); }
        });
      }
      return nacheinander(async () => {
        let ergebnis;
        try {
          ergebnis = schreibenAusfuehren(b);
        } catch (f) {
          return fehlerAntwort(f);
        }
        try {
          await uebernehmen(ergebnis.e);
        } catch (f) {
          return fehlerAntwort(new Error('Speichern auf dem Gerät fehlgeschlagen: ' + (f && f.message ? f.message : f)));
        }
        return ergebnis.antwort;
      });
    }
  };

  function fehlerAntwort(f) {
    if (!(f instanceof DbFehler)) console.error('Gerätespeicher:', f);
    return { data: null, count: null, error: { message: f && f.message ? f.message : String(f) } };
  }

  /* =================================================================
     G. Abgleich mit dem Server
     ================================================================= */

  let sb = null;
  let melden = () => {};
  let fremdGeaendert = () => {};
  let status = { zustand: 'offline', wartend: 0, zuletzt: null, meldung: '' };
  let wartendZahl = 0;
  let abgleichLaeuft = null;
  let abgleichNochmal = false;
  let baldTimer = null;
  let intervall = null;
  const PAKET_GRUPPE = 100;

  function statusMelden(teil) {
    status = Object.assign({}, status, teil || {}, { wartend: wartendZahl });
    try { melden(Object.assign({}, status)); } catch (f) { console.error(f); }
  }

  function abgleichBald() {
    clearTimeout(baldTimer);
    baldTimer = setTimeout(() => abgleichen(), 1500);
  }

  // Ein Paket vom Server auf dem Gerät übernehmen (ohne Regeln – das
  // andere Gerät hat sie schon angewandt)
  function fremdesPaketUebernehmen(t, schl, zeile) {
    if (!SPALTE[t]) return false;
    const m = new Map(daten[t]);
    const nr = new Map(reihenfolge[t]);
    if (zeile) {
      m.set(schl, zeile);
      nr.set(schl, ++zaehler);
    } else {
      m.delete(schl);
      nr.delete(schl);
    }
    daten[t] = m;
    reihenfolge[t] = nr;
    return true;
  }

  async function konfliktAblegen(id, inhalt, seite) {
    await vorgang(['konflikte'], 'readwrite', (tx) => {
      tx.objectStore('konflikte').add({ id, inhalt, seite, zeit: Date.now() });
    });
  }

  async function senden() {
    const ausgang = await alleLesen('ausgang');
    const geaenderteTabellen = new Set();
    for (let i = 0; i < ausgang.length; i += PAKET_GRUPPE) {
      const gruppe = ausgang.slice(i, i + PAKET_GRUPPE);
      const { data, error } = await sb.rpc('datensaetze_speichern', {
        p_pakete: gruppe.map((a) => ({ id: a.id, basis: a.basis, inhalt: a.inhalt, geloescht: a.geloescht }))
      });
      if (error) throw error;
      const gesendet = new Map(gruppe.map((a) => [a.id, a]));
      for (const r of data || []) {
        const a = gesendet.get(r.id);
        if (!a) continue;
        if (r.ok) {
          await vorgang(['pakete', 'ausgang'], 'readwrite', async (tx) => {
            const ps = tx.objectStore('pakete');
            const as = tx.objectStore('ausgang');
            const p = await anfrage(ps.get(r.id));
            if (p) ps.put(Object.assign(p, { version: r.version }));
            const jetzt = await anfrage(as.get(r.id));
            if (jetzt && jetzt.stand === a.stand) as.delete(r.id);
            else if (jetzt) as.put(Object.assign(jetzt, { basis: r.version }));
          });
          continue;
        }
        // Konflikt: Derselbe Eintrag wurde auf einem anderen Gerät geändert
        await nacheinander(async () => {
          let fremd = null;
          let eigen = null;
          try { fremd = await entschluesseln(r.id, r.inhalt); } catch (f) { fremd = null; }
          try { eigen = await entschluesseln(a.id, a.inhalt); } catch (f) { eigen = null; }
          const fremdGilt = fremd && (!eigen || fremd.g > eigen.g);
          if (fremdGilt) {
            await konfliktAblegen(a.id, a.inhalt, 'eigene');
            await vorgang(['pakete', 'ausgang'], 'readwrite', async (tx) => {
              tx.objectStore('pakete').put({ id: r.id, version: r.version, inhalt: r.inhalt, geloescht: r.geloescht });
              const jetzt = await anfrage(tx.objectStore('ausgang').get(r.id));
              if (jetzt && jetzt.stand === a.stand) tx.objectStore('ausgang').delete(r.id);
              else if (jetzt) tx.objectStore('ausgang').put(Object.assign(jetzt, { basis: r.version }));
            });
            if (fremdesPaketUebernehmen(fremd.t, r.id, fremd.z)) geaenderteTabellen.add(fremd.t);
          } else {
            if (r.inhalt) await konfliktAblegen(r.id, r.inhalt, 'fremde');
            await vorgang(['ausgang', 'pakete'], 'readwrite', async (tx) => {
              const jetzt = await anfrage(tx.objectStore('ausgang').get(r.id));
              if (jetzt) tx.objectStore('ausgang').put(Object.assign(jetzt, { basis: r.version }));
              const p = await anfrage(tx.objectStore('pakete').get(r.id));
              if (p) tx.objectStore('pakete').put(Object.assign(p, { version: r.version }));
            });
            abgleichNochmal = true; // die eigene Fassung beim nächsten Durchgang senden
          }
        });
      }
    }
    return geaenderteTabellen;
  }

  async function holen() {
    const ab = (await metaLesen('abgleich_ab')) || 0;
    const { data, error } = await sb.rpc('datensaetze_holen', { p_ab: ab });
    if (error) throw error;
    const zeilen = data || [];
    const ende = zeilen.find((z) => z.id === null);
    const neue = zeilen.filter((z) => z.id !== null);
    const geaenderteTabellen = new Set();
    let fehlerhaft = 0;

    if (neue.length) {
      await nacheinander(async () => {
        const ausgang = new Set((await alleLesen('ausgang')).map((a) => a.id));
        const bekannt = new Map((await alleLesen('pakete')).map((p) => [p.id, p.version]));
        const uebernehmenListe = [];
        for (const z of neue) {
          if (ausgang.has(z.id)) continue; // eigene Änderung wartet noch: klärt der nächste Durchgang
          if ((bekannt.get(z.id) || 0) >= z.version) continue; // schon bekannt
          let inhalt;
          try {
            inhalt = await entschluesseln(z.id, z.inhalt);
          } catch (f) {
            fehlerhaft++;
            continue;
          }
          uebernehmenListe.push({ z, inhalt });
        }
        if (uebernehmenListe.length) {
          await vorgang(['pakete'], 'readwrite', (tx) => {
            for (const { z } of uebernehmenListe) {
              tx.objectStore('pakete').put({ id: z.id, version: z.version, inhalt: z.inhalt, geloescht: z.geloescht });
            }
          });
          for (const { z, inhalt } of uebernehmenListe) {
            if (fremdesPaketUebernehmen(inhalt.t, z.id, inhalt.z)) geaenderteTabellen.add(inhalt.t);
          }
        }
      });
    }
    if (ende && ende.bis !== null) await metaSchreiben('abgleich_ab', ende.bis);
    return { geaenderteTabellen, fehlerhaft };
  }

  async function abgleichDurchgang() {
    if (!db || !sb) return;
    if (!schluesselHolen || !schluesselHolen()) return; // gesperrt
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      statusMelden({ zustand: 'offline' });
      return;
    }
    statusMelden({ zustand: 'abgleich' });
    try {
      const geaendert = new Set();
      let runden = 0;
      do {
        abgleichNochmal = false;
        for (const t of await senden()) geaendert.add(t);
        runden++;
      } while (abgleichNochmal && runden < 3);
      const geholt = await holen();
      for (const t of geholt.geaenderteTabellen) geaendert.add(t);
      wartendZahl = await ausgangZahl();
      statusMelden({
        zustand: 'ok',
        zuletzt: Date.now(),
        meldung: geholt.fehlerhaft ? geholt.fehlerhaft + ' Pakete konnten nicht geöffnet werden.' : ''
      });
      if (geaendert.size) {
        try { fremdGeaendert([...geaendert]); } catch (f) { console.error(f); }
      }
    } catch (f) {
      wartendZahl = await ausgangZahl().catch(() => wartendZahl);
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        /fetch|network|netzwerk|load failed/i.test(String(f && f.message));
      statusMelden({ zustand: offline ? 'offline' : 'fehler', meldung: f && f.message ? f.message : String(f) });
    }
  }

  function abgleichen() {
    clearTimeout(baldTimer);
    if (abgleichLaeuft) {
      abgleichNochmal = true;
      return abgleichLaeuft;
    }
    abgleichLaeuft = abgleichDurchgang().finally(() => {
      abgleichLaeuft = null;
    });
    return abgleichLaeuft;
  }

  /* =================================================================
     H. Öffnen, Schließen, Entfernen
     ================================================================= */

  async function oeffnen(optionen) {
    if (db && nutzerId === optionen.user.id && daten) {
      sb = optionen.sb;
      melden = optionen.status || melden;
      fremdGeaendert = optionen.fremdGeaendert || fremdGeaendert;
      schluesselHolen = optionen.schluessel;
      abgleichen();
      return;
    }
    schliessen();
    sb = optionen.sb;
    nutzerId = optionen.user.id;
    schluesselHolen = optionen.schluessel;
    melden = optionen.status || (() => {});
    fremdGeaendert = optionen.fremdGeaendert || (() => {});

    db = await dbOeffnen(nutzerId);

    // Alle Pakete entschlüsseln und in den Arbeitsspeicher laden
    const neueDaten = {};
    const neueReihenfolge = {};
    for (const t of Object.keys(SPALTEN)) {
      neueDaten[t] = new Map();
      neueReihenfolge[t] = new Map();
    }
    const pakete = await alleLesen('pakete');
    const geladen = [];
    let fehlerhaft = 0;
    for (const p of pakete) {
      try {
        const inhalt = await entschluesseln(p.id, p.inhalt);
        if (inhalt.z && SPALTE[inhalt.t]) geladen.push({ t: inhalt.t, id: p.id, z: inhalt.z, g: inhalt.g || 0 });
      } catch (f) {
        fehlerhaft++;
      }
    }
    geladen.sort((a, b) => a.g - b.g);
    for (const x of geladen) {
      neueDaten[x.t].set(x.id, x.z);
      neueReihenfolge[x.t].set(x.id, ++zaehler);
    }
    daten = neueDaten;
    reihenfolge = neueReihenfolge;

    // Den Browser bitten, die Daten nicht von selbst zu löschen
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (f) { /* nicht unterstützt */ }

    wartendZahl = await ausgangZahl();
    statusMelden({ zustand: navigator.onLine === false ? 'offline' : 'abgleich', meldung: fehlerhaft ? fehlerhaft + ' Pakete konnten nicht geöffnet werden.' : '' });

    // Erster Abgleich: auf einem neuen Gerät abwarten, damit die Daten da sind
    const ersterAbgleich = abgleichen();
    if (pakete.length === 0) await ersterAbgleich;

    clearInterval(intervall);
    intervall = setInterval(() => abgleichen(), 2 * 60 * 1000);
  }

  function schliessen() {
    clearInterval(intervall);
    clearTimeout(baldTimer);
    intervall = null;
    if (db) db.close();
    db = null;
    daten = null;
    reihenfolge = null;
    nutzerId = null;
    schluesselHolen = null;
    wartendZahl = 0;
    status = { zustand: 'offline', wartend: 0, zuletzt: null, meldung: '' };
  }

  // Löscht die Gerätedatenbank eines Kontos (z. B. bei abgegebenen Geräten)
  async function entfernen(id) {
    if (nutzerId === id) schliessen();
    await new Promise((ok, nein) => {
      const r = indexedDB.deleteDatabase(dbName(id));
      r.onsuccess = () => ok();
      r.onerror = () => nein(r.error);
      r.onblocked = () => ok();
    });
  }

  // Anzahl wartender Änderungen, auch wenn der Speicher nicht geöffnet ist
  async function wartendFuer(id) {
    if (db && nutzerId === id) return ausgangZahl();
    try {
      const d = await dbOeffnen(id);
      const n = await new Promise((ok, nein) => {
        const r = d.transaction(['ausgang'], 'readonly').objectStore('ausgang').count();
        r.onsuccess = () => ok(r.result);
        r.onerror = () => nein(r.error);
      });
      d.close();
      return n;
    } catch (f) {
      return 0;
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { if (db) abgleichen(); });
    window.addEventListener('offline', () => { if (db) statusMelden({ zustand: 'offline' }); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && db) abgleichen();
    });
  }

  window.Geraet = {
    oeffnen,
    schliessen,
    entfernen,
    abgleichen,
    wartendFuer,
    speicher,
    status: () => Object.assign({}, status),
    istOffen: () => Boolean(daten),
    // Nur für Tests
    _intern: { SPALTEN, umwandeln, zeitstempelText, verschluesseln, entschluesseln }
  };
})();
