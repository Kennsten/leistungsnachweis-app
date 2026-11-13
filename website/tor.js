// Startseite vernebelt, bis der richtige Name eingegeben ist (Prüfung auf dem Server)
(function () {
  const body = document.body;
  const tor = document.getElementById('tor');
  if (!tor) return;
  const frei = () => {
    body.classList.remove('verriegelt');
    tor.hidden = true;
    try { localStorage.setItem('qa-tor', 'frei'); } catch (e) { /* egal */ }
  };
  try { if (localStorage.getItem('qa-tor') === 'frei') { frei(); return; } } catch (e) { /* egal */ }

  const form = document.getElementById('torForm');
  const feld = document.getElementById('torName');
  const meldung = document.getElementById('torMeldung');
  const knopf = form.querySelector('button');
  setTimeout(() => feld.focus(), 50);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    knopf.disabled = true;
    meldung.textContent = 'Wird geprüft …';
    try {
      const antwort = await fetch('/api/tor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: feld.value })
      });
      const d = await antwort.json();
      if (d.ok) { frei(); return; }
      if (d.gesperrt) {
        const bis = new Date(d.bis).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        meldung.textContent = 'Zu viele Versuche. Gesperrt bis ' + bis + ' Uhr.';
        feld.disabled = true;
        return;
      }
      meldung.textContent = 'Das stimmt leider nicht. Noch ' + d.rest + (d.rest === 1 ? ' Versuch.' : ' Versuche.');
      feld.select();
    } catch (e) {
      meldung.textContent = 'Keine Verbindung. Bitte später noch einmal versuchen.';
    } finally {
      knopf.disabled = feld.disabled;
    }
  });
})();
