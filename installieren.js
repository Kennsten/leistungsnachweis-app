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

  /* ---------------- Bilder (selbst gezeichnet, folgen dem Design) ---------------- */

  const BILDER = {
    teilen: ['Safari auf dem iPhone: unten in der Leiste das Teilen-Symbol antippen',
      '<rect class="ib-f" x="14" y="8" width="292" height="144" rx="16"/>' +
      '<rect class="ib-bar" x="30" y="24" width="110" height="9" rx="4"/>' +
      '<rect class="ib-bar" x="30" y="40" width="210" height="7" rx="3"/>' +
      '<rect class="ib-bar" x="30" y="53" width="180" height="7" rx="3"/>' +
      '<rect class="ib-bar" x="30" y="66" width="200" height="7" rx="3"/>' +
      '<rect class="ib-a" x="28" y="92" width="264" height="22" rx="11"/>' +
      '<text class="ib-g" x="160" y="107" text-anchor="middle">Adresse der App</text>' +
      '<path class="ib-l" d="M48 127l-7 7 7 7M92 127l7 7-7 7"/>' +
      '<circle class="ib-ring" cx="160" cy="134" r="17"/>' +
      '<path class="ib-l" d="M160 140v-14M155 131l5-5 5 5M154 134h-2a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2"/>' +
      '<path class="ib-l" d="M214 128h20v13h-20zM224 128v13M268 130h12v10h-12zM272 126h12v10"/>'],
    menue: ['Teilen-Menü: Eintrag „Zum Home-Bildschirm“',
      '<rect class="ib-f" x="14" y="8" width="292" height="144" rx="16"/>' +
      '<rect class="ib-b" x="28" y="20" width="26" height="26" rx="7"/>' +
      '<text class="ib-w" x="41" y="38" text-anchor="middle">QA</text>' +
      '<text class="ib-t" x="64" y="31">QA – Qualifizierte Assistenz</text>' +
      '<text class="ib-g" x="64" y="44">Adresse der App</text>' +
      '<rect class="ib-a" x="28" y="56" width="264" height="88" rx="10"/>' +
      '<text class="ib-t" x="42" y="76">Kopieren</text>' +
      '<path class="ib-sep" d="M42 84h238"/>' +
      '<rect class="ib-ring" x="26" y="88" width="268" height="26" rx="8"/>' +
      '<text class="ib-t" x="42" y="105">Zum Home-Bildschirm</text>' +
      '<path class="ib-l" d="M262 95h14v14h-14zM269 98v8M265 102h8"/>' +
      '<path class="ib-sep" d="M42 118h238"/>' +
      '<text class="ib-t" x="42" y="134">Lesezeichen hinzufügen</text>'],
    hinzufuegen: ['Fenster „Zum Home-Bildschirm“: oben rechts „Hinzufügen“ antippen',
      '<rect class="ib-f" x="14" y="8" width="292" height="144" rx="16"/>' +
      '<text class="ib-g" x="26" y="32">Abbrechen</text>' +
      '<text class="ib-t" x="148" y="32" text-anchor="middle">Zum Home-Bildschirm</text>' +
      '<rect class="ib-ring" x="226" y="16" width="76" height="24" rx="12"/>' +
      '<text class="ib-t" x="264" y="32" text-anchor="middle">Hinzufügen</text>' +
      '<rect class="ib-a" x="28" y="52" width="264" height="52" rx="10"/>' +
      '<rect class="ib-b" x="38" y="60" width="36" height="36" rx="9"/>' +
      '<text class="ib-w" x="56" y="83" text-anchor="middle">QA</text>' +
      '<text class="ib-t" x="88" y="74">QA</text>' +
      '<text class="ib-g" x="88" y="90">Adresse der App</text>' +
      '<rect class="ib-a" x="28" y="112" width="264" height="32" rx="10"/>' +
      '<text class="ib-t" x="42" y="132">Als Web-App öffnen</text>' +
      '<rect class="ib-b" x="244" y="119" width="36" height="20" rx="10"/>' +
      '<circle class="ib-knopf" cx="270" cy="129" r="8"/>'],
    symbol: ['Das Symbol „QA“ liegt jetzt auf dem Home-Bildschirm',
      '<rect class="ib-f" x="14" y="8" width="292" height="144" rx="16"/>' +
      '<rect class="ib-bar" x="38" y="24" width="44" height="44" rx="11"/>' +
      '<rect class="ib-bar" x="98" y="24" width="44" height="44" rx="11"/>' +
      '<rect class="ib-bar" x="158" y="24" width="44" height="44" rx="11"/>' +
      '<rect class="ib-bar" x="218" y="24" width="44" height="44" rx="11"/>' +
      '<rect class="ib-bar" x="98" y="82" width="44" height="44" rx="11"/>' +
      '<rect class="ib-bar" x="158" y="82" width="44" height="44" rx="11"/>' +
      '<rect class="ib-bar" x="218" y="82" width="44" height="44" rx="11"/>' +
      '<rect class="ib-ring" x="34" y="78" width="52" height="52" rx="13"/>' +
      '<rect class="ib-b" x="38" y="82" width="44" height="44" rx="11"/>' +
      '<text class="ib-w ib-gross" x="60" y="110" text-anchor="middle">QA</text>' +
      '<text class="ib-g" x="60" y="144" text-anchor="middle">QA</text>'],
    mac: ['Safari auf dem Mac: Menü „Ablage“, Eintrag „Zum Dock hinzufügen …“',
      '<rect class="ib-f" x="14" y="8" width="292" height="144" rx="12"/>' +
      '<rect class="ib-a" x="14" y="8" width="292" height="24" rx="12"/>' +
      '<text class="ib-t" x="26" y="24">Safari</text>' +
      '<rect class="ib-ring" x="72" y="11" width="56" height="18" rx="6"/>' +
      '<text class="ib-t" x="100" y="24" text-anchor="middle">Ablage</text>' +
      '<text class="ib-g" x="150" y="24">Bearbeiten</text>' +
      '<text class="ib-g" x="212" y="24">Darstellung</text>' +
      '<rect class="ib-f" x="72" y="34" width="156" height="106" rx="8"/>' +
      '<text class="ib-g" x="86" y="54">Neues Fenster</text>' +
      '<text class="ib-g" x="86" y="72">Neuer Tab</text>' +
      '<rect class="ib-ring" x="77" y="80" width="146" height="22" rx="6"/>' +
      '<text class="ib-t" x="86" y="95">Zum Dock hinzufügen …</text>' +
      '<text class="ib-g" x="86" y="120">Fenster schließen</text>'],
    chromePc: ['Chrome oder Edge am Computer: rechts in der Adresszeile das Symbol „Installieren“',
      '<rect class="ib-f" x="14" y="8" width="292" height="144" rx="12"/>' +
      '<rect class="ib-a" x="14" y="8" width="292" height="26" rx="12"/>' +
      '<rect class="ib-f" x="24" y="14" width="86" height="20" rx="7"/>' +
      '<rect class="ib-a" x="26" y="42" width="268" height="24" rx="12"/>' +
      '<text class="ib-g" x="42" y="58">Adresse der App</text>' +
      '<circle class="ib-ring" cx="266" cy="54" r="13"/>' +
      '<path class="ib-l" d="M259 49h14v9h-14zM266 50.5v4M263.5 52.5l2.5 2.5 2.5-2.5M266 58v3M262 61h8"/>' +
      '<rect class="ib-f" x="140" y="76" width="154" height="68" rx="10"/>' +
      '<text class="ib-t" x="154" y="95">„QA“ installieren?</text>' +
      '<text class="ib-g" x="154" y="108">Öffnet in einem eigenen Fenster</text>' +
      '<rect class="ib-b" x="214" y="116" width="68" height="20" rx="10"/>' +
      '<text class="ib-w ib-klein" x="248" y="130" text-anchor="middle">Installieren</text>'],
    chromeAndroid: ['Chrome auf Android: Menü ⋮, Eintrag „App installieren“',
      '<rect class="ib-f" x="14" y="8" width="292" height="144" rx="16"/>' +
      '<rect class="ib-a" x="26" y="18" width="224" height="22" rx="11"/>' +
      '<text class="ib-g" x="138" y="33" text-anchor="middle">Adresse der App</text>' +
      '<circle class="ib-ring" cx="278" cy="29" r="13"/>' +
      '<circle class="ib-dot" cx="278" cy="23" r="2"/><circle class="ib-dot" cx="278" cy="29" r="2"/><circle class="ib-dot" cx="278" cy="35" r="2"/>' +
      '<rect class="ib-f" x="150" y="48" width="146" height="98" rx="10"/>' +
      '<text class="ib-g" x="164" y="68">Neuer Tab</text>' +
      '<text class="ib-g" x="164" y="86">Lesezeichen</text>' +
      '<rect class="ib-ring" x="154" y="94" width="138" height="22" rx="7"/>' +
      '<text class="ib-t" x="164" y="109">App installieren</text>' +
      '<text class="ib-g" x="164" y="134">Teilen …</text>']
  };

  function bild(name) {
    const b = BILDER[name];
    return '<svg class="install-bild" viewBox="0 0 320 160" role="img" aria-label="' + b[0] + '">' + b[1] + '</svg>';
  }

  /* ---------------- Aufklappbare Hilfe mit Bildern ---------------- */

  let boxOffen = false;       // Kasten im Anmeldefenster auf- oder zugeklappt
  let browserWahl = null;     // vom Nutzer gewählter Reiter

  function browserArt() {
    const ua = navigator.userAgent || '';
    if (/FxiOS|Firefox/.test(ua)) return 'firefox';
    if (/CriOS|EdgiOS|Edg\/|Chrome/.test(ua)) return 'chrome';
    return 'safari';
  }

  // Welcher Geräteblock ist beim Öffnen schon aufgeklappt?
  function geraetArt() {
    const p = plattform();
    return p === 'ios' ? 'ios' : p === 'android' ? 'android' : 'computer';
  }

  const bildSchritt = (text, name) =>
    '<li>' + text + (name ? bild(name) : '') + '</li>';

  function geraet(art, titelText, inhalt) {
    return '<details class="install-geraet"' + (geraetArt() === art ? ' open' : '') + '>' +
      '<summary>' + titelText + '</summary>' + inhalt + '</details>';
  }

  const hinweis = (text, warn) =>
    '<p class="install-hinweis' + (warn ? ' warn' : '') + '">' + text + '</p>';

  function inhaltSafari() {
    return geraet('ios', 'iPhone und iPad',
      '<ol class="install-schritte">' +
      bildSchritt('Öffne diese Seite in <strong>Safari</strong> und tippe auf das <strong>Teilen-Symbol</strong> ' + TEILEN +
        ' (beim iPad oben rechts). Siehst du es nicht, tippe zuerst auf <strong>•••</strong>.', 'teilen') +
      bildSchritt('Wische im Menü nach oben und tippe auf <strong>„Zum Home-Bildschirm“</strong>.', 'menue') +
      bildSchritt('Lass <strong>„Als Web-App öffnen“</strong> eingeschaltet und tippe oben rechts auf <strong>„Hinzufügen“</strong>.', 'hinzufuegen') +
      bildSchritt('Schließe Safari. Öffne die App ab jetzt über das Symbol <strong>„QA“</strong> auf deinem Home-Bildschirm.', 'symbol') +
      '</ol>') +
      geraet('computer', 'Mac (macOS Sonoma oder neuer)',
        '<ol class="install-schritte">' +
        bildSchritt('Klicke oben in der Menüleiste auf <strong>„Ablage“</strong> und dann auf <strong>„Zum Dock hinzufügen …“</strong>. Klicke im Fenster auf <strong>„Hinzufügen“</strong>.', 'mac') +
        bildSchritt('Öffne die App ab jetzt über das Symbol <strong>„QA“</strong> im Dock.') +
        '</ol>' + hinweis('Der Menüpunkt heißt je nach macOS-Version leicht anders.'));
  }

  function inhaltChrome() {
    return geraet('android', 'Android',
      '<ol class="install-schritte">' +
      bildSchritt('Öffne diese Seite in <strong>Chrome</strong> und tippe oben rechts auf die drei Punkte <strong>⋮</strong>.') +
      bildSchritt('Tippe auf <strong>„App installieren“</strong> (manchmal heißt es „Zum Startbildschirm hinzufügen“) und bestätige.', 'chromeAndroid') +
      bildSchritt('Öffne die App ab jetzt über das Symbol <strong>„QA“</strong> auf deinem Startbildschirm.', 'symbol') +
      '</ol>') +
      geraet('computer', 'Windows und Mac (Computer)',
        '<ol class="install-schritte">' +
        bildSchritt('Öffne diese Seite in <strong>Chrome</strong> oder <strong>Edge</strong>. Klicke rechts in der Adresszeile auf das Symbol <strong>„Installieren“</strong> und bestätige.', 'chromePc') +
        bildSchritt('Öffne die App ab jetzt über das Symbol <strong>„QA“</strong> (Startmenü, Desktop oder Dock).') +
        '</ol>' + hinweis('Fehlt das Symbol in der Adresszeile: Klicke oben rechts auf <strong>⋮</strong> bzw. <strong>…</strong> und such nach <strong>„Als App installieren“</strong> (in Chrome unter „Streamen, speichern und teilen“, in Edge unter „Apps“).')) +
      geraet('ios', 'iPhone und iPad',
        hinweis('Auch Chrome auf dem iPhone und iPad kann die App über das Teilen-Menü auf den Home-Bildschirm legen. Am einfachsten geht es aber mit <strong>Safari</strong>, siehe Reiter „Safari“.'));
  }

  function inhaltFirefox() {
    return geraet('ios', 'iPhone und iPad',
      hinweis('Firefox auf dem iPhone und iPad kann die App ebenfalls über das Teilen-Menü auf den Home-Bildschirm legen. Am einfachsten geht es mit <strong>Safari</strong>, siehe Reiter „Safari“.')) +
      geraet('android', 'Android',
        hinweis('Firefox legt auf Android nur eine Verknüpfung an. Die App öffnet sich dann im Browser, nicht als eigene App. Bitte nimm <strong>Chrome</strong>, siehe Reiter „Chrome“.', true)) +
      geraet('computer', 'Windows und Mac (Computer)',
        hinweis('Firefox kann die App am Computer nach unserem Kenntnisstand nicht zuverlässig installieren. Bitte nimm <strong>Chrome</strong> oder <strong>Edge</strong>, auf dem Mac auch <strong>Safari</strong>.', true));
  }

  function hilfeInhalt() {
    const tab = browserWahl || browserArt();
    const tabs = [['safari', 'Safari'], ['chrome', 'Chrome / Edge'], ['firefox', 'Firefox']];
    const knopf = abfrage
      ? '<div class="actions"><button type="button" class="primary install-knopf" data-installieren>App jetzt installieren</button></div>'
      : '';
    return knopf +
      '<p class="install-frage">Welchen Browser benutzt du?</p>' +
      '<div class="install-tabs" role="tablist">' + tabs.map((t) =>
        '<button type="button" role="tab" class="install-tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + t[1] + '</button>'
      ).join('') + '</div>' +
      (tab === 'safari' ? inhaltSafari() : tab === 'chrome' ? inhaltChrome() : inhaltFirefox());
  }

  const BOX_SYMBOL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M12 8v6M9.5 11.5 12 14l2.5-2.5"/></svg>';

  function box() {
    return '<button type="button" class="install-box-kopf" data-box aria-expanded="' + boxOffen + '" aria-controls="installBoxInhalt">' +
      '<span class="install-box-symbol">' + BOX_SYMBOL + '</span>' +
      '<span class="install-box-text"><strong>Vorbereitende Maßnahme</strong>' +
      '<span>für iPhone/iPad/macOS sowie Android und Windows – bitte hier klicken</span></span>' +
      '<span class="install-box-pfeil" aria-hidden="true"></span></button>' +
      '<div id="installBoxInhalt" class="install-box-inhalt' + (boxOffen ? '' : ' hidden') + '">' +
      '<h2>App auf dem Gerät installieren</h2>' + warum() + hilfeInhalt() + '</div>';
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

    if (zeigen) {
      karte.innerHTML = installiertJetzt
        ? '<div class="install-box-inhalt"><h2>Installiert!</h2>' + anleitung() + '</div>'
        : box();
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
      dialogInhalt.innerHTML = '<h2>' + titel() + '</h2>' + warum() + (installiertJetzt ? anleitung() : hilfeInhalt());
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
      const z = e.target.closest('[data-installieren],[data-ausblenden],[data-anleitung],[data-box],[data-tab]');
      if (!z) return;
      if (z.hasAttribute('data-installieren')) installieren();
      else if (z.hasAttribute('data-box')) { boxOffen = !boxOffen; anzeigen(); }
      else if (z.hasAttribute('data-tab')) { browserWahl = z.dataset.tab; anzeigen(); }
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
