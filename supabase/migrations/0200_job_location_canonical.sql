-- =============================================================================
-- 0200_job_location_canonical.sql — kanoniczne miasto oferty (audyt P1-10).
-- Numer tymczasowy — ostateczny nada integrator.
--
-- Problem: `jobs.city` to tekst wpisany w kreatorze. Filtr i landing miasta porównywały go
-- DOKŁADNIE z listą nazw (`j.city = any(p_locations)`), więc „Antwerpen ”, „ANTWERPEN”,
-- „anvers” albo nazwa gminy spoza 10 tłumaczonych miast wypadały z filtra, a facety
-- dzieliły jedno miasto na kilka pozycji.
--
-- 1. `city_key(text)` — ta sama normalizacja co `cityKey` w TS (NFD bez znaków łączących,
--    małe litery, spacje/myślniki → jedna spacja). Zgodność pilnuje rls.sql sekcja LC200.
-- 2. `jobs.location_id` → `locations` (0112): miejscowość ze słownika rozpoznana po aliasie
--    (`location_aliases.alias_key`, nazwy PL/NL/FR/EN). Wpisany tekst `jobs.city` zostaje bez
--    zmian (prezentacja, JSON-LD). Nierozpoznana nazwa = `null` i dotychczasowe zachowanie.
--    Ustawia ją WYŁĄCZNIE trigger przy każdym zapisie miasta (kreator `save_job_draft`,
--    `update_published_job`, import, bezpośredni DML) — klient jej nie poda.
-- 3. Nowe aliasy w słowniku (np. części gmin z osobnej migracji) dowiązują oferty bez
--    miejscowości: trigger na `location_aliases`.
-- 4. Filtry: `get_public_jobs` / `_count` / `get_public_job_filter_facets` dopasowują
--    `p_locations` po dokładnym tekście ALBO po miejscowości (aliasy wartości filtra →
--    `location_id`); facet miasta = jedna pozycja na miejscowość (nazwa kanoniczna
--    `locations.name`). Wyszukiwanie tekstowe miasta (`search_city_candidates`) dokłada oferty
--    z miejscowości rozpoznanej z wpisu („Antwerpia” znajduje „Antwerpen”). Pozostała treść
--    funkcji = stan z 0140 (get_public_jobs) i 0110 (count, facety, search_city_candidates);
--    sygnatury, typy zwrotu i granty bez zmian.
-- 5. Backfill istniejących ofert bez zmiany `updated_at` (tokenu CAS edycji, #325).
--
-- Rollback: NOWA migracja naprawcza — odtworzenie get_public_jobs z 0140 oraz count, facetów
-- i search_city_candidates z 0110 (create or replace, te same sygnatury); drop triggerów
-- trg_jobs_resolve_location i trg_location_aliases_relink_jobs z ich funkcjami, drop
-- location_filter_ids, resolve_location_id, city_key; `alter table jobs drop column location_id`.
-- =============================================================================

-- --- 1. Klucz miasta (lustro cityKey z src/lib/matching/belgian-cities.ts) --------------------
create or replace function public.city_key(p_value text)
returns text language sql immutable strict parallel safe as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.regexp_replace(normalize(p_value, NFD), '[\u0300-\u036f]', '', 'g')),
    '[[:space:]\u00a0-]+', ' ', 'g'));
$$;
revoke all on function public.city_key(text) from public;
grant execute on function public.city_key(text) to anon, authenticated, service_role;

-- --- 2. Miejscowość ze słownika po aliasie ----------------------------------------------------
create or replace function public.resolve_location_id(p_city text)
returns uuid language sql stable parallel safe security definer set search_path = public, pg_temp as $$
  select a.location_id
  from public.location_aliases a
  join public.locations l on l.id = a.location_id and l.is_active
  where a.alias_key = public.city_key(left(p_city, 200))
  limit 1;
$$;
revoke all on function public.resolve_location_id(text) from public;
grant execute on function public.resolve_location_id(text) to anon, authenticated, service_role;

-- Wartości filtra miasta (dowolny język i pisownia) → miejscowości ze słownika.
create or replace function public.location_filter_ids(p_values text[])
returns uuid[] language sql stable parallel safe security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct a.location_id), '{}'::uuid[])
  from unnest(p_values[1:100]) v
  join public.location_aliases a on a.alias_key = public.city_key(left(v, 200))
  join public.locations l on l.id = a.location_id and l.is_active;
$$;
revoke all on function public.location_filter_ids(text[]) from public;
grant execute on function public.location_filter_ids(text[]) to anon, authenticated, service_role;

alter table public.jobs
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_jobs_location_id on public.jobs (location_id)
  where location_id is not null;
comment on column public.jobs.location_id is
  'Miejscowość ze słownika rozpoznana z jobs.city (trigger trg_jobs_resolve_location, 0200). Wpisany tekst zostaje w jobs.city.';

-- Każdy zapis miasta ustala miejscowość; podana przez klienta wartość jest nadpisywana.
create or replace function public.jobs_resolve_location()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Usunięcie miejscowości (FK on delete set null) = akcja wewnętrzna (głębokość > 1):
  -- zostawiamy null, bez ponownego odczytu słownika w trakcie kaskady.
  if tg_op = 'UPDATE' and new.city is not distinct from old.city
     and new.location_id is null and pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' or new.city is distinct from old.city
     or new.location_id is distinct from old.location_id then
    new.location_id := public.resolve_location_id(new.city);
  end if;
  return new;
end $$;
revoke all on function public.jobs_resolve_location() from public, anon, authenticated;
drop trigger if exists trg_jobs_resolve_location on public.jobs;
-- Nazwa po trg_guard_* (BEFORE wykonują się alfabetycznie): strażnicy widzą wartość klienta.
create trigger trg_jobs_resolve_location
  before insert or update on public.jobs
  for each row execute function public.jobs_resolve_location();

-- --- 3. Nowe aliasy w słowniku dowiązują oferty bez miejscowości ------------------------------
create or replace function public.location_aliases_relink_jobs()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.jobs j
     set location_id = public.resolve_location_id(j.city)
   where j.location_id is null
     and public.city_key(j.city) in (select n.alias_key from new_aliases n);
  return null;
end $$;
revoke all on function public.location_aliases_relink_jobs() from public, anon, authenticated;
drop trigger if exists trg_location_aliases_relink_jobs on public.location_aliases;
create trigger trg_location_aliases_relink_jobs
  after insert on public.location_aliases
  referencing new table as new_aliases
  for each statement execute function public.location_aliases_relink_jobs();

-- --- 5. Backfill (bez podbicia updated_at — to token CAS edycji opublikowanej oferty) ----------
alter table public.jobs disable trigger trg_set_updated_at;
alter table public.jobs disable trigger trg_strict_job_version;
update public.jobs
   set location_id = public.resolve_location_id(city)
 where location_id is distinct from public.resolve_location_id(city);
alter table public.jobs enable trigger trg_set_updated_at;
alter table public.jobs enable trigger trg_strict_job_version;

-- --- 4. Wyszukiwanie tekstowe miasta: + miejscowość rozpoznana z wpisu (stan 0110) -------------
create or replace function public.search_city_candidates(p_city text)
returns setof uuid language sql stable strict
set search_path = public, pg_temp as $$
  select j.id from public.jobs j
  where j.status = 'active' and j.deleted_at is null
    and public.search_fold(j.city) like public.search_like_pattern(p_city) escape '\'
  union
  select j.id from public.jobs j
  where j.status = 'active' and j.deleted_at is null
    and j.location_id = (select public.resolve_location_id(p_city));
$$;
revoke all on function public.search_city_candidates(text) from public;

-- --- 4. Lista ofert (stan 0140) + miejscowość w filtrze p_locations ---------------------------
create or replace function public.get_public_jobs(
  p_locale         text        default 'pl',
  p_keyword        text        default null,
  p_city           text        default null,
  p_categories     text[]      default null,
  p_locations      text[]      default null,
  p_contract_types text[]      default null,
  p_salary_min     integer     default null,
  p_salary_max     integer     default null,
  p_accommodation  boolean     default null,
  p_immediate      boolean     default null,
  p_no_language    boolean     default null,
  p_since          timestamptz default null,
  p_sort           text        default 'newest',
  p_limit          integer     default 20,
  p_offset         integer     default 0,
  p_salary_unit    text        default 'month'
)
returns table (
  id uuid, slug text, title text, company_name text, company_verified boolean,
  city text, region text, contract_type text, salary_min integer, salary_max integer,
  currency text, salary_period text, published_at timestamptz, highlights text[], category text,
  accommodation boolean, immediate boolean, no_language_required boolean, company_slug text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.id, j.slug,
    coalesce(t.title, j.title) as title,
    c.name as company_name,
    (c.status = 'verified') as company_verified,
    j.city, j.region, j.contract_type::text,
    j.salary_min, j.salary_max, coalesce(j.currency, 'EUR') as currency,
    j.salary_period::text as salary_period,
    j.published_at,
    coalesce(t.highlights, '{}'::text[]) as highlights,
    j.category::text,
    j.accommodation, j.immediate, j.no_language_required,
    c.slug as company_slug
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title, jt.highlights
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified' and c.deleted_at is null
    -- #97: zalogowany kandydat nie dostaje ofert firm, które zablokował (gość: bez zmian).
    and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations)
         or j.location_id in (select unnest(public.location_filter_ids(p_locations))))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.id in (select public.search_city_candidates(left(p_city, 100))))
    -- Prefiltr po indeksach (tytuł oferty albo któregokolwiek tłumaczenia); dokładny
    -- warunek na wyświetlanym tytule niżej.
    and (p_keyword is null or j.id in (
      select public.search_title_candidates(left(p_keyword, 100))))
    and (p_keyword is null or public.search_fold(coalesce(t.title, j.title))
      like public.search_like_pattern(left(p_keyword, 100)) escape '\')
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
  order by
    (case when p_sort = 'salary' then public.job_salary_sort_key(
      j.salary_min, j.salary_max, j.salary_period, p_salary_unit) end) desc nulls last,
    j.published_at desc,
    -- #594 (0136): tie-breaker deterministyczny (PK, unikalny) — bez niego remis na kluczu
    -- wynagrodzenia/dacie publikacji może zmieniać kolejność między wywołaniami i ciąć
    -- grupę remisową w innym miejscu przy offsetowej paginacji (pominięcia/duplikaty).
    j.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

-- --- 4. Licznik ofert (stan 0110) + miejscowość w filtrze p_locations --------------------------
create or replace function public.get_public_jobs_count(
  p_locale         text      default 'pl',
  p_keyword        text      default null,
  p_city           text      default null,
  p_categories     text[]    default null,
  p_locations      text[]    default null,
  p_contract_types text[]    default null,
  p_salary_min     integer   default null,
  p_salary_max     integer   default null,
  p_accommodation  boolean   default null,
  p_immediate      boolean   default null,
  p_no_language    boolean   default null,
  p_since          timestamptz default null,
  p_salary_unit    text      default 'month'
) returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::bigint
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified' and c.deleted_at is null
    -- #97: zalogowany kandydat nie dostaje ofert firm, które zablokował (gość: bez zmian).
    and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations)
         or j.location_id in (select unnest(public.location_filter_ids(p_locations))))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.id in (select public.search_city_candidates(left(p_city, 100))))
    -- Prefiltr po indeksach (tytuł oferty albo któregokolwiek tłumaczenia); dokładny
    -- warunek na wyświetlanym tytule niżej.
    and (p_keyword is null or j.id in (
      select public.search_title_candidates(left(p_keyword, 100))))
    and (p_keyword is null or public.search_fold(coalesce(t.title, j.title))
      like public.search_like_pattern(left(p_keyword, 100)) escape '\')
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since);
$$;

-- --- 4. Facety (stan 0110) + miejscowość w filtrze i jedna pozycja facetu na miejscowość ------
create or replace function public.get_public_job_filter_facets(
  p_locale text default 'pl', p_keyword text default null, p_city text default null,
  p_categories text[] default null, p_locations text[] default null,
  p_contract_types text[] default null, p_salary_min integer default null,
  p_salary_max integer default null, p_accommodation boolean default null,
  p_immediate boolean default null, p_no_language boolean default null,
  p_since timestamptz default null, p_salary_unit text default 'month'
) returns table (dimension text, key text, total bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with input as (
    select
      case when public.is_supported_locale(p_locale) then p_locale else 'pl' end locale,
      nullif(left(p_keyword,100),'') keyword, nullif(left(p_city,100),'') city,
      (select array_agg(distinct left(v,100)) from unnest(p_categories[1:100]) v where v <> '') categories,
      (select array_agg(distinct left(v,100)) from unnest(p_locations[1:100]) v where v <> '') locations,
      public.location_filter_ids(p_locations[1:100]) location_ids,
      (select array_agg(distinct left(v,100)) from unnest(p_contract_types[1:100]) v where v <> '') contracts
  ), base as materialized (
    select j.id, j.category::text category, j.city, j.location_id,
      -- P1-10: jedna pozycja facetu na miejscowość ze słownika (nazwa kanoniczna), inne bez zmian.
      coalesce(l.name, j.city) city_label, j.contract_type::text contract_type,
      j.accommodation, j.immediate, j.no_language_required
    from public.jobs j
    join public.companies c on c.id=j.company_id
    left join public.locations l on l.id=j.location_id and l.is_active
    cross join input i
    left join lateral (
      select jt.title from public.job_translations jt where jt.job_id=j.id
      order by (jt.locale=i.locale) desc, (jt.locale=j.default_locale) desc,
        (jt.locale='en') desc limit 1
    ) t on true
    where j.status='active' and j.deleted_at is null
      and (j.expires_at is null or j.expires_at>now())
      and c.status='verified' and c.deleted_at is null
      and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
      and (nullif(left(p_keyword,100),'') is null or j.id in (
        select public.search_title_candidates(left(p_keyword,100))))
      and (i.keyword is null or public.search_fold(coalesce(t.title,j.title))
        like public.search_like_pattern(i.keyword) escape '\')
      and (nullif(left(p_city,100),'') is null or j.id in (
        select public.search_city_candidates(left(p_city,100))))
      and public.job_salary_in_range(
        j.salary_min,j.salary_max,j.salary_period,p_salary_min,p_salary_max,p_salary_unit)
      and (p_since is null or j.published_at>=p_since)
  ), selected as (select * from input)
  select 'total','all',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required)
  union all
  select 'category',b.category,count(*) from base b cross join selected s where
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) group by b.category
  union all
  select 'location',b.city_label,count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) group by b.city_label
  union all
  select 'contract',b.contract_type,count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) group by b.contract_type
  union all
  select 'accommodation',case when b.accommodation then 'provided' else 'unavailable' end,count(*)
    from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required)
    group by b.accommodation
  union all
  select 'additional','immediate',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and b.immediate and
    (coalesce(p_no_language,false)=false or b.no_language_required)
  union all
  select 'additional','no_language',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and b.no_language_required;
$$;
