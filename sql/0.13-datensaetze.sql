-- =====================================================================
-- Version 0.13 Verkaufsversion: Tabelle "datensaetze" für den Abgleich
-- Ausführen im Supabase SQL Editor des Projekts leistungsnachweis-eu.
-- Enthält absichtlich keine geraden Hochkommas (iPad-Tastatur).
-- =====================================================================

-- 1. Die Tabelle: ein verschlüsseltes Paket je Eintrag der App
create table if not exists public.datensaetze (
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  id uuid not null,
  version integer not null default 1 check (version >= 1),
  geloescht boolean not null default false,
  inhalt text,
  tx bigint not null default 0,
  geaendert_am timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists datensaetze_abgleich
  on public.datensaetze (user_id, tx);

-- 2. Abgleich-Nummer: Jede Änderung bekommt die Nummer ihrer Transaktion
create or replace function public.datensaetze_tx_setzen()
returns trigger
language plpgsql
as $f$
begin
  new.tx := pg_current_xact_id()::text::bigint;
  new.geaendert_am := now();
  return new;
end;
$f$;

drop trigger if exists datensaetze_tx on public.datensaetze;

create trigger datensaetze_tx
  before insert or update on public.datensaetze
  for each row
  execute function public.datensaetze_tx_setzen();

-- 3. Zugriffsschutz: jedes Konto sieht nur die eigenen Pakete
alter table public.datensaetze enable row level security;

drop policy if exists "datensaetze_eigene" on public.datensaetze;

create policy "datensaetze_eigene" on public.datensaetze
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.datensaetze from anon, authenticated;
grant select, insert, update on public.datensaetze to authenticated;

-- 4. Speichern: nimmt eine Änderung nur an, wenn das Paket seit dem
--    letzten Abgleich dieses Geräts nicht woanders geändert wurde
create or replace function public.datensaetze_speichern(p_pakete jsonb)
returns table (id uuid, ok boolean, version integer, inhalt text, geloescht boolean)
language plpgsql
security invoker
set search_path = public
as $f$
#variable_conflict use_column
declare
  p record;
  alt record;
  ich uuid := auth.uid();
begin
  if ich is null then
    raise exception using message = $m$Nicht angemeldet.$m$;
  end if;

  for p in
    select * from jsonb_to_recordset(p_pakete)
      as x(id uuid, basis integer, inhalt text, geloescht boolean)
  loop
    select d.version, d.inhalt, d.geloescht into alt
    from public.datensaetze d
    where d.user_id = ich and d.id = p.id
    for update;

    if not found then
      insert into public.datensaetze (user_id, id, version, inhalt, geloescht)
      values (ich, p.id, coalesce(p.basis, 0) + 1, p.inhalt, coalesce(p.geloescht, false));
      id := p.id; ok := true; version := coalesce(p.basis, 0) + 1;
      inhalt := null; geloescht := null;
    elsif alt.version = coalesce(p.basis, 0) then
      update public.datensaetze d
      set version = alt.version + 1,
          inhalt = p.inhalt,
          geloescht = coalesce(p.geloescht, false)
      where d.user_id = ich and d.id = p.id;
      id := p.id; ok := true; version := alt.version + 1;
      inhalt := null; geloescht := null;
    else
      id := p.id; ok := false; version := alt.version;
      inhalt := alt.inhalt; geloescht := alt.geloescht;
    end if;
    return next;
  end loop;
end;
$f$;

-- 5. Holen: alle Pakete, die seit dem letzten Abgleich dazugekommen
--    sind. Die letzte Zeile (id leer) nennt den neuen Abgleich-Stand.
create or replace function public.datensaetze_holen(p_ab bigint)
returns table (id uuid, version integer, inhalt text, geloescht boolean, bis bigint)
language plpgsql
stable
security invoker
set search_path = public
as $f$
#variable_conflict use_column
declare
  grenze bigint := pg_snapshot_xmin(pg_current_snapshot())::text::bigint;
begin
  return query
    select d.id, d.version, d.inhalt, d.geloescht, grenze
    from public.datensaetze d
    where d.user_id = auth.uid()
      and d.tx >= coalesce(p_ab, 0)
      and d.tx < grenze
    order by d.tx;
  id := null; version := null; inhalt := null; geloescht := null; bis := grenze;
  return next;
end;
$f$;

revoke all on function public.datensaetze_speichern(jsonb) from public, anon;
revoke all on function public.datensaetze_holen(bigint) from public, anon;
grant execute on function public.datensaetze_speichern(jsonb) to authenticated;
grant execute on function public.datensaetze_holen(bigint) to authenticated;

-- 6. Kontrolle: sollte eine Zeile mit "datensaetze" zeigen
select tablename, rowsecurity from pg_tables where tablename = $$datensaetze$$;
