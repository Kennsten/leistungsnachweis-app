-- =====================================================================
-- Version 0.25.2: Konto in der App selbst auflösen (Löschung nach Art. 17 DSGVO)
-- Ausführen im Supabase SQL Editor des Projekts leistungsnachweis-eu,
-- NACH 0.30-testkonten.sql (braucht die Tabellen und Funktionen daraus).
-- Enthält absichtlich keine geraden Hochkommas (iPad-Tastatur).
--
-- Was es tut: Die angemeldete Person kann ihr eigenes Konto samt allen
-- Daten auf dem Server löschen (E-Mail-Adresse, Passwort-Prüfwert, Tresor,
-- verschlüsselte Datenpakete, Kontostatus). Es gibt kein Zurück.
-- Das Verwalter-Konto (Testkonten-Verwaltung) ist ausgenommen, damit die
-- Verwaltung nicht versehentlich verwaist.
-- =====================================================================

create or replace function public.konto_selbst_loeschen()
returns void
language plpgsql
security definer
set search_path = public, auth
as $f$
declare
  ich uuid := auth.uid();
begin
  if ich is null then
    raise exception using message = $t$Nicht angemeldet.$t$;
  end if;
  if exists (select 1 from public.konten_verwaltung v where v.user_id = ich) then
    raise exception using message =
      $t$Das Verwalter-Konto kann nicht in der App gelöscht werden. Bitte zuerst die Verwaltung übertragen.$t$;
  end if;
  perform public.konto_daten_entfernen(ich);
end;
$f$;

revoke all on function public.konto_selbst_loeschen() from public, anon;
grant execute on function public.konto_selbst_loeschen() to authenticated;

-- Kontrolle: sollte eine Zeile mit konto_selbst_loeschen zeigen
select proname from pg_proc where proname = $t$konto_selbst_loeschen$t$;
