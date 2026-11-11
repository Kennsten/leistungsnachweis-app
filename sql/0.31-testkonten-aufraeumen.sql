-- =====================================================================
-- Täglicher Auftrag: Testkonten 30 Tage nach Ablauf löschen (3:17 Uhr UTC)
-- Ausführen NACH 0.30-testkonten.sql im Supabase SQL Editor.
-- Falls ein Fehler zu „pg_cron“ kommt: Database → Extensions → „pg_cron“
-- einschalten und diese Datei erneut ausführen.
-- =====================================================================
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = $t$qa-testkonten-aufraeumen$t$;

select cron.schedule($t$qa-testkonten-aufraeumen$t$, $t$17 3 * * *$t$,
                     $t$select public.konten_aufraeumen()$t$);

-- Kontrolle: sollte eine Zeile „qa-testkonten-aufraeumen“ zeigen
select jobname, schedule from cron.job where jobname = $t$qa-testkonten-aufraeumen$t$;
