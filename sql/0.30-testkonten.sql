-- =====================================================================
-- Version 0.25 Verkaufsversion: Testkonten (7 Tage), Vollversion, Sperre
-- Ausführen im Supabase SQL Editor des Projekts leistungsnachweis-eu
-- (Frankfurt). Enthält absichtlich keine geraden Hochkommas (iPad-Tastatur):
-- Texte stehen zwischen $t$ … $t$.
--
-- Was es tut:
-- 1. Tabelle "konten": Status je Konto – test (bis Datum), voll, gesperrt.
-- 2. Alle bereits vorhandenen Konten werden "voll".
-- 3. Jedes NEUE Konto beginnt als Test für 7 Tage.
-- 4. Abgelaufene oder gesperrte Konten dürfen nichts mehr speichern
--    (Sperre im Server, nicht nur in der App).
-- 5. Funktionen für die App: eigenen Status lesen, Verwaltung der Konten.
-- 6. Abgelaufene Testkonten werden 30 Tage nach Ablauf gelöscht
--    (per Knopf in der Verwaltung; täglich automatisch mit 0.31).
-- =====================================================================

-- 1. Tabellen
create table if not exists public.konten (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  status text not null default $t$test$t$
    check (status in ($t$test$t$, $t$voll$t$, $t$gesperrt$t$)),
  test_bis timestamptz,
  angelegt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  notiz text
);

-- Wer Konten verwalten darf (nur der Anbieter)
create table if not exists public.konten_verwaltung (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.konten enable row level security;
alter table public.konten_verwaltung enable row level security;
revoke all on public.konten from anon, authenticated;
revoke all on public.konten_verwaltung from anon, authenticated;
-- Lesen und Ändern nur über die Funktionen unten

-- 2. Vorhandene Konten werden Vollversion
insert into public.konten (user_id, email, status)
  select u.id, u.email, $t$voll$t$ from auth.users u
  on conflict (user_id) do nothing;

-- 3. Neue Konten: Test für 7 Tage
create or replace function public.konto_anlegen()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  insert into public.konten (user_id, email, status, test_bis)
  values (new.id, new.email, $t$test$t$, now() + interval $t$7 days$t$)
  on conflict (user_id) do nothing;
  return new;
end;
$f$;

drop trigger if exists konto_neu on auth.users;
create trigger konto_neu
  after insert on auth.users
  for each row execute function public.konto_anlegen();

-- 4. Darf dieses Konto speichern?
create or replace function public.konto_aktiv(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $f$
  select coalesce(
    (select k.status = $t$voll$t$ or (k.status = $t$test$t$ and k.test_bis > now())
       from public.konten k where k.user_id = p),
    true);
$f$;

drop policy if exists "datensaetze_nur_aktive_neu" on public.datensaetze;
create policy "datensaetze_nur_aktive_neu" on public.datensaetze
  as restrictive for insert
  with check (public.konto_aktiv(auth.uid()));

drop policy if exists "datensaetze_nur_aktive_aendern" on public.datensaetze;
create policy "datensaetze_nur_aktive_aendern" on public.datensaetze
  as restrictive for update
  using (public.konto_aktiv(auth.uid()));

-- 5a. Eigener Status (für die App)
create or replace function public.mein_konto()
returns jsonb
language sql
stable
security definer
set search_path = public
as $f$
  select jsonb_build_object(
    $t$status$t$, coalesce(k.status, $t$voll$t$),
    $t$test_bis$t$, k.test_bis,
    $t$aktiv$t$, public.konto_aktiv(auth.uid()),
    $t$loeschung_am$t$, case when k.status = $t$test$t$
                            then k.test_bis + interval $t$30 days$t$ end,
    $t$verwaltung$t$, exists (select 1 from public.konten_verwaltung v where v.user_id = auth.uid()),
    $t$verwaltung_frei$t$, not exists (select 1 from public.konten_verwaltung)
                           and coalesce(k.status, $t$voll$t$) = $t$voll$t$
  )
  from (select auth.uid() as id) ich
  left join public.konten k on k.user_id = ich.id;
$f$;

-- 5b. Verwaltung einrichten: Das erste Vollkonto, das es anfordert, wird
--     Verwalter*in. Danach geht das nur noch durch eine bestehende Verwaltung.
create or replace function public.verwaltung_beanspruchen()
returns boolean
language plpgsql
security definer
set search_path = public
as $f$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.konten_verwaltung) then return false; end if;
  if not exists (select 1 from public.konten k
                 where k.user_id = auth.uid() and k.status = $t$voll$t$) then
    return false;
  end if;
  insert into public.konten_verwaltung (user_id) values (auth.uid());
  return true;
end;
$f$;

create or replace function public.ist_verwaltung()
returns boolean
language sql
stable
security definer
set search_path = public
as $f$
  select exists (select 1 from public.konten_verwaltung v where v.user_id = auth.uid());
$f$;

-- 5c. Liste aller Konten (nur Verwaltung)
create or replace function public.konten_liste()
returns setof public.konten
language plpgsql
stable
security definer
set search_path = public
as $f$
begin
  if not public.ist_verwaltung() then
    raise exception using message = $t$Keine Berechtigung.$t$;
  end if;
  return query select * from public.konten order by angelegt_am desc;
end;
$f$;

-- 5d. Konto ändern (nur Verwaltung): Status setzen und/oder Test verlängern
create or replace function public.konto_setzen(p_user uuid, p_status text, p_tage integer, p_notiz text)
returns void
language plpgsql
security definer
set search_path = public
as $f$
begin
  if not public.ist_verwaltung() then
    raise exception using message = $t$Keine Berechtigung.$t$;
  end if;
  update public.konten k set
    status = coalesce(p_status, k.status),
    test_bis = case
      when p_tage is not null then greatest(coalesce(k.test_bis, now()), now()) + make_interval(days => p_tage)
      else k.test_bis end,
    notiz = coalesce(p_notiz, k.notiz),
    geaendert_am = now()
  where k.user_id = p_user;
end;
$f$;

-- 5e0. Alle Zeilen eines Kontos in allen Tabellen mit user_id entfernen
--      (auch ältere Tabellen), danach das Konto selbst
create or replace function public.konto_daten_entfernen(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $f$
declare
  t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = $t$public$t$ and c.column_name = $t$user_id$t$
      and tb.table_type = $t$BASE TABLE$t$
      and c.table_name not in ($t$konten$t$, $t$konten_verwaltung$t$)
  loop
    execute format($q$delete from public.%I where user_id = $1$q$, t.table_name) using p_user;
  end loop;
  delete from auth.users where id = p_user;
end;
$f$;

-- 5e. Konto mit allen Daten löschen (nur Verwaltung; nie das eigene)
create or replace function public.konto_loeschen(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $f$
begin
  if not public.ist_verwaltung() then
    raise exception using message = $t$Keine Berechtigung.$t$;
  end if;
  if p_user = auth.uid() then
    raise exception using message = $t$Das eigene Konto kann hier nicht gelöscht werden.$t$;
  end if;
  perform public.konto_daten_entfernen(p_user);
end;
$f$;

-- 6. Aufräumen: Testkonten 30 Tage nach Ablauf löschen
create or replace function public.konten_aufraeumen()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $f$
declare
  anzahl integer := 0;
  r record;
begin
  -- Aufruf aus der App nur durch die Verwaltung; der tägliche Auftrag läuft ohne Anmeldung
  if auth.uid() is not null and not public.ist_verwaltung() then
    raise exception using message = $t$Keine Berechtigung.$t$;
  end if;
  for r in
    select k.user_id from public.konten k
    where k.status = $t$test$t$ and k.test_bis < now() - interval $t$30 days$t$
  loop
    perform public.konto_daten_entfernen(r.user_id);
    anzahl := anzahl + 1;
  end loop;
  return anzahl;
end;
$f$;

revoke all on function public.konto_anlegen() from public, anon, authenticated;
revoke all on function public.konto_daten_entfernen(uuid) from public, anon, authenticated;
revoke all on function public.konto_aktiv(uuid) from public, anon;
revoke all on function public.mein_konto() from public, anon;
revoke all on function public.verwaltung_beanspruchen() from public, anon;
revoke all on function public.ist_verwaltung() from public, anon;
revoke all on function public.konten_liste() from public, anon;
revoke all on function public.konto_setzen(uuid, text, integer, text) from public, anon;
revoke all on function public.konto_loeschen(uuid) from public, anon;
revoke all on function public.konten_aufraeumen() from public, anon;
grant execute on function public.konto_aktiv(uuid) to authenticated;
grant execute on function public.mein_konto() to authenticated;
grant execute on function public.verwaltung_beanspruchen() to authenticated;
grant execute on function public.ist_verwaltung() to authenticated;
grant execute on function public.konten_liste() to authenticated;
grant execute on function public.konto_setzen(uuid, text, integer, text) to authenticated;
grant execute on function public.konto_loeschen(uuid) to authenticated;
grant execute on function public.konten_aufraeumen() to authenticated;

-- 7. Kontrolle: zeigt alle Konten mit Status
select email, status, test_bis from public.konten order by angelegt_am;
