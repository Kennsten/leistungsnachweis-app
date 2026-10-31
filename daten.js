/* =====================================================================
   Daten – Bauabschnitt 3 (Datenzugriff-Schicht)

   Alle Lese- und Schreibzugriffe der App laufen über Daten.from(…).
   Die Schreibweise ist dieselbe wie bisher bei Supabase, z. B.
     await Daten.from('clients').select('*').eq('id', id).single();

   Was hier passiert:
   1. Jede Anfrage wird zuerst als neutrale Beschreibung festgehalten
      (Tabelle, Aktion, Spalten, Filter, Sortierung, Grenze …).
   2. Diese Beschreibung geht an den eingestellten „Speicher“.
      Seit Version 0.13 ist das die verschlüsselte Datenbank auf dem
      Gerät (geraet.js). supabaseSpeicher bleibt für Tests und für die
      spätere Übernahme alter Daten (Bauabschnitt 7) erhalten.

   Antwort immer im gewohnten Format: { data, error, count }.
   ===================================================================== */

(function () {
  'use strict';

  const VERGLEICHE = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'like', 'ilike'];

  let speicher = null;
  let anfragenZaehler = 0;

  class Abfrage {
    constructor(tabelle) {
      // Die neutrale Beschreibung der Anfrage
      this.beschreibung = {
        tabelle,
        aktion: 'select',        // select | insert | update | upsert | delete
        spalten: '*',            // bei select
        leseOptionen: undefined, // z. B. { count: 'exact', head: true }
        werte: null,             // bei insert / update / upsert
        schreibOptionen: undefined, // z. B. { onConflict: 'user_id' }
        rueckgabe: null,         // Spalten, die nach dem Schreiben zurückkommen sollen
        filter: [],              // [{ art, spalte, wert }] oder { art:'not'|'or', … }
        sortierung: [],          // [{ spalte, optionen }]
        grenze: null,            // limit
        einzeln: null            // 'single' | 'maybeSingle'
      };
      this.ergebnis = null;
    }

    /* ---------- Aktionen ---------- */

    select(spalten, optionen) {
      const b = this.beschreibung;
      if (b.aktion === 'select') {
        b.spalten = spalten === undefined ? '*' : spalten;
        b.leseOptionen = optionen;
      } else {
        // .select() nach insert/update/upsert = geschriebene Zeilen zurückgeben
        b.rueckgabe = spalten === undefined ? '*' : spalten;
      }
      return this;
    }

    insert(werte, optionen) {
      return this.schreiben('insert', werte, optionen);
    }

    update(werte, optionen) {
      return this.schreiben('update', werte, optionen);
    }

    upsert(werte, optionen) {
      return this.schreiben('upsert', werte, optionen);
    }

    delete(optionen) {
      return this.schreiben('delete', null, optionen);
    }

    schreiben(aktion, werte, optionen) {
      const b = this.beschreibung;
      b.aktion = aktion;
      b.werte = werte;
      b.schreibOptionen = optionen;
      return this;
    }

    /* ---------- Filter ---------- */

    not(spalte, operator, wert) {
      this.beschreibung.filter.push({ art: 'not', spalte, operator, wert });
      return this;
    }

    or(ausdruck, optionen) {
      this.beschreibung.filter.push({ art: 'or', ausdruck, optionen });
      return this;
    }

    /* ---------- Sortierung, Grenze, Einzelzeile ---------- */

    order(spalte, optionen) {
      this.beschreibung.sortierung.push({ spalte, optionen });
      return this;
    }

    limit(anzahl) {
      this.beschreibung.grenze = anzahl;
      return this;
    }

    single() {
      this.beschreibung.einzeln = 'single';
      return this;
    }

    maybeSingle() {
      this.beschreibung.einzeln = 'maybeSingle';
      return this;
    }

    /* ---------- Ausführen ---------- */

    ausfuehren() {
      if (!this.ergebnis) {
        anfragenZaehler++;
        const b = this.beschreibung;
        this.ergebnis = Promise.resolve()
          .then(() => {
            if (!speicher) throw new Error('Kein Datenspeicher verbunden.');
            return speicher.ausfuehren(b);
          })
          .then((antwort) => antwort || { data: null, error: null, count: null })
          .catch((fehler) => ({
            data: null,
            count: null,
            error: { message: fehler && fehler.message ? fehler.message : String(fehler) }
          }));
      }
      return this.ergebnis;
    }

    // Erlaubt „await Daten.from(…)…“ und Promise.all([…])
    then(erfuellt, abgelehnt) {
      return this.ausfuehren().then(erfuellt, abgelehnt);
    }

    catch(abgelehnt) {
      return this.ausfuehren().catch(abgelehnt);
    }

    finally(danach) {
      return this.ausfuehren().finally(danach);
    }
  }

  // Einfache Vergleichsfilter: eq, gt, gte, lt, lte, is, …
  for (const art of VERGLEICHE) {
    Abfrage.prototype[art] = function (spalte, wert) {
      this.beschreibung.filter.push({ art, spalte, wert });
      return this;
    };
  }

  /* ---------- Speicher: Supabase ---------- */

  // Ruft eine Supabase-Methode auf und lässt nicht angegebene
  // Zusatzangaben weg – genau wie beim direkten Aufruf
  function rufe(q, methode, ...werte) {
    while (werte.length && werte[werte.length - 1] === undefined) werte.pop();
    return q[methode](...werte);
  }

  // Übersetzt die neutrale Beschreibung zurück in Supabase-Aufrufe
  function supabaseSpeicher(sb) {
    return {
      name: 'supabase',
      ausfuehren(b) {
        let q = sb.from(b.tabelle);

        if (b.aktion === 'select') q = rufe(q, 'select', b.spalten, b.leseOptionen);
        else if (b.aktion === 'insert') q = rufe(q, 'insert', b.werte, b.schreibOptionen);
        else if (b.aktion === 'update') q = rufe(q, 'update', b.werte, b.schreibOptionen);
        else if (b.aktion === 'upsert') q = rufe(q, 'upsert', b.werte, b.schreibOptionen);
        else if (b.aktion === 'delete') q = rufe(q, 'delete', b.schreibOptionen);
        else throw new Error('Unbekannte Aktion: ' + b.aktion);

        for (const f of b.filter) {
          if (f.art === 'not') q = q.not(f.spalte, f.operator, f.wert);
          else if (f.art === 'or') q = rufe(q, 'or', f.ausdruck, f.optionen);
          else q = q[f.art](f.spalte, f.wert);
        }

        if (b.rueckgabe !== null) q = q.select(b.rueckgabe);
        for (const s of b.sortierung) q = rufe(q, 'order', s.spalte, s.optionen);
        if (b.grenze !== null) q = q.limit(b.grenze);
        if (b.einzeln) q = q[b.einzeln]();

        return q;
      }
    };
  }

  window.Daten = {
    from: (tabelle) => new Abfrage(tabelle),
    // Speicher festlegen (seit 0.13: Geraet.speicher)
    speicherSetzen: (neu) => { speicher = neu; },
    verbinden: (sb) => { speicher = supabaseSpeicher(sb); },
    supabaseSpeicher,
    speicherName: () => (speicher ? speicher.name : null),
    anfragen: () => anfragenZaehler
  };
})();
