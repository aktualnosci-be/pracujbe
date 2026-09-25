-- =============================================================================
-- 0113_storage_gc.sql — #17: dzienny GC plików prywatnego bucketu CV (Railway).
-- NUMER TYMCZASOWY — ostateczny nada integrator.
--
-- Przebieg (sweep) porównuje listę obiektów bucketu z wierszami `files`, partiami w
-- kolejności kluczy (S3 ListObjectsV2 = porządek bajtowy → porównania COLLATE "C"):
--   * obiekt bez wiersza `files`, starszy niż okres karencji (upload w toku) → kolejka
--     `storage_deletion_queue` (0105) — usuwa go istniejący worker z ponowieniami. W trybie
--     dry-run nic nie trafia do kolejki, rosną tylko liczniki.
--   * wiersz `files` bez obiektu → TYLKO licznik (bez kasowania wiersza: wiersz może wskazywać
--     obiekt ze starego storage sprzed migracji; decyzja o nim należy do człowieka).
-- Stan przebiegu: `storage_gc_sweeps` (kursor = ostatni sprawdzony klucz, liczniki, dzierżawa).
-- Nowy przebieg startuje najwcześniej `p_min_interval_hours` po zakończeniu poprzedniego
-- (dzienny rytm przy cronie co godzinę); niedokończony przebieg jest kontynuowany.
-- Kursor jest czyszczony po zakończeniu przebiegu; historia liczników — 90 dni. Ścieżki nie trafiają do logów ani wyniku.
--
-- Uprawnienia: tabela bez dostępu dla anon/authenticated; funkcje tylko service_role.
--
-- Rollback: drop function public.storage_gc_page(uuid, text, text[], text[], boolean, integer, boolean);
--           drop function public.storage_gc_begin(text, integer, boolean);
--           drop table public.storage_gc_sweeps;  (kolejka 0105 bez zmian)
-- =============================================================================

create table if not exists public.storage_gc_sweeps (
  id                 uuid primary key default gen_random_uuid(),
  bucket             text not null check (char_length(bucket) between 1 and 100),
  dry_run            boolean not null,
  cursor_key         text check (cursor_key is null or char_length(cursor_key) <= 500),
  locked_until       timestamptz,
  pages              integer not null default 0 check (pages >= 0),
  objects_scanned    integer not null default 0 check (objects_scanned >= 0),
  orphan_objects     integer not null default 0 check (orphan_objects >= 0),
  orphan_queued      integer not null default 0 check (orphan_queued >= 0),
  missing_objects    integer not null default 0 check (missing_objects >= 0),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  check (finished_at is null or cursor_key is null)
);
-- Jeden otwarty przebieg na bucket.
create unique index if not exists uq_storage_gc_sweeps_open
  on public.storage_gc_sweeps (bucket) where finished_at is null;
create index if not exists idx_storage_gc_sweeps_finished
  on public.storage_gc_sweeps (bucket, finished_at desc);

alter table public.storage_gc_sweeps enable row level security;
alter table public.storage_gc_sweeps force row level security;
revoke all on public.storage_gc_sweeps from public, anon, authenticated;

-- Rozpoczęcie albo kontynuacja przebiegu z dzierżawą 10 min (dwa równoległe crony: drugi
-- dostaje `status = 'busy'`). Zwraca kursor (NULL = od początku bucketu).
create or replace function public.storage_gc_begin(
  p_bucket text,
  p_min_interval_hours integer default 23,
  p_dry_run boolean default true
) returns table (status text, sweep_id uuid, cursor_key text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_open public.storage_gc_sweeps;
  v_last timestamptz;
begin
  if p_bucket is null or char_length(p_bucket) not between 1 and 100 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  -- Serializacja startu przebiegu per bucket (bez wyścigu na indeksie unikalnym).
  perform pg_advisory_xact_lock(hashtext('storage_gc:' || p_bucket));

  select * into v_open from public.storage_gc_sweeps s
   where s.bucket = p_bucket and s.finished_at is null
   for update;
  if found then
    if v_open.locked_until is not null and v_open.locked_until > now() then
      return query select 'busy'::text, v_open.id, null::text;
      return;
    end if;
    -- Zmiana trybu (dry-run ↔ delete) w trakcie: porzucamy niedokończony przebieg i
    -- zaczynamy od nowa, żeby liczniki opisywały jeden tryb.
    if v_open.dry_run is distinct from coalesce(p_dry_run, true) then
      delete from public.storage_gc_sweeps where id = v_open.id;
    else
      update public.storage_gc_sweeps set locked_until = now() + interval '10 minutes'
       where id = v_open.id;
      return query select 'continue'::text, v_open.id, v_open.cursor_key;
      return;
    end if;
  end if;

  -- Historia przebiegów (same liczniki) — 90 dni.
  delete from public.storage_gc_sweeps s
   where s.bucket = p_bucket and s.finished_at < now() - interval '90 days';

  select max(s.finished_at) into v_last from public.storage_gc_sweeps s
   where s.bucket = p_bucket and s.finished_at is not null;
  if v_last is not null
     and v_last > now() - make_interval(hours => greatest(0, least(coalesce(p_min_interval_hours, 23), 24 * 7))) then
    return query select 'not_due'::text, null::uuid, null::text;
    return;
  end if;

  insert into public.storage_gc_sweeps (bucket, dry_run, locked_until)
  values (p_bucket, coalesce(p_dry_run, true), now() + interval '10 minutes')
  returning id into v_open.id;
  return query select 'started'::text, v_open.id, null::text;
end $$;
revoke all on function public.storage_gc_begin(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.storage_gc_begin(text, integer, boolean) to service_role;

-- Jedna strona listy bucketu: `p_keys` = WSZYSTKIE klucze CV strony (posortowane, zakres
-- (kursor, ostatni klucz]), `p_old_keys` = podzbiór starszy niż karencja. `p_final` = ostatnia
-- strona listy (zakres do końca). `p_release` = ostatnia strona tego wywołania (limit stron):
-- dzierżawa zwolniona, kolejny cron kontynuuje od kursora. Zwraca liczniki strony; kursor przesuwa się atomowo.
create or replace function public.storage_gc_page(
  p_sweep_id uuid,
  p_last_key text,
  p_keys text[],
  p_old_keys text[],
  p_final boolean,
  p_grace_hours integer default 24,
  p_release boolean default false
) returns table (orphan_objects integer, orphan_queued integer, missing_objects integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sweep public.storage_gc_sweeps;
  v_keys text[] := coalesce(p_keys, '{}');
  v_old text[] := coalesce(p_old_keys, '{}');
  v_grace interval := make_interval(hours => greatest(1, least(coalesce(p_grace_hours, 24), 24 * 30)));
  v_orphans integer := 0;
  v_queued integer := 0;
  v_missing integer := 0;
begin
  if cardinality(v_keys) > 1000 or cardinality(v_old) > cardinality(v_keys)
     or not (v_old <@ v_keys)
     or (p_last_key is null and not coalesce(p_final, false))
     or (p_last_key is not null and char_length(p_last_key) > 500) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select * into v_sweep from public.storage_gc_sweeps s
   where s.id = p_sweep_id and s.finished_at is null
   for update;
  if not found then
    raise exception 'STALE_STATE' using errcode = 'P0001';
  end if;
  -- Strona musi leżeć za kursorem (retry tej samej strony po zatwierdzeniu = STALE_STATE).
  if v_sweep.cursor_key is not null
     and exists (select 1 from unnest(v_keys) k where k collate "C" <= v_sweep.cursor_key collate "C") then
    raise exception 'STALE_STATE' using errcode = 'P0001';
  end if;
  if p_last_key is not null
     and exists (select 1 from unnest(v_keys) k where k collate "C" > p_last_key collate "C") then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  -- Obiekty bez wiersza files (także miękko usuniętego — ten ma własną retencję).
  select count(*)::integer into v_orphans
    from unnest(v_old) k
   where not exists (select 1 from public.files f where f.bucket = v_sweep.bucket and f.path = k);

  if not v_sweep.dry_run and v_orphans > 0 then
    with ins as (
      insert into public.storage_deletion_queue (bucket, path)
      select v_sweep.bucket, k from unnest(v_old) k
       where not exists (select 1 from public.files f where f.bucket = v_sweep.bucket and f.path = k)
      on conflict (bucket, path) do nothing
      returning 1
    ) select count(*)::integer into v_queued from ins;
  end if;

  -- Wiersze files w zakresie strony bez obiektu w buckecie (tylko licznik).
  select count(*)::integer into v_missing
    from public.files f
   where f.bucket = v_sweep.bucket
     and f.created_at < now() - v_grace
     and (v_sweep.cursor_key is null or f.path collate "C" > v_sweep.cursor_key collate "C")
     and (coalesce(p_final, false) or f.path collate "C" <= p_last_key collate "C")
     and not (f.path = any (v_keys));

  update public.storage_gc_sweeps s
     set pages = s.pages + 1,
         objects_scanned = s.objects_scanned + cardinality(v_keys),
         orphan_objects = s.orphan_objects + v_orphans,
         orphan_queued = s.orphan_queued + v_queued,
         missing_objects = s.missing_objects + v_missing,
         cursor_key = case when coalesce(p_final, false) then null else p_last_key end,
         finished_at = case when coalesce(p_final, false) then now() else null end,
         locked_until = case when coalesce(p_final, false) or coalesce(p_release, false) then null
                             else now() + interval '10 minutes' end
   where s.id = v_sweep.id;

  return query select v_orphans, v_queued, v_missing;
end $$;
revoke all on function public.storage_gc_page(uuid, text, text[], text[], boolean, integer, boolean) from public, anon, authenticated;
grant execute on function public.storage_gc_page(uuid, text, text[], text[], boolean, integer, boolean) to service_role;

do $$
begin
  if not has_function_privilege('service_role', 'public.storage_gc_begin(text, integer, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.storage_gc_page(uuid, text, text[], text[], boolean, integer, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.storage_gc_page(uuid, text, text[], text[], boolean, integer, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.storage_gc_begin(text, integer, boolean)', 'EXECUTE') then
    raise exception 'storage_gc: niezgodne uprawnienia EXECUTE.';
  end if;
end $$;
