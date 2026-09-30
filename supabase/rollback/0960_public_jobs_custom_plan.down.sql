-- =============================================================================
-- Rollback 0960 — lista, licznik, facety ofert i kopia filtrów alertów bez pełnego skanu (#1215).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy usunąć
-- wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT
-- (supabase/tests/public-jobs-plan-rollback.sql wykonuje go w transakcji i cofa).
--
-- Przywraca definicje z 0194 (LANGUAGE sql, plan generyczny — pełny skan aktywnych ofert)
-- i usuwa indeksy sortowania po wynagrodzeniu. Sygnatury, typy wyników i granty bez zmian,
-- więc aplikacji nie trzeba wycofywać.
-- =============================================================================

drop index if exists public.idx_jobs_public_salary_month;
drop index if exists public.idx_jobs_public_salary_hour;

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
  p_salary_unit    text        default 'month',
  p_direct_only    boolean     default null,
  -- 0194: język, poziom, wymiar pracy, promień
  p_language       text        default null,
  p_language_level text        default null,
  p_work_time      text        default null,
  p_near           text        default null,
  p_radius_km      integer     default null
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
    -- 0194 (#787): widełki w EUR — oferta w innej walucie jest nieporównywalna (jak inny okres).
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
    -- 0167: „bezpośrednio od pracodawcy” = firma nie jest agencją pracy tymczasowej.
    and (coalesce(p_direct_only, false) = false or not c.is_agency)
    -- 0194 (#786): wymagany język ze słownika (kod ISO) — oferta wymaga tego języka na poziomie
    -- najwyżej wybranym (brak poziomu w ofercie = każdy poziom). Nieznany kod = brak wyników.
    and (coalesce(btrim(p_language), '') = ''
         or public.job_requires_language(j.id, btrim(p_language), p_language_level))
    -- 0194 (#811): wymiar czasu pracy deklarowany przez pracodawcę; `both` pasuje do obu.
    -- Oferta bez deklaracji nie pasuje (nie zgadujemy z opisu godzin).
    and (coalesce(p_work_time, '') = ''
         or (p_work_time in ('full_time', 'part_time') and j.work_time in (p_work_time, 'both')))
    -- 0194 (#824): promień od miejscowości ze słownika (współrzędne `locations`); oferta bez
    -- rozpoznanej miejscowości albo bez współrzędnych nie pasuje (odległość nieznana); oferta
    -- zdalna (`jobs.remote`) pasuje do każdego promienia (decyzja właściciela 29.09.2026).
    and (coalesce(btrim(p_near), '') = ''
         or j.remote is true
         or j.location_id in (select unnest(public.locations_within_radius(left(btrim(p_near), 100), p_radius_km))))
  order by
    (case when p_sort = 'salary' then public.job_salary_sort_key(
      j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_unit) end) desc nulls last,
    j.published_at desc,
    -- #594 (0136): tie-breaker deterministyczny (PK, unikalny).
    j.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;
revoke all on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean, text, text, text, text, integer
) from public;
grant execute on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean, text, text, text, text, integer
) to anon, authenticated;

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
  p_salary_unit    text      default 'month',
  p_direct_only    boolean   default null,
  -- 0194: język, poziom, wymiar pracy, promień
  p_language       text        default null,
  p_language_level text        default null,
  p_work_time      text        default null,
  p_near           text        default null,
  p_radius_km      integer     default null
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
    and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations)
         or j.location_id in (select unnest(public.location_filter_ids(p_locations))))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.id in (select public.search_city_candidates(left(p_city, 100))))
    and (p_keyword is null or j.id in (
      select public.search_title_candidates(left(p_keyword, 100))))
    and (p_keyword is null or public.search_fold(coalesce(t.title, j.title))
      like public.search_like_pattern(left(p_keyword, 100)) escape '\')
    -- 0194 (#787): widełki w EUR — oferta w innej walucie jest nieporównywalna (jak inny okres).
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
    and (coalesce(p_direct_only, false) = false or not c.is_agency)
    -- 0194 (#786): wymagany język ze słownika (kod ISO) — oferta wymaga tego języka na poziomie
    -- najwyżej wybranym (brak poziomu w ofercie = każdy poziom). Nieznany kod = brak wyników.
    and (coalesce(btrim(p_language), '') = ''
         or public.job_requires_language(j.id, btrim(p_language), p_language_level))
    -- 0194 (#811): wymiar czasu pracy deklarowany przez pracodawcę; `both` pasuje do obu.
    -- Oferta bez deklaracji nie pasuje (nie zgadujemy z opisu godzin).
    and (coalesce(p_work_time, '') = ''
         or (p_work_time in ('full_time', 'part_time') and j.work_time in (p_work_time, 'both')))
    -- 0194 (#824): promień od miejscowości ze słownika (współrzędne `locations`); oferta bez
    -- rozpoznanej miejscowości albo bez współrzędnych nie pasuje (odległość nieznana); oferta
    -- zdalna (`jobs.remote`) pasuje do każdego promienia (decyzja właściciela 29.09.2026).
    and (coalesce(btrim(p_near), '') = ''
         or j.remote is true
         or j.location_id in (select unnest(public.locations_within_radius(left(btrim(p_near), 100), p_radius_km))));
$$;
revoke all on function public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer
) from public;
grant execute on function public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer
) to anon, authenticated;

-- --- Facety (stan 0194)
create or replace function public.get_public_job_filter_facets(
  p_locale text default 'pl', p_keyword text default null, p_city text default null,
  p_categories text[] default null, p_locations text[] default null,
  p_contract_types text[] default null, p_salary_min integer default null,
  p_salary_max integer default null, p_accommodation boolean default null,
  p_immediate boolean default null, p_no_language boolean default null,
  p_since timestamptz default null, p_salary_unit text default 'month',
  p_direct_only boolean default null,
  -- 0194: język, poziom, wymiar pracy, promień (zawężają bazę wszystkich wymiarów)
  p_language text default null, p_language_level text default null,
  p_work_time text default null, p_near text default null,
  p_radius_km integer default null
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
      -- 0194 (#787): widełki w EUR — inna waluta nieporównywalna.
      and public.job_salary_in_range(
        j.salary_min,j.salary_max,j.salary_period,j.currency,p_salary_min,p_salary_max,p_salary_unit)
      -- 0194 (#786): wymagany język ze słownika (kod ISO) — oferta wymaga tego języka na poziomie
      -- najwyżej wybranym (brak poziomu w ofercie = każdy poziom). Nieznany kod = brak wyników.
      and (coalesce(btrim(p_language), '') = ''
           or public.job_requires_language(j.id, btrim(p_language), p_language_level))
      -- 0194 (#811): wymiar czasu pracy deklarowany przez pracodawcę; `both` pasuje do obu.
      -- Oferta bez deklaracji nie pasuje (nie zgadujemy z opisu godzin).
      and (coalesce(p_work_time, '') = ''
           or (p_work_time in ('full_time', 'part_time') and j.work_time in (p_work_time, 'both')))
      -- 0194 (#824): promień od miejscowości ze słownika (współrzędne `locations`); oferta bez
      -- rozpoznanej miejscowości albo bez współrzędnych nie pasuje (odległość nieznana); oferta
      -- zdalna (`jobs.remote`) pasuje do każdego promienia (decyzja właściciela 29.09.2026).
      and (coalesce(btrim(p_near), '') = ''
           or j.remote is true
           or j.location_id in (select unnest(public.locations_within_radius(left(btrim(p_near), 100), p_radius_km))))
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
revoke all on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean,text,text,text,text,integer) from public;
grant execute on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean,text,text,text,text,integer) to anon, authenticated;

-- --- Kopia filtrów dla alertów (test saved-search-keyset-sync: blok = get_public_jobs) -----
create or replace function public.saved_search_jobs_after(
  p_locale              text,
  p_keyword             text,
  p_city                text,
  p_categories          text[],
  p_locations           text[],
  p_contract_types      text[],
  p_salary_min          integer,
  p_salary_max          integer,
  p_accommodation       boolean,
  p_immediate           boolean,
  p_no_language         boolean,
  p_since               timestamptz,
  p_salary_unit         text,
  p_after_published_at  timestamptz,
  p_after_id            uuid,
  p_limit               integer,
  p_direct_only         boolean default null,
  p_language            text    default null,
  p_language_level      text    default null,
  p_work_time           text    default null,
  p_near                text    default null,
  p_radius_km           integer default null
)
returns table (id uuid, published_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select j.id, j.published_at
  -- BEGIN get_public_jobs filters (kopia 1:1 z najnowszej definicji get_public_jobs)
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
    and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations)
         or j.location_id in (select unnest(public.location_filter_ids(p_locations))))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.id in (select public.search_city_candidates(left(p_city, 100))))
    and (p_keyword is null or j.id in (
      select public.search_title_candidates(left(p_keyword, 100))))
    and (p_keyword is null or public.search_fold(coalesce(t.title, j.title))
      like public.search_like_pattern(left(p_keyword, 100)) escape '\')
    -- 0194 (#787): widełki w EUR — oferta w innej walucie jest nieporównywalna (jak inny okres).
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
    and (coalesce(p_direct_only, false) = false or not c.is_agency)
    -- 0194 (#786): wymagany język ze słownika (kod ISO) — oferta wymaga tego języka na poziomie
    -- najwyżej wybranym (brak poziomu w ofercie = każdy poziom). Nieznany kod = brak wyników.
    and (coalesce(btrim(p_language), '') = ''
         or public.job_requires_language(j.id, btrim(p_language), p_language_level))
    -- 0194 (#811): wymiar czasu pracy deklarowany przez pracodawcę; `both` pasuje do obu.
    -- Oferta bez deklaracji nie pasuje (nie zgadujemy z opisu godzin).
    and (coalesce(p_work_time, '') = ''
         or (p_work_time in ('full_time', 'part_time') and j.work_time in (p_work_time, 'both')))
    -- 0194 (#824): promień od miejscowości ze słownika (współrzędne `locations`); oferta bez
    -- rozpoznanej miejscowości albo bez współrzędnych nie pasuje (odległość nieznana); oferta
    -- zdalna (`jobs.remote`) pasuje do każdego promienia (decyzja właściciela 29.09.2026).
    and (coalesce(btrim(p_near), '') = ''
         or j.remote is true
         or j.location_id in (select unnest(public.locations_within_radius(left(btrim(p_near), 100), p_radius_km))))
  -- END get_public_jobs filters
    and j.published_at is not null
    and (p_after_published_at is null
         or (j.published_at, j.id) < (p_after_published_at, p_after_id))
  order by j.published_at desc, j.id desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;
revoke all on function public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean, text, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean, text, text, text, text, integer
) to service_role;
