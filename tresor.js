/* =====================================================================
   Tresor – Bauabschnitt 2 (Version 0.4 Verkaufsversion)

   Was hier passiert:
   - Beim Einrichten erzeugt die App einen zufälligen Datenschlüssel
     (256 Bit). Mit ihm werden ab Bauabschnitt 4 alle Klientendaten
     verschlüsselt.
   - Der Datenschlüssel wird zweimal verschlossen:
       Passwort-Hülle: mit einem Schlüssel aus dem Tresor-Passwort
                       (Argon2id, 64 MiB, 3 Durchläufe)
       Notfall-Hülle:  mit einem Schlüssel aus dem Wiederherstellungs-
                       schlüssel (HKDF-SHA-256)
     Beide Hüllen liegen in der Tabelle "tresor" und zusätzlich auf dem
     Gerät (damit das Entsperren auch ohne Internet geht). Der Server
     kann sie nicht öffnen.
   - Tresor-Passwort und Wiederherstellungsschlüssel verlassen das Gerät nie.
   - Nach 30 Minuten ohne Bedienung und nach jedem Neustart der App
     muss das Tresor-Passwort eingegeben werden.

   In Bauabschnitt 2 sind die Daten selbst noch NICHT verschlüsselt.
   Der Tresor sperrt zunächst nur den Zugang.
   ===================================================================== */

(function () {
  'use strict';

  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // ohne 0 O 1 I L
  const CODE_LAENGE = 32;
  const GRUPPE = 4;
  const MIN_PASSWORT = 12;
  const SPERRE_MINUTEN = 30;
  const ARGON = { kdf: 'argon2id', m: 65536, t: 3, p: 1 }; // m in KiB = 64 MiB
  const SPEICHER_PREFIX = 'qa-tresor-';
  const TEXT = new TextEncoder();
  const AAD_PASSWORT = TEXT.encode('qa-tresor-v1-passwort');
  const AAD_NOTFALL = TEXT.encode('qa-tresor-v1-notfall');
  const HKDF_INFO = TEXT.encode('qa-tresor-v1-notfall-schluessel');

  let ctx = null;            // { sb, user, toast, name(), abmelden() }
  let schluessel = null;     // Datenschlüssel als CryptoKey (nicht auslesbar)
  let stand = null;          // { version, passwort_huelle, notfall_huelle }
  let letzteAktivitaet = Date.now();
  let wartend = null;        // resolve-Funktion von oeffnen()
  let dialog = null;
  let kameraStrom = null;
  let kameraTimer = null;
  const geladeneSkripte = {};

  /* ---------------- Hilfen ---------------- */

  const $t = (sel) => dialog.querySelector(sel);

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function meldung(text) {
    if (ctx && typeof ctx.toast === 'function') ctx.toast(text);
  }

  function zufall(n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  }

  function b64(bytes) {
    let s = '';
    const a = new Uint8Array(bytes);
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s);
  }

  function ausB64(text) {
    const s = atob(text);
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }

  function skriptLaden(src) {
    if (!geladeneSkripte[src]) {
      geladeneSkripte[src] = new Promise((fertig, fehler) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = () => fertig();
        el.onerror = () => {
          delete geladeneSkripte[src];
          fehler(new Error('Baustein ' + src + ' konnte nicht geladen werden.'));
        };
        document.head.appendChild(el);
      });
    }
    return geladeneSkripte[src];
  }

  /* ---------------- Wiederherstellungsschlüssel ---------------- */

  function codeErzeugen() {
    let code = '';
    while (code.length < CODE_LAENGE) {
      for (const b of zufall(48)) {
        // 248 = 8 * 31: gleichmäßige Verteilung ohne Verzerrung
        if (b < 248 && code.length < CODE_LAENGE) code += ALPHABET[b % 31];
      }
    }
    return code;
  }

  function codeNormalisieren(eingabe) {
    return String(eingabe || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  }

  function codeGueltig(code) {
    if (code.length !== CODE_LAENGE) return false;
    for (const z of code) if (!ALPHABET.includes(z)) return false;
    return true;
  }

  function codeGruppen(code) {
    const g = [];
    for (let i = 0; i < code.length; i += GRUPPE) g.push(code.slice(i, i + GRUPPE));
    return g;
  }

  function codeFormatieren(code) {
    return codeGruppen(code).join('-');
  }

  /* ---------------- Schlüssel und Hüllen ---------------- */

  async function kekAusPasswort(passwort, h) {
    if (!window.hashwasm || typeof window.hashwasm.argon2id !== 'function') {
      throw new Error(
        'Der Verschlüsselungs-Baustein fehlt. Bitte die App ganz schließen und neu öffnen.'
      );
    }
    const roh = await window.hashwasm.argon2id({
      password: String(passwort).normalize('NFC'),
      salt: ausB64(h.salt),
      iterations: h.t,
      parallelism: h.p,
      memorySize: h.m,
      hashLength: 32,
      outputType: 'binary'
    });
    const kek = await crypto.subtle.importKey('raw', roh, 'AES-GCM', false, ['encrypt', 'decrypt']);
    roh.fill(0);
    return kek;
  }

  async function kekAusCode(code, h) {
    const basis = await crypto.subtle.importKey('raw', TEXT.encode(code), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: ausB64(h.salt), info: HKDF_INFO },
      basis,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function verschliessen(kek, roh, aad) {
    const iv = zufall(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, kek, roh);
    return { iv: b64(iv), ct: b64(ct) };
  }

  async function aufschliessen(kek, h, aad) {
    const roh = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ausB64(h.iv), additionalData: aad },
      kek,
      ausB64(h.ct)
    );
    return new Uint8Array(roh);
  }

  async function passwortHuelleBauen(passwort, roh) {
    const h = { v: 1, kdf: ARGON.kdf, m: ARGON.m, t: ARGON.t, p: ARGON.p, salt: b64(zufall(16)) };
    const kek = await kekAusPasswort(passwort, h);
    return Object.assign(h, await verschliessen(kek, roh, AAD_PASSWORT));
  }

  async function notfallHuelleBauen(code, roh) {
    const h = { v: 1, kdf: 'hkdf-sha256', salt: b64(zufall(16)) };
    const kek = await kekAusCode(code, h);
    return Object.assign(h, await verschliessen(kek, roh, AAD_NOTFALL));
  }

  // Liefert den Datenschlüssel als Bytes – oder null bei falschem Passwort
  async function mitPasswortOeffnen(passwort, h) {
    const kek = await kekAusPasswort(passwort, h);
    try {
      return await aufschliessen(kek, h, AAD_PASSWORT);
    } catch (e) {
      return null;
    }
  }

  async function mitCodeOeffnen(code, h) {
    const kek = await kekAusCode(code, h);
    try {
      return await aufschliessen(kek, h, AAD_NOTFALL);
    } catch (e) {
      return null;
    }
  }

  async function schluesselAktivieren(roh) {
    schluessel = await crypto.subtle.importKey('raw', roh, 'AES-GCM', false, ['encrypt', 'decrypt']);
    roh.fill(0);
    letzteAktivitaet = Date.now();
  }

  /* ---------------- Speicher auf dem Gerät ---------------- */

  function speicherName() {
    return SPEICHER_PREFIX + ctx.user.id;
  }

  function geraetLesen() {
    try {
      const t = localStorage.getItem(speicherName());
      return t ? JSON.parse(t) : null;
    } catch (e) {
      return null;
    }
  }

  function geraetSchreiben(daten) {
    try {
      localStorage.setItem(speicherName(), JSON.stringify(daten));
    } catch (e) {
      // ohne Speicher geht es online trotzdem
    }
  }

  /* ---------------- Server ---------------- */

  async function serverLesen() {
    const { data, error } = await ctx.sb
      .from('tresor')
      .select('version,passwort_huelle,notfall_huelle')
      .eq('user_id', ctx.user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function standLaden() {
    try {
      const d = await serverLesen();
      if (d) geraetSchreiben(d);
      return { daten: d, online: true };
    } catch (e) {
      return { daten: geraetLesen(), online: false, fehler: e };
    }
  }

  async function serverAnlegen(daten) {
    const { error } = await ctx.sb.from('tresor').insert({
      user_id: ctx.user.id,
      version: 1,
      passwort_huelle: daten.passwort_huelle,
      notfall_huelle: daten.notfall_huelle
    });
    if (error) throw error;
    stand = { version: 1, passwort_huelle: daten.passwort_huelle, notfall_huelle: daten.notfall_huelle };
    geraetSchreiben(stand);
  }

  // Ändert eine Hülle nur, wenn niemand den Tresor inzwischen geändert hat
  async function serverAendern(felder) {
    const neu = stand.version + 1;
    const { data, error } = await ctx.sb
      .from('tresor')
      .update(Object.assign({}, felder, { version: neu, geaendert_am: new Date().toISOString() }))
      .eq('user_id', ctx.user.id)
      .eq('version', stand.version)
      .select('version,passwort_huelle,notfall_huelle');
    if (error) throw error;
    if (!data || data.length === 0) {
      const frisch = await serverLesen();
      if (frisch) {
        stand = frisch;
        geraetSchreiben(frisch);
      }
      throw new Error(
        'Der Tresor wurde inzwischen auf einem anderen Gerät geändert. Bitte noch einmal versuchen.'
      );
    }
    stand = data[0];
    geraetSchreiben(stand);
  }

  /* ---------------- Oberfläche ---------------- */

  function stilEinfuegen() {
    if (document.getElementById('tresorStil')) return;
    const s = document.createElement('style');
    s.id = 'tresorStil';
    s.textContent = `
#tresorDialog{width:min(94vw,560px);padding:0 22px 22px}
#tresorDialog::backdrop{background:var(--bg,#f7f5ef);opacity:1}
#tresorDialog h2{margin:18px 0 6px;overflow-wrap:anywhere;hyphens:auto}
#tresorDialog .t-hinweis{background:var(--accent);border-radius:var(--radius-control,14px);padding:12px 14px;margin:12px 0;line-height:1.45}
#tresorDialog .t-warnung{background:var(--danger-bg,#f6e4e1);color:var(--ink);border-radius:var(--radius-control,14px);padding:12px 14px;margin:12px 0;line-height:1.45}
#tresorDialog .t-fehler{color:var(--danger);min-height:1.3em;margin:8px 0 0;font-weight:600}
#tresorDialog .t-zaehler{font-size:.85em;color:var(--muted);margin-top:4px}
#tresorDialog .t-check{display:flex;flex-direction:row;gap:10px;align-items:flex-start;margin:14px 0;font-weight:400}
#tresorDialog .t-check input{width:22px;height:22px;flex:0 0 auto;margin-top:2px}
#tresorDialog .t-code{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}
#tresorDialog .t-gruppe{border:1px solid var(--line);border-radius:10px;padding:6px 4px;text-align:center;background:var(--field,#fff)}
#tresorDialog .t-gruppe small{display:block;color:var(--muted);font-size:.72em}
#tresorDialog .t-gruppe b{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1.25em;letter-spacing:.06em}
#tresorDialog .t-qr{display:flex;justify-content:center;margin:10px 0}
#tresorDialog .t-qr svg{width:170px;height:170px;background:#fff;padding:8px;border-radius:10px}
#tresorDialog .t-codefeld{font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.05em;text-transform:uppercase}
#tresorDialog .t-zwei{display:grid;grid-template-columns:1fr 1fr;gap:12px}
#tresorDialog video{width:100%;border-radius:12px;background:#000;margin-top:10px}
#tresorDialog .actions{margin-top:16px}
#tresorDialog .actions button{flex:1 1 auto}
#tresorDialog .t-link{background:none;border:0;padding:8px 0;text-align:left;color:var(--brand-dark);text-decoration:underline;font:inherit;cursor:pointer}
#tresorDialog .t-laeuft{display:flex;gap:12px;align-items:center;margin:24px 0}
#tresorDialog .t-kreis{width:26px;height:26px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--brand);animation:tresorDreh 0.9s linear infinite}
@keyframes tresorDreh{to{transform:rotate(360deg)}}
`;
    document.head.appendChild(s);
  }

  function dialogBereit() {
    if (dialog) return dialog;
    stilEinfuegen();
    dialog = document.createElement('dialog');
    dialog.id = 'tresorDialog';
    dialog.setAttribute('aria-label', 'Tresor');
    // Escape-Taste darf den Tresor nicht schließen
    dialog.addEventListener('cancel', (e) => e.preventDefault());
    document.body.appendChild(dialog);
    return dialog;
  }

  function zeigen(html) {
    kameraStoppen();
    dialogBereit();
    dialog.innerHTML = html;
    if (!dialog.open) {
      dialog.showModal();
    } else {
      // Nach vorn holen, falls inzwischen ein anderer Dialog geöffnet wurde
      dialog.close();
      dialog.showModal();
    }
    dialog.scrollTop = 0;
    const erstes = dialog.querySelector('[data-fokus]');
    if (erstes) setTimeout(() => erstes.focus(), 50);
  }

  function schliessen() {
    kameraStoppen();
    if (dialog && dialog.open) dialog.close();
    if (dialog) dialog.innerHTML = '';
  }

  function laeuft(text) {
    zeigen(`
      <h2>Tresor</h2>
      <div class="t-laeuft"><div class="t-kreis"></div><div>${esc(text)}</div></div>`);
  }

  function fehlerZeigen(text) {
    const f = $t('.t-fehler');
    if (f) f.textContent = text || '';
  }

  // Unsichtbares Benutzerfeld, damit Passwort-Manager das Tresor-Passwort
  // nicht mit dem Anmelde-Passwort verwechseln
  function benutzerFeld() {
    const mail = ctx && ctx.user ? ctx.user.email : '';
    return `<input type="text" autocomplete="username" value="Tresor ${esc(mail)}" style="display:none" tabindex="-1" aria-hidden="true" readonly>`;
  }

  function passwortPruefen(pw, pw2) {
    if (pw.length < MIN_PASSWORT) return 'Das Tresor-Passwort braucht mindestens ' + MIN_PASSWORT + ' Zeichen.';
    if (pw !== pw2) return 'Die beiden Eingaben stimmen nicht überein.';
    return '';
  }

  function zaehlerAnbinden(feld, anzeige) {
    const neu = () => {
      const n = feld.value.length;
      anzeige.textContent = n < MIN_PASSWORT
        ? n + ' von mindestens ' + MIN_PASSWORT + ' Zeichen'
        : n + ' Zeichen – lang genug';
    };
    feld.addEventListener('input', neu);
    neu();
  }

  function fehlermeldungText(e) {
    const t = e && e.message ? e.message : String(e || '');
    if (/fetch|network|Load failed|NetworkError/i.test(t)) {
      return 'Keine Verbindung zum Server. Bitte Internet prüfen und noch einmal versuchen.';
    }
    return t;
  }

  /* ---------------- Einrichten ---------------- */

  function ansichtEinrichten() {
    zeigen(`
      <h2>Tresor einrichten</h2>
      <p>Deine Klientendaten werden künftig mit einem eigenen <b>Tresor-Passwort</b> geschützt.
      Es ist getrennt von deinem Anmelde-Passwort und verlässt dieses Gerät nie.</p>
      <div class="t-hinweis">Tipp: Ein Satz aus mehreren Wörtern ist sicher und gut zu merken,
      zum Beispiel „Kaffee am Morgen mit Hund“. Mindestens ${MIN_PASSWORT} Zeichen.</div>
      <form id="tEinrichten" autocomplete="on">
        ${benutzerFeld()}
        <label>Tresor-Passwort
          <input id="tPw" type="password" autocomplete="new-password" data-fokus required>
        </label>
        <div class="t-zaehler" id="tZaehler"></div>
        <label>Tresor-Passwort wiederholen
          <input id="tPw2" type="password" autocomplete="new-password" required>
        </label>
        <div class="t-warnung">
          <b>Wichtig:</b> Niemand kann ein vergessenes Tresor-Passwort zurücksetzen – auch nicht der Anbieter der App.
          Im nächsten Schritt bekommst du einen <b>Wiederherstellungsschlüssel</b> zum Ausdrucken.
          Ohne Tresor-Passwort und ohne Wiederherstellungsschlüssel sind deine Daten verloren.
        </div>
        <label class="t-check"><input type="checkbox" id="tVerstanden">
          <span>Ich habe verstanden: Ohne Tresor-Passwort und ohne Wiederherstellungsschlüssel sind meine Daten unwiederbringlich verloren.</span>
        </label>
        <p class="t-fehler"></p>
        <div class="actions">
          <button type="submit" class="primary">Weiter</button>
          <button type="button" id="tAbmelden" class="secondary">Abmelden</button>
        </div>
      </form>`);

    zaehlerAnbinden($t('#tPw'), $t('#tZaehler'));
    $t('#tAbmelden').onclick = abmeldenKlick;
    $t('#tEinrichten').onsubmit = async (e) => {
      e.preventDefault();
      const pw = $t('#tPw').value;
      const problem = passwortPruefen(pw, $t('#tPw2').value);
      if (problem) return fehlerZeigen(problem);
      if (!$t('#tVerstanden').checked) return fehlerZeigen('Bitte den Hinweis oben bestätigen.');

      laeuft('Schlüssel wird erzeugt …');
      try {
        const roh = zufall(32);
        const code = codeErzeugen();
        const passwortHuelle = await passwortHuelleBauen(pw, roh);
        const notfallHuelle = await notfallHuelleBauen(code, roh);
        ansichtNotfallblatt(code, async () => {
          laeuft('Tresor wird gespeichert …');
          try {
            await serverAnlegen({ passwort_huelle: passwortHuelle, notfall_huelle: notfallHuelle });
          } catch (fehler) {
            // Tresor gibt es schon (z. B. gerade auf einem anderen Gerät eingerichtet)
            const frisch = await standLaden();
            if (frisch.daten) {
              stand = frisch.daten;
              meldung('Für dieses Konto gibt es schon einen Tresor. Bitte mit dessen Tresor-Passwort entsperren.');
              roh.fill(0);
              ansichtEntsperren();
              return;
            }
            ansichtFehler('Der Tresor konnte nicht gespeichert werden: ' + fehlermeldungText(fehler), ansichtEinrichten);
            return;
          }
          await schluesselAktivieren(roh);
          meldung('Tresor eingerichtet');
          fertig();
        }, () => {
          roh.fill(0);
          ansichtEinrichten();
        });
      } catch (fehler) {
        ansichtFehler(fehlermeldungText(fehler), ansichtEinrichten);
      }
    };
  }

  /* ---------------- Notfallblatt ---------------- */

  function qrSvg(text) {
    if (typeof window.qrcode !== 'function') return '';
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let pfad = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) pfad += `M${c} ${r}h1v1h-1z`;
      }
    }
    return `<svg viewBox="0 0 ${n} ${n}" role="img" aria-label="QR-Code des Wiederherstellungsschlüssels" shape-rendering="crispEdges"><path d="${pfad}" fill="#000"/></svg>`;
  }

  function gruppenHtml(code) {
    return codeGruppen(code)
      .map((g, i) => `<div class="t-gruppe"><small>${i + 1}</small><b>${g}</b></div>`)
      .join('');
  }

  function ansichtNotfallblatt(code, weiter, zurueck, titel) {
    // Bausteine für das PDF schon jetzt laden, damit „Teilen“ direkt nach dem Tippen funktioniert
    skriptLaden('lib/jspdf.umd.min.js').catch(() => null);

    zeigen(`
      <h2>${esc(titel || 'Dein Wiederherstellungs\u00ADschlüssel')}</h2>
      <p>Mit diesem Schlüssel kannst du ein neues Tresor-Passwort festlegen, falls du es vergisst.
      Er wird <b>nur jetzt</b> angezeigt.</p>
      <div class="t-code">${gruppenHtml(code)}</div>
      <div class="t-qr">${qrSvg(codeFormatieren(code))}</div>
      <div class="t-hinweis">
        <b>So bewahrst du ihn auf:</b> Notfallblatt ausdrucken und sicher zu Hause ablegen, z. B. bei wichtigen Unterlagen.
        Gern zusätzlich im Passwort-Manager speichern.
        <b>Nicht</b> als Foto auf dem iPad und <b>nicht</b> in derselben Cloud wie deine Sicherungen.
      </div>
      <p class="t-fehler"></p>
      <div class="actions">
        <button type="button" id="tPdf" class="kn kn-druck">Notfallblatt als PDF (zum Drucken)</button>
        <button type="button" id="tWeiter" class="secondary">Weiter zur Kontrolle</button>
      </div>
      <p><button type="button" id="tZurueck" class="t-link">Abbrechen</button></p>`);

    $t('#tPdf').onclick = () => notfallblattTeilen(code).catch((e) => fehlerZeigen(fehlermeldungText(e)));
    $t('#tWeiter').onclick = () => ansichtKontrolle(code, weiter, () => ansichtNotfallblatt(code, weiter, zurueck, titel));
    $t('#tZurueck').onclick = () => {
      if (confirm('Abbrechen? Der angezeigte Wiederherstellungsschlüssel wird dann nicht gespeichert.')) zurueck();
    };
  }

  function ansichtKontrolle(code, weiter, zurueck) {
    const gruppen = codeGruppen(code);
    const a = 1 + (zufall(1)[0] % gruppen.length);
    let b = a;
    while (b === a) b = 1 + (zufall(1)[0] % gruppen.length);
    const [x, y] = a < b ? [a, b] : [b, a];

    zeigen(`
      <h2>Kontrolle</h2>
      <p>Bitte trage zwei Gruppen aus deinem Wiederherstellungsschlüssel ein – so ist sicher, dass du ihn notiert hast.</p>
      <form id="tKontrolle">
        <div class="t-zwei">
          <label>Gruppe ${x}<input id="tG1" class="t-codefeld" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" data-fokus></label>
          <label>Gruppe ${y}<input id="tG2" class="t-codefeld" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
        </div>
        <p class="t-fehler"></p>
        <div class="actions">
          <button type="submit" class="primary">Prüfen und speichern</button>
          <button type="button" id="tZurueck" class="secondary">Zurück zum Schlüssel</button>
        </div>
      </form>`);

    $t('#tZurueck').onclick = zurueck;
    $t('#tKontrolle').onsubmit = (e) => {
      e.preventDefault();
      const ok =
        codeNormalisieren($t('#tG1').value) === gruppen[x - 1] &&
        codeNormalisieren($t('#tG2').value) === gruppen[y - 1];
      if (!ok) return fehlerZeigen('Das passt nicht. Bitte noch einmal auf dem Notfallblatt nachsehen.');
      weiter();
    };
  }

  function notfallblattPdf(code) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('Der PDF-Baustein ist noch nicht geladen. Bitte in ein paar Sekunden noch einmal tippen.');
    }
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const name = ctx && typeof ctx.name === 'function' ? ctx.name() : '';
    const mail = ctx && ctx.user ? ctx.user.email || '' : '';
    const heute = new Date().toLocaleDateString('de-DE');
    let y = 24;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(19);
    pdf.text('Notfallblatt - Tresor der QA-App', 20, y);
    y += 11;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    if (name) { pdf.text('Name: ' + name, 20, y); y += 6; }
    if (mail) { pdf.text('Anmelde-E-Mail: ' + mail, 20, y); y += 6; }
    pdf.text('Erstellt am: ' + heute, 20, y);
    y += 10;

    pdf.setDrawColor(120);
    pdf.setLineWidth(0.4);
    pdf.roundedRect(18, y - 6, 174, 34, 3, 3);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('Wiederherstellungsschlüssel', 24, y + 1);
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(18);
    const g = codeGruppen(code);
    pdf.text(g.slice(0, 4).join('  '), 24, y + 12);
    pdf.text(g.slice(4).join('  '), 24, y + 22);
    y += 38;

    if (typeof window.qrcode === 'function') {
      const qr = window.qrcode(0, 'M');
      qr.addData(codeFormatieren(code));
      qr.make();
      const n = qr.getModuleCount();
      const groesse = 46;
      const zelle = groesse / n;
      pdf.setFillColor(0, 0, 0);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) pdf.rect(20 + c * zelle, y + r * zelle, zelle, zelle, 'F');
        }
      }
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text(pdf.splitTextToSize(
        'Diesen QR-Code kann die App beim Wiederherstellen mit der Kamera einlesen. ' +
        'Dann muss nichts abgetippt werden.', 110), 74, y + 6);
      y += groesse + 10;
    }

    const abschnitte = [
      ['Wenn du dein Tresor-Passwort vergessen hast',
        '1. App öffnen und wie gewohnt anmelden.  ' +
        '2. Auf "Tresor-Passwort vergessen?" tippen.  ' +
        '3. Den Schlüssel oben eintippen oder den QR-Code mit der Kamera einlesen.  ' +
        '4. Ein neues Tresor-Passwort festlegen. Alle Daten bleiben erhalten.'],
      ['Aufbewahrung',
        'Sicher zu Hause aufbewahren, z. B. bei wichtigen Unterlagen. Gern zusätzlich im Passwort-Manager. ' +
        'Nicht als Foto auf dem Tablet oder Handy und nicht in derselben Cloud wie deine Sicherungen.'],
      ['Gut zu wissen',
        'Mit diesem Schlüssel allein kommt niemand an deine Daten: Man braucht zusätzlich dein Konto ' +
        'oder eine Sicherungsdatei. Er ersetzt nur das Tresor-Passwort. Ohne Tresor-Passwort und ohne ' +
        'diesen Schlüssel sind die Daten unwiederbringlich verloren - auch der Anbieter der App kann sie nicht öffnen. ' +
        'Erzeugst du in der App ein neues Notfallblatt, wird dieses hier ungültig.']
    ];

    for (const [titel, text] of abschnitte) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text(titel, 20, y);
      y += 6;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      const zeilen = pdf.splitTextToSize(text, 170);
      pdf.text(zeilen, 20, y);
      y += zeilen.length * 5.2 + 6;
    }
    return pdf;
  }

  async function notfallblattTeilen(code) {
    const pdf = notfallblattPdf(code);
    const dateiname = 'QA-Notfallblatt.pdf';
    const blob = pdf.output('blob');
    let datei = null;
    try {
      datei = new File([blob], dateiname, { type: 'application/pdf' });
    } catch (e) {
      datei = null;
    }
    if (datei && navigator.canShare && navigator.canShare({ files: [datei] })) {
      try {
        await navigator.share({ files: [datei], title: dateiname });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    pdf.save(dateiname);
  }

  /* ---------------- Entsperren ---------------- */

  function ansichtEntsperren() {
    const mail = ctx && ctx.user ? ctx.user.email : '';
    zeigen(`
      <h2>Tresor gesperrt</h2>
      <p class="muted">${esc(mail)}</p>
      <p>Gib dein <b>Tresor-Passwort</b> ein. Es schützt deine Klientendaten und ist nicht dasselbe wie dein Anmelde-Passwort.</p>
      <form id="tEntsperren">
        ${benutzerFeld()}
        <label>Tresor-Passwort
          <input id="tPw" type="password" autocomplete="current-password" data-fokus required>
        </label>
        <p class="t-fehler"></p>
        <div class="actions">
          <button type="submit" class="primary">Entsperren</button>
          <button type="button" id="tAbmelden" class="secondary">Abmelden</button>
        </div>
      </form>
      <p><button type="button" id="tVergessen" class="t-link">Tresor-Passwort vergessen? Mit dem Wiederherstellungsschlüssel vom Notfallblatt ein neues festlegen.</button></p>`);

    $t('#tAbmelden').onclick = abmeldenKlick;
    $t('#tVergessen').onclick = () => ansichtWiederherstellen();
    $t('#tEntsperren').onsubmit = async (e) => {
      e.preventDefault();
      const pw = $t('#tPw').value;
      const knopf = $t('#tEntsperren button[type="submit"]');
      knopf.disabled = true;
      knopf.textContent = 'Wird geprüft …';
      try {
        const roh = await mitPasswortOeffnen(pw, stand.passwort_huelle);
        if (!roh) {
          fehlerZeigen('Das Tresor-Passwort stimmt nicht.');
          $t('#tPw').select();
          return;
        }
        await schluesselAktivieren(roh);
        fertig();
      } catch (fehler) {
        fehlerZeigen(fehlermeldungText(fehler));
      } finally {
        if (knopf.isConnected) {
          knopf.disabled = false;
          knopf.textContent = 'Entsperren';
        }
      }
    };
  }

  /* ---------------- Wiederherstellen ---------------- */

  function ansichtWiederherstellen() {
    zeigen(`
      <h2>Tresor-Passwort vergessen</h2>
      <p>Hier brauchst du den <b>Wiederherstellungsschlüssel</b> von deinem Notfallblatt –
      32 Zeichen in 8 Vierergruppen, z. B. <code>QA7F-K29P-…</code>.
      Du kannst ihn eintippen oder den QR-Code mit der Kamera einlesen.
      Danach legst du ein neues Tresor-Passwort fest. Deine Daten bleiben erhalten.</p>
      <form id="tWieder">
        ${benutzerFeld()}
        <label>Wiederherstellungsschlüssel
          <input id="tCode" class="t-codefeld" autocomplete="off" autocapitalize="characters" spellcheck="false"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" data-fokus>
        </label>
        <div class="t-zaehler" id="tCodeZaehler"></div>
        <p><button type="button" id="tKamera" class="secondary">QR-Code mit Kamera einlesen</button></p>
        <div id="tKameraBox"></div>
        <label>Neues Tresor-Passwort
          <input id="tPw" type="password" autocomplete="new-password" required>
        </label>
        <div class="t-zaehler" id="tZaehler"></div>
        <label>Neues Tresor-Passwort wiederholen
          <input id="tPw2" type="password" autocomplete="new-password" required>
        </label>
        <p class="t-fehler"></p>
        <div class="actions">
          <button type="submit" class="primary">Neues Tresor-Passwort speichern</button>
          <button type="button" id="tZurueck" class="secondary">Zurück</button>
        </div>
      </form>`);

    const feld = $t('#tCode');
    const zaehler = $t('#tCodeZaehler');
    const codeAnzeigen = () => {
      const c = codeNormalisieren(feld.value).slice(0, CODE_LAENGE);
      const formatiert = codeFormatieren(c);
      if (feld.value !== formatiert) feld.value = formatiert;
      zaehler.textContent = c.length + ' von ' + CODE_LAENGE + ' Zeichen';
    };
    feld.addEventListener('input', codeAnzeigen);
    codeAnzeigen();
    zaehlerAnbinden($t('#tPw'), $t('#tZaehler'));

    $t('#tZurueck').onclick = () => ansichtEntsperren();
    $t('#tKamera').onclick = () =>
      kameraStarten($t('#tKameraBox'), (gelesen) => {
        feld.value = gelesen;
        codeAnzeigen();
        $t('#tPw').focus();
      });

    $t('#tWieder').onsubmit = async (e) => {
      e.preventDefault();
      const code = codeNormalisieren(feld.value);
      if (!codeGueltig(code)) {
        return fehlerZeigen('Der Wiederherstellungsschlüssel ist unvollständig oder enthält ungültige Zeichen.');
      }
      const pw = $t('#tPw').value;
      const problem = passwortPruefen(pw, $t('#tPw2').value);
      if (problem) return fehlerZeigen(problem);

      laeuft('Schlüssel wird geprüft …');
      try {
        // Für die Änderung muss der neueste Stand vom Server kommen
        const frisch = await serverLesen();
        if (!frisch) throw new Error('Für dieses Konto wurde kein Tresor gefunden.');
        stand = frisch;
        geraetSchreiben(frisch);

        const roh = await mitCodeOeffnen(code, stand.notfall_huelle);
        if (!roh) {
          ansichtWiederherstellen();
          fehlerZeigen('Dieser Wiederherstellungsschlüssel passt nicht zu deinem Tresor. Ist es das neueste Notfallblatt?');
          return;
        }
        laeuft('Neues Tresor-Passwort wird gespeichert …');
        const neueHuelle = await passwortHuelleBauen(pw, roh);
        await serverAendern({ passwort_huelle: neueHuelle });
        await schluesselAktivieren(roh);
        meldung('Neues Tresor-Passwort gespeichert');
        fertig();
      } catch (fehler) {
        ansichtFehler(fehlermeldungText(fehler), ansichtWiederherstellen);
      }
    };
  }

  /* ---------------- Kamera (QR-Code) ---------------- */

  function kameraStoppen() {
    if (kameraTimer) {
      clearTimeout(kameraTimer);
      kameraTimer = null;
    }
    if (kameraStrom) {
      kameraStrom.getTracks().forEach((t) => t.stop());
      kameraStrom = null;
    }
  }

  async function kameraStarten(box, gefunden) {
    kameraStoppen();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      box.innerHTML = '<p class="t-fehler">Die Kamera ist hier nicht verfügbar. Bitte den Schlüssel eintippen.</p>';
      return;
    }
    box.innerHTML = '<p class="muted">Kamera wird gestartet …</p>';
    try {
      await skriptLaden('lib/jsQR.js');
      kameraStrom = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
    } catch (e) {
      kameraStoppen();
      box.innerHTML = '<p class="t-fehler">Die Kamera konnte nicht gestartet werden. Bitte den Zugriff erlauben oder den Schlüssel eintippen.</p>';
      return;
    }

    box.innerHTML = `
      <video playsinline muted autoplay></video>
      <p class="muted small">QR-Code vom Notfallblatt vor die Kamera halten.</p>
      <button type="button" class="secondary" id="tKameraAus">Kamera beenden</button>`;
    const video = box.querySelector('video');
    box.querySelector('#tKameraAus').onclick = () => {
      kameraStoppen();
      box.innerHTML = '';
    };
    video.srcObject = kameraStrom;
    try { await video.play(); } catch (e) { /* startet trotzdem */ }

    const leinwand = document.createElement('canvas');
    const malen = leinwand.getContext('2d', { willReadFrequently: true });

    const pruefen = () => {
      if (!kameraStrom) return;
      if (video.videoWidth > 0) {
        const breite = Math.min(video.videoWidth, 800);
        const hoehe = Math.round(video.videoHeight * (breite / video.videoWidth));
        leinwand.width = breite;
        leinwand.height = hoehe;
        malen.drawImage(video, 0, 0, breite, hoehe);
        const bild = malen.getImageData(0, 0, breite, hoehe);
        const treffer = window.jsQR ? window.jsQR(bild.data, breite, hoehe, { inversionAttempts: 'dontInvert' }) : null;
        if (treffer && treffer.data) {
          const code = codeNormalisieren(treffer.data);
          if (codeGueltig(code)) {
            kameraStoppen();
            box.innerHTML = '<p class="muted">QR-Code erkannt.</p>';
            gefunden(codeFormatieren(code));
            return;
          }
        }
      }
      kameraTimer = setTimeout(pruefen, 250);
    };
    pruefen();
  }

  /* ---------------- Ändern (aus den Einstellungen) ---------------- */

  function ansichtPasswortAendern() {
    zeigen(`
      <h2>Tresor-Passwort ändern</h2>
      <form id="tAendern">
        ${benutzerFeld()}
        <label>Bisheriges Tresor-Passwort
          <input id="tAlt" type="password" autocomplete="current-password" data-fokus required>
        </label>
        <label>Neues Tresor-Passwort
          <input id="tPw" type="password" autocomplete="new-password" required>
        </label>
        <div class="t-zaehler" id="tZaehler"></div>
        <label>Neues Tresor-Passwort wiederholen
          <input id="tPw2" type="password" autocomplete="new-password" required>
        </label>
        <p class="t-fehler"></p>
        <div class="actions">
          <button type="submit" class="primary">Speichern</button>
          <button type="button" id="tZurueck" class="secondary">Abbrechen</button>
        </div>
      </form>`);

    zaehlerAnbinden($t('#tPw'), $t('#tZaehler'));
    $t('#tZurueck').onclick = schliessen;
    $t('#tAendern').onsubmit = async (e) => {
      e.preventDefault();
      const alt = $t('#tAlt').value;
      const pw = $t('#tPw').value;
      const problem = passwortPruefen(pw, $t('#tPw2').value);
      if (problem) return fehlerZeigen(problem);

      laeuft('Neues Tresor-Passwort wird gespeichert …');
      try {
        const frisch = await serverLesen();
        if (frisch) { stand = frisch; geraetSchreiben(frisch); }
        const roh = await mitPasswortOeffnen(alt, stand.passwort_huelle);
        if (!roh) {
          ansichtPasswortAendern();
          fehlerZeigen('Das bisherige Tresor-Passwort stimmt nicht.');
          return;
        }
        const neueHuelle = await passwortHuelleBauen(pw, roh);
        roh.fill(0);
        await serverAendern({ passwort_huelle: neueHuelle });
        schliessen();
        meldung('Tresor-Passwort geändert');
      } catch (fehler) {
        ansichtFehler(fehlermeldungText(fehler), ansichtPasswortAendern, schliessen);
      }
    };
  }

  function ansichtNotfallblattErneuern() {
    zeigen(`
      <h2>Neues Notfallblatt</h2>
      <div class="t-warnung">Dabei entsteht ein <b>neuer Wiederherstellungsschlüssel</b>.
      Dein bisheriges Notfallblatt wird damit ungültig und sollte vernichtet werden.</div>
      <form id="tErneuern">
        ${benutzerFeld()}
        <label>Tresor-Passwort zur Bestätigung
          <input id="tAlt" type="password" autocomplete="current-password" data-fokus required>
        </label>
        <p class="t-fehler"></p>
        <div class="actions">
          <button type="submit" class="primary">Neuen Schlüssel erzeugen</button>
          <button type="button" id="tZurueck" class="secondary">Abbrechen</button>
        </div>
      </form>`);

    $t('#tZurueck').onclick = schliessen;
    $t('#tErneuern').onsubmit = async (e) => {
      e.preventDefault();
      const alt = $t('#tAlt').value;
      laeuft('Wird geprüft …');
      try {
        const frisch = await serverLesen();
        if (frisch) { stand = frisch; geraetSchreiben(frisch); }
        const roh = await mitPasswortOeffnen(alt, stand.passwort_huelle);
        if (!roh) {
          ansichtNotfallblattErneuern();
          fehlerZeigen('Das Tresor-Passwort stimmt nicht.');
          return;
        }
        const code = codeErzeugen();
        const neueHuelle = await notfallHuelleBauen(code, roh);
        roh.fill(0);
        ansichtNotfallblatt(code, async () => {
          laeuft('Wird gespeichert …');
          try {
            await serverAendern({ notfall_huelle: neueHuelle });
            schliessen();
            meldung('Neues Notfallblatt gilt ab sofort. Bitte das alte vernichten.');
          } catch (fehler) {
            ansichtFehler(fehlermeldungText(fehler), ansichtNotfallblattErneuern, schliessen);
          }
        }, schliessen, 'Dein neuer Wiederherstellungs\u00ADschlüssel');
      } catch (fehler) {
        ansichtFehler(fehlermeldungText(fehler), ansichtNotfallblattErneuern, schliessen);
      }
    };
  }

  /* ---------------- Sonstige Ansichten ---------------- */

  function ansichtFehler(text, nochmal, abbrechen) {
    zeigen(`
      <h2>Tresor</h2>
      <p class="t-fehler">${esc(text)}</p>
      <div class="actions">
        <button type="button" id="tNochmal" class="primary">Noch einmal</button>
        <button type="button" id="tAbbruch" class="secondary">${abbrechen ? 'Schließen' : 'Abmelden'}</button>
      </div>`);
    $t('#tNochmal').onclick = () => nochmal();
    $t('#tAbbruch').onclick = abbrechen || abmeldenKlick;
  }

  function ansichtOhneInternet() {
    zeigen(`
      <h2>Tresor einrichten</h2>
      <p>Für die erste Einrichtung des Tresors auf diesem Konto ist eine Internetverbindung nötig.</p>
      <div class="actions">
        <button type="button" id="tNochmal" class="primary">Noch einmal versuchen</button>
        <button type="button" id="tAbmelden" class="secondary">Abmelden</button>
      </div>`);
    $t('#tNochmal').onclick = () => start();
    $t('#tAbmelden').onclick = abmeldenKlick;
  }

  function abmeldenKlick() {
    vergessen();
    if (ctx && typeof ctx.abmelden === 'function') ctx.abmelden();
  }

  function fertig() {
    schliessen();
    letzteAktivitaet = Date.now();
    if (wartend) {
      const w = wartend;
      wartend = null;
      w(true);
    }
  }

  /* ---------------- Automatisches Sperren ---------------- */

  function aktivitaet() {
    if (schluessel) letzteAktivitaet = Date.now();
  }

  function zeitPruefen() {
    if (schluessel && Date.now() - letzteAktivitaet > SPERRE_MINUTEN * 60 * 1000) sperren();
  }

  ['pointerdown', 'keydown', 'touchstart', 'input', 'wheel'].forEach((art) =>
    document.addEventListener(art, aktivitaet, { capture: true, passive: true })
  );
  setInterval(zeitPruefen, 20 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') zeitPruefen();
  });

  /* ---------------- Öffentliche Schnittstelle ---------------- */

  async function start() {
    laeuft('Tresor wird geladen …');
    const geladen = await standLaden();
    if (geladen.daten) {
      stand = geladen.daten;
      ansichtEntsperren();
    } else if (geladen.online) {
      stand = null;
      ansichtEinrichten();
    } else {
      ansichtOhneInternet();
    }
  }

  // Wird nach der Anmeldung aufgerufen. Erfüllt sich erst, wenn der Tresor offen ist.
  function oeffnen(optionen) {
    if (ctx && ctx.user && optionen.user && ctx.user.id !== optionen.user.id) vergessen();
    ctx = optionen;
    if (schluessel) return Promise.resolve(true);
    return new Promise((fertigMelden) => {
      wartend = fertigMelden;
      start();
    });
  }

  function sperren() {
    if (!ctx || !stand) return;
    schluessel = null;
    ansichtEntsperren();
  }

  // Beim Abmelden: Schlüssel aus dem Arbeitsspeicher entfernen
  function vergessen() {
    schluessel = null;
    stand = null;
    wartend = null;
    schliessen();
  }

  window.Tresor = {
    oeffnen,
    sperren,
    vergessen,
    istOffen: () => Boolean(schluessel),
    passwortAendern: () => { if (schluessel) ansichtPasswortAendern(); },
    notfallblattErneuern: () => { if (schluessel) ansichtNotfallblattErneuern(); },
    // Für Bauabschnitt 4: Zugriff auf den Datenschlüssel (nicht auslesbar)
    datenschluessel: () => schluessel,
    // Nur für Tests
    _intern: { codeErzeugen, codeNormalisieren, codeGueltig, codeFormatieren, passwortHuelleBauen, notfallHuelleBauen, mitPasswortOeffnen, mitCodeOeffnen }
  };
})();
