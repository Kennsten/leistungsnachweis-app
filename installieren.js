/* =====================================================================
   Installations-Assistent (Version 0.21 Verkaufsversion)

   Eine Web-App darf sich nicht selbst auf den Home-Bildschirm legen.
   Dieser Baustein hilft dabei, so einfach es das jeweilige Gerät erlaubt:
   - Läuft die App schon als installierte App, passiert nichts.
   - iPhone/iPad und Safari auf dem Mac: Schritt-für-Schritt-Anleitung.
   - Android, Windows, Mac mit Chrome/Edge: Knopf „App installieren“,
     der die Abfrage des Browsers öffnet.
   - Auf dem Anmeldefenster erscheint eine Karte, in der App eine
     schmale Leiste mit Link zur Anleitung.
   - Einstellungen → „Kolleg*innen einladen“: QR-Code und Link zur App.
   ===================================================================== */

(function () {
  'use strict';

  let abfrage = null;        // gemerktes „beforeinstallprompt“-Ereignis
  let installiertJetzt = false;

  // Muss früh registriert werden: Chrome meldet die Installierbarkeit
  // oft schon während die Seite lädt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    abfrage = e;
    anzeigen();
  });

  window.addEventListener('appinstalled', () => {
    abfrage = null;
    installiertJetzt = true;
    anzeigen();
  });

  /* ---------------- Erkennen ---------------- */

  function istInstalliert() {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
      if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    } catch (e) { /* alter Browser */ }
    return window.navigator.standalone === true;
  }

  function plattform() {
    const ua = navigator.userAgent || '';
    const istIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (istIOS) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    const istMac = /Macintosh/.test(ua);
    const istChromium = /Chrome|Chromium|Edg\//.test(ua);
    if (istMac && /Safari/.test(ua) && !istChromium) return 'mac-safari';
    if (/Firefox/.test(ua)) return 'firefox';
    return 'computer';
  }

  /* ---------------- Inhalte ---------------- */

  const TEILEN = '<svg class="install-symbol" viewBox="0 0 24 24" aria-label="Teilen-Symbol" role="img">' +
    '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10H16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const schritte = (liste) => '<ol class="install-schritte">' + liste.map((s) => '<li>' + s + '</li>').join('') + '</ol>';

  function titel() {
    const p = plattform();
    return p === 'ios' || p === 'android' ? 'App auf den Home-Bildschirm legen' : 'App installieren';
  }

  function warum() {
    return '<p class="muted small">Nur über das QA-Symbol sind deine Daten sicher auf dem Gerät gespeichert und ohne Internet verfügbar.</p>';
  }

  const hilfe = (punkte) => '<details class="install-hilfe"><summary>Klappt etwas nicht?</summary><ul>' +
    punkte.map((s) => '<li>' + s + '</li>').join('') + '</ul></details>';

  function anleitung() {
    if (installiertJetzt) {
      return '<p><strong>Installiert!</strong> Schließe dieses Fenster und öffne die App ab jetzt über das neue Symbol „QA“.</p>';
    }
    const p = plattform();
    if (p === 'ios') {
      return schritte([
        'Öffne diese Seite in <strong>Safari</strong> (blaues Kompass-Symbol).',
        'Tippe auf das <strong>Teilen-Symbol</strong> ' + TEILEN + ' (Quadrat mit Pfeil nach oben).',
        'Wische im Menü nach oben und tippe auf <strong>„Zum Home-Bildschirm“</strong>.',
        'Tippe oben rechts auf <strong>„Hinzufügen“</strong>.',
        'Schließe Safari. Öffne die App ab jetzt über das Symbol <strong>„QA“</strong> auf deinem Home-Bildschirm.'
      ]) + hilfe([
        'Du hast den Link in WhatsApp, Mail o. Ä. angetippt: Tippe dort auf <strong>„In Safari öffnen“</strong>.',
        'Das Teilen-Symbol ist nicht zu sehen: Tippe auf die drei Punkte <strong>•••</strong>, dann erscheint es.',
        'Vor „Hinzufügen“ muss der Schalter <strong>„Als Web-App öffnen“</strong> eingeschaltet bleiben.'
      ]);
    }
    if (p === 'mac-safari') {
      return schritte([
        'Klicke oben in der Menüleiste auf <strong>„Ablage“</strong>.',
        'Klicke auf <strong>„Zum Dock hinzufügen …“</strong>.',
        'Klicke im Fenster auf <strong>„Hinzufügen“</strong>.',
        'Öffne die App ab jetzt über das Symbol <strong>„QA“</strong> im Dock.'
      ]);
    }
    if (abfrage) {
      return '<div class="actions"><button type="button" class="primary install-knopf" data-installieren>App installieren</button></div>' +
        '<p class="muted small">Tippe auf den Knopf und bestätige die Abfrage. Öffne die App danach über das Symbol „QA“.</p>';
    }
    if (p === 'android') {
      return schritte([
        'Öffne diese Seite in <strong>Chrome</strong>.',
        'Tippe oben rechts auf die drei Punkte <strong>⋮</strong>.',
        'Tippe auf <strong>„App installieren“</strong> und bestätige.',
        'Öffne die App ab jetzt über das Symbol <strong>„QA“</strong>.'
      ]) + hilfe([
        'Du hast den Link in WhatsApp, Mail o. Ä. angetippt: Öffne ihn stattdessen in <strong>Chrome</strong>.',
        'Es steht nur <strong>„Zum Startbildschirm hinzufügen“</strong> im Menü: Wähle diesen Eintrag und bestätige.'
      ]);
    }
    if (p === 'firefox') {
      return '<p>Firefox kann diese App auf dem Computer nicht installieren. Bitte die Seite in <strong>Chrome</strong>, <strong>Edge</strong> oder auf dem Mac in <strong>Safari</strong> öffnen.</p>';
    }
    return schritte([
      'Öffne diese Seite in <strong>Chrome</strong> oder <strong>Edge</strong>.',
      'Klicke rechts in der Adresszeile auf das Symbol <strong>„Installieren“</strong> (kleiner Bildschirm mit Pfeil).',
      'Bestätige mit <strong>„Installieren“</strong>.',
      'Öffne die App ab jetzt über das Symbol <strong>„QA“</strong>.'
    ]) + hilfe([
      'Kein Symbol in der Adresszeile: Klicke oben rechts auf die drei Punkte <strong>⋮</strong> bzw. <strong>…</strong> und wähle „Apps“ oder „Streamen, speichern und teilen“ → <strong>„Als App installieren“</strong>.'
    ]);
  }

  /* ---------------- Anzeigen ---------------- */

  const ausgeblendet = (k) => { try { return sessionStorage.getItem(k) === '1'; } catch (e) { return false; } };
  const ausblenden = (k) => { try { sessionStorage.setItem(k, '1'); } catch (e) { /* egal */ } };

  function anzeigen() {
    const karte = document.getElementById('installKarte');
    const leiste = document.getElementById('installLeiste');
    const dialogInhalt = document.getElementById('installDialogInhalt');
    if (!karte || !leiste) return;

    const zeigen = !istInstalliert() || installiertJetzt;

    if (zeigen && !ausgeblendet('qa-install-karte')) {
      karte.innerHTML =
        '<div class="top"><h2>' + titel() + '</h2>' +
        '<button type="button" class="kn kn-schliessen secondary" data-ausblenden="karte">Ausblenden</button></div>' +
        warum() + anleitung();
      karte.classList.remove('hidden');
    } else {
      karte.classList.add('hidden');
    }

    if (zeigen && !installiertJetzt && !ausgeblendet('qa-install-leiste')) {
      leiste.innerHTML =
        '<span>Du nutzt die App im Browser. Bitte installieren, damit deine Daten dauerhaft gespeichert bleiben.</span>' +
        '<span class="install-leiste-knoepfe">' +
        '<button type="button" class="abgleich-knopf" data-anleitung>Anleitung</button>' +
        '<button type="button" class="abgleich-knopf" data-ausblenden="leiste" aria-label="Hinweis ausblenden">✕</button></span>';
      leiste.classList.remove('hidden');
    } else {
      leiste.classList.add('hidden');
    }

    if (dialogInhalt) {
      dialogInhalt.innerHTML = '<h2>' + titel() + '</h2>' + warum() + anleitung();
    }
  }

  async function installieren() {
    if (!abfrage) return;
    const e = abfrage;
    abfrage = null;
    try {
      await e.prompt();
      const wahl = await e.userChoice;
      if (wahl && wahl.outcome === 'accepted') installiertJetzt = true;
    } catch (f) { /* abgebrochen */ }
    anzeigen();
  }

  /* ---------------- Kolleg*innen einladen ---------------- */

  function appAdresse() {
    return new URL('./', location.href).href;
  }

  function einladungZeigen() {
    const dlg = document.getElementById('einladenDialog');
    if (!dlg) return;
    const adresse = appAdresse();
    const qr = document.getElementById('einladenQr');
    qr.innerHTML = '';
    if (typeof window.qrcode === 'function') {
      const code = window.qrcode(0, 'M');
      code.addData(adresse);
      code.make();
      qr.innerHTML = code.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    }
    document.getElementById('einladenAdresse').textContent = adresse;
    document.getElementById('einladenTeilen').classList.toggle('hidden', !navigator.share);
    const s = document.getElementById('settingsDialog');
    if (s && s.open) s.close();
    dlg.showModal();
  }

  async function teilen() {
    try {
      await navigator.share({
        title: 'QA – Qualifizierte Assistenz',
        text: 'Hier kannst du die App QA – Qualifizierte Assistenz öffnen und installieren:',
        url: appAdresse()
      });
    } catch (e) { /* abgebrochen */ }
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(appAdresse());
      if (typeof window.toast === 'function') window.toast('Link kopiert.');
    } catch (e) {
      if (typeof window.toast === 'function') window.toast('Kopieren nicht möglich. Bitte den Link oben markieren.');
    }
  }

  /* ---------------- Start ---------------- */

  function start() {
    document.addEventListener('click', (e) => {
      const z = e.target.closest('[data-installieren],[data-ausblenden],[data-anleitung]');
      if (!z) return;
      if (z.hasAttribute('data-installieren')) installieren();
      else if (z.hasAttribute('data-anleitung')) {
        anzeigen();
        document.getElementById('installDialog').showModal();
      } else {
        ausblenden(z.dataset.ausblenden === 'karte' ? 'qa-install-karte' : 'qa-install-leiste');
        anzeigen();
      }
    });
    const knopf = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = f; };
    knopf('installDialogSchliessen', () => document.getElementById('installDialog').close());
    knopf('einladenKnopf', einladungZeigen);
    knopf('einladenSchliessen', () => document.getElementById('einladenDialog').close());
    knopf('einladenTeilen', teilen);
    knopf('einladenKopieren', kopieren);
    try {
      window.matchMedia('(display-mode: standalone)').addEventListener('change', anzeigen);
    } catch (e) { /* alter Browser */ }
    anzeigen();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.Installieren = { anzeigen, istInstalliert, plattform };
})();
