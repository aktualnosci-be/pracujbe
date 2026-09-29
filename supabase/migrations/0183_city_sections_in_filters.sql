-- =============================================================================
-- 0183_city_sections_in_filters.sql — części gmin w filtrze, liczniku, facetach i wyszukiwaniu
-- miasta (#1076, audyt SRCH-01). NUMER TYMCZASOWY — ostateczny nada integrator.
--
-- Problem: oferta zapisana z częścią gminy (np. „Deurne”, „Heverlee”, „Haren”; 0151:
-- `locations.kind = 'section'` + `parent_location_id`) ma `jobs.location_id` = część, ale filtr
-- po gminie („Antwerpen”, „Leuven”, „Bruksela”, landing miasta, licznik huba, zapisane
-- wyszukiwania) porównywał tylko z samą gminą (`location_filter_ids` → jej id), więc oferty
-- z dzielnic wypadały z listy, licznika i landingu, a facet miał osobną pozycję na dzielnicę.
--
-- Naprawa (bez zmiany sygnatur, typów zwrotu i grantów):
-- 1. `location_filter_ids(text[])` — miejscowości wskazane wartościami filtra ORAZ ich aktywne
--    części (`parent_location_id`, jeden poziom: część ma gminę, gminą nie bywa część —
--    strażnik 0151). Ta jedna funkcja zasila `get_public_jobs`, `get_public_jobs_count`,
--    `get_public_job_filter_facets` i `saved_search_jobs_after`, więc BLOKI FROM … WHERE
--    tych funkcji zostają bez zmian (test saved-search-keyset-sync) — alerty zapisanych
--    wyszukiwań i lista widzą to samo. Filtr po samej części („Heverlee”) zwraca tylko tę część.
-- 2. `search_city_candidates(text)` — wpis rozpoznany jako gmina obejmuje oferty jej części
--    (wcześniej tylko `resolve_location_id`, czyli jedna miejscowość).
-- 3. `get_public_job_filter_facets` (stan 0167) — pozycja facetu „miasto” = gmina nadrzędna
--    dla oferty w części gminy (nazwa kanoniczna `locations.name` gminy), spójna z filtrem:
--    zaznaczenie pozycji zwraca dokładnie tyle ofert, ile pokazuje licznik.
-- Kod TS (city-aliases.ts, job-list-query.ts) nie wymaga zmian — wartości filtra są nadal
-- tekstami rozwiązywanymi po aliasach w bazie.
--
-- Nakładanie z innymi zmianami: `get_public_jobs`, `_count` i `saved_search_jobs_after` NIE są tu
-- redefiniowane (PR #999, `updated_at` w `get_public_jobs`, może przejść niezależnie i nadal
-- woła `location_filter_ids`). Facety redefiniuje tylko ta migracja.
--
-- Rollback: supabase/rollback/0183_city_sections_in_filters.down.sql (funkcje z 0153 i 0167).
-- =============================================================================

create index if not exists locations_parent_active_idx
  on public.locations (parent_location_id) where parent_location_id is not null and is_active;

-- --- 1. Wartości filtra → miejscowości + ich części --------------------------------------------
create or replace function public.location_filter_ids(p_values text[])
returns uuid[] language sql stable parallel safe security definer set search_path = public, pg_temp as $$
  with matched as (
    select distinct a.location_id
    from unnest(p_values[1:100]) v
    join public.location_aliases a on a.alias_key = public.city_key(left(v, 200))
    join public.locations l on l.id = a.location_id and l.is_active
  )
  select coalesce(array_agg(distinct x.location_id), '{}'::uuid[])
  from (
    select m.location_id from matched m
    union
    select s.id from matched m
    join public.locations s on s.parent_location_id = m.location_id and s.is_active
  ) x;
$$;
revoke all on function public.location_filter_ids(text[]) from public;
grant execute on function public.location_filter_ids(text[]) to anon, authenticated, service_role;

-- --- 2. Wyszukiwanie tekstowe miasta: + części gminy rozpoznanej z wpisu -----------------------
create or replace function public.search_city_candidates(p_city text)
returns setof uuid language sql stable strict
set search_path = public, pg_temp as $$
  select j.id from public.jobs j
  where j.status = 'active' and j.deleted_at is null
    and public.search_fold(j.city) like public.search_like_pattern(p_city) escape '\'
  union
  select j.id from public.jobs j
  where j.status = 'active' and j.deleted_at is null
    and j.location_id in (select unnest(public.location_filter_ids(array[left(p_city, 200)])));
$$;
revoke all on function public.search_city_candidates(text) from public;

-- --- 3. Facety (stan 0167) + pozycja „miasto” = gmina nadrzędna części ------------------------
create or replace function public.get_public_job_filter_facets(
  p_locale text default 'pl', p_keyword text default null, p_city text default null,
  p_categories text[] default null, p_locations text[] default null,
  p_contract_types text[] default null, p_salary_min integer default null,
  p_salary_max integer default null, p_accommodation boolean default null,
  p_immediate boolean default null, p_no_language boolean default null,
  p_since timestamptz default null, p_salary_unit text default 'month',
  p_direct_only boolean default null
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
      -- SRCH-01 (#1076): część gminy (dzielnica) liczy się w pozycji swojej gminy nadrzędnej —
      -- tak samo jak filtr `location_filter_ids` (gmina obejmuje swoje części).
      coalesce(pl.name, l.name, j.city) city_label, j.contract_type::text contract_type,
      j.accommodation, j.immediate, j.no_language_required, c.is_agency
    from public.jobs j
    join public.companies c on c.id=j.company_id
    left join public.locations l on l.id=j.location_id and l.is_active
    left join public.locations pl on pl.id=l.parent_location_id and pl.is_active
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
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency)
  union all
  select 'category',b.category,count(*) from base b cross join selected s where
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency) group by b.category
  union all
  select 'location',b.city_label,count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency) group by b.city_label
  union all
  select 'contract',b.contract_type,count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency) group by b.contract_type
  union all
  select 'accommodation',case when b.accommodation then 'provided' else 'unavailable' end,count(*)
    from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency)
    group by b.accommodation
  union all
  select 'additional','immediate',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and b.immediate and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency)
  union all
  select 'additional','no_language',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and b.no_language_required and
    (coalesce(p_direct_only,false)=false or not b.is_agency)
  union all
  select 'additional','direct',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and not b.is_agency;
$$;
revoke all on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean) from public;
grant execute on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean) to anon, authenticated;
