-- =============================================================================
-- 0982_job_work_locations.sql — dodatkowe miejsca pracy jednej oferty (#850, etap 1).
-- Numer tymczasowy (ostateczny nada integrator).
--
-- Problem (#850): oferta ma jedną lokalizację strukturalną (`jobs.city` + `jobs.location_id`).
-- Praca mobilna/terenowa obejmująca kilka miejscowości musi wybrać jedno miasto bazowe, a reszta
-- trafia co najwyżej do opisu — kandydat szukający po innej z tych miejscowości nie widzi oferty.
--
-- Etap 1 (ta migracja):
-- 1. `job_work_locations` — do 10 DODATKOWYCH miejscowości oferty (miasto główne zostaje
--    w `jobs.city`). Nazwa jak wpisał pracodawca (2–80 znaków, bez znaków sterujących), klucz
--    `name_key` = `city_key(name)` (unikalny w ofercie), `location_id` = miejscowość ze słownika
--    (trigger, jak `jobs.location_id` z 0153; nowy alias dowiązuje wiersze bez miejscowości).
--    RLS: odczyt dla aktywnego członka firmy oferty; zapis WYŁĄCZNIE przez RPC poniżej (bez
--    grantów INSERT/UPDATE/DELETE dla klientów).
-- 2. `set_job_work_locations(job, names[])` — replace-all, tylko SZKIC (jak relacje kreatora),
--    recruiter+ firmy oferty; normalizacja spacji, deduplikacja po kluczu, pozycja = kolejność,
--    pominięcie wpisu równego miastu głównemu. Kreator woła je w tej samej transakcji co
--    `save_job_draft` (krok 3), więc błąd cofa cały krok.
-- 3. „Kopiuj jako szkic” (0148) przenosi listę — trigger na `job_duplications` (jak 0169/0172).
-- 4. `get_public_job_work_locations(job)` — anon; lista tylko dla oferty publicznej
--    (`job_is_public`), bez wpisu równego bieżącemu miastu głównemu.
-- 5. `search_city_candidates` (0183) — wyszukiwanie tekstowe miasta (pole „miasto” wyszukiwarki,
--    `p_city` w `get_public_jobs`/`_count`/facetach/`saved_search_jobs_after`) znajduje ofertę
--    także po dodatkowym miejscu pracy: po tekście nazwy albo po miejscowości ze słownika
--    (z częściami gminy, `location_filter_ids`). Ciała list ofert i kopii filtrów alertów NIE
--    są zmieniane (wszystkie wołają tę funkcję, więc zostają zgodne).
--
-- Etap 2 (osobny PR, po #1270/#1275): sidebarowy filtr `p_locations` i facet miasta po
-- dodatkowych miejscach, edycja listy w opublikowanej ofercie (`update_published_job`), matching.
--
-- Rollback: supabase/rollback/0982_job_work_locations.down.sql
-- (test: supabase/tests/job-work-locations-rollback.sql w scripts/test-rls.sh).
-- =============================================================================

-- --- 1. Tabela -----------------------------------------------------------------------------
create table public.job_work_locations (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  position    smallint not null check (position between 1 and 10),
  name        text not null check (char_length(name) between 2 and 80 and name !~ '[[:cntrl:]]'),
  name_key    text not null,
  location_id uuid references public.locations(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (job_id, position),
  unique (job_id, name_key)
);
comment on table public.job_work_locations is
  'Dodatkowe miejsca pracy oferty (#850, 0982). Miasto główne = jobs.city. Zapis tylko przez '
  'set_job_work_locations (szkic, recruiter+) i kopię szkicu; odczyt publiczny przez '
  'get_public_job_work_locations.';
create index idx_job_work_locations_location on public.job_work_locations(location_id)
  where location_id is not null;
create index idx_job_work_locations_unlinked on public.job_work_locations(name_key)
  where location_id is null;
create index idx_job_work_locations_name_fold on public.job_work_locations
  using gin (public.search_fold(name) gin_trgm_ops);

alter table public.job_work_locations enable row level security;
revoke all on public.job_work_locations from public, anon, authenticated, service_role;
grant select on public.job_work_locations to authenticated, service_role;

create policy job_work_locations_select_member on public.job_work_locations
  for select to authenticated
  using (public.is_job_company_member(job_id));

-- Klucz i miejscowość ustala baza (każda ścieżka zapisu).
create or replace function public.job_work_locations_normalize()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.name := pg_catalog.btrim(pg_catalog.regexp_replace(new.name, '[[:space:]]+', ' ', 'g'));
  new.name_key := public.city_key(new.name);
  new.location_id := public.resolve_location_id(new.name);
  return new;
end $$;
revoke all on function public.job_work_locations_normalize() from public;

create trigger trg_job_work_locations_normalize
  before insert or update of name on public.job_work_locations
  for each row execute function public.job_work_locations_normalize();

-- Nowy alias w słowniku dowiązuje wiersze bez miejscowości (jak 0153 dla jobs).
create or replace function public.job_work_locations_relink_alias()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.job_work_locations w
     set location_id = public.resolve_location_id(w.name)
   where w.location_id is null and w.name_key = new.alias_key;
  return null;
end $$;
revoke all on function public.job_work_locations_relink_alias() from public;

create trigger trg_location_aliases_relink_work_locations
  after insert or update of alias_key, location_id on public.location_aliases
  for each row execute function public.job_work_locations_relink_alias();

-- --- 2. Zapis listy (szkic) -----------------------------------------------------------------
create or replace function public.set_job_work_locations(p_job_id uuid, p_names text[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
  v_main_key text;
  v_name text;
  v_key text;
  v_keys text[] := '{}';
  v_pos smallint := 0;
begin
  if auth.uid() is null then
    raise exception 'PERMISSION_DENIED: wymagane logowanie' using errcode = '42501';
  end if;
  select status::text, public.city_key(coalesce(city, '')) into v_status, v_main_key
    from public.jobs where id = p_job_id and deleted_at is null
    for update;
  if v_status is null or not public.is_job_company_member(p_job_id) then
    raise exception 'NOT_FOUND: oferta' using errcode = 'P0002';
  end if;
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: wymagana rola recruiter+' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'JOB_NOT_DRAFT: listę miejsc pracy zmienia się w szkicu' using errcode = '22023';
  end if;
  if coalesce(array_length(p_names, 1), 0) > 10 then
    raise exception 'VALIDATION_FAILED: najwyżej 10 dodatkowych miejsc pracy' using errcode = '22023';
  end if;

  delete from public.job_work_locations where job_id = p_job_id;
  foreach v_name in array coalesce(p_names, '{}'::text[]) loop
    v_name := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_name, ''), '[[:space:]]+', ' ', 'g'));
    if char_length(v_name) < 2 or char_length(v_name) > 80 or v_name ~ '[[:cntrl:]]' then
      raise exception 'VALIDATION_FAILED: nieprawidłowa nazwa miejsca pracy' using errcode = '22023';
    end if;
    v_key := public.city_key(v_name);
    continue when v_key = v_main_key or v_key = any(v_keys);
    v_keys := v_keys || v_key;
    v_pos := v_pos + 1;
    insert into public.job_work_locations(job_id, position, name, name_key)
      values (p_job_id, v_pos, v_name, v_key);
  end loop;
  return v_pos;
end $$;
revoke all on function public.set_job_work_locations(uuid, text[]) from public, anon;
grant execute on function public.set_job_work_locations(uuid, text[]) to authenticated;

-- --- 3. Kopia szkicu (0148) -------------------------------------------------------------------
create or replace function public.job_duplications_copy_work_locations()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.job_work_locations(job_id, position, name, name_key)
  select new.new_job_id, w.position, w.name, w.name_key
    from public.job_work_locations w
    join public.jobs d on d.id = new.new_job_id and d.status = 'draft' and d.deleted_at is null
   where w.job_id = new.source_job_id
  on conflict do nothing;
  return null;
end $$;
revoke all on function public.job_duplications_copy_work_locations() from public;

create trigger trg_job_duplications_copy_work_locations
  after insert on public.job_duplications
  for each row execute function public.job_duplications_copy_work_locations();

-- --- 4. Odczyt publiczny --------------------------------------------------------------------
create or replace function public.get_public_job_work_locations(p_job_id uuid)
returns table (name text, location_id uuid, "position" smallint)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.name, w.location_id, w.position
    from public.job_work_locations w
    join public.jobs j on j.id = w.job_id
   where w.job_id = p_job_id
     and public.job_is_public(p_job_id)
     and w.name_key <> public.city_key(coalesce(j.city, ''))
   order by w.position;
$$;
revoke all on function public.get_public_job_work_locations(uuid) from public;
grant execute on function public.get_public_job_work_locations(uuid) to anon, authenticated, service_role;

-- --- 5. Wyszukiwanie tekstowe miasta (stan 0183) + dodatkowe miejsca pracy -------------------
create or replace function public.search_city_candidates(p_city text)
returns setof uuid language sql stable strict
set search_path = public, pg_temp as $$
  select j.id from public.jobs j
  where j.status = 'active' and j.deleted_at is null
    and public.search_fold(j.city) like public.search_like_pattern(p_city) escape '\'
  union
  select j.id from public.jobs j
  where j.status = 'active' and j.deleted_at is null
    and j.location_id in (select unnest(public.location_filter_ids(array[left(p_city, 200)])))
  union
  select w.job_id from public.job_work_locations w
  join public.jobs j on j.id = w.job_id
  where j.status = 'active' and j.deleted_at is null
    and (public.search_fold(w.name) like public.search_like_pattern(p_city) escape '\'
         or w.location_id in (select unnest(public.location_filter_ids(array[left(p_city, 200)]))));
$$;
revoke all on function public.search_city_candidates(text) from public;
