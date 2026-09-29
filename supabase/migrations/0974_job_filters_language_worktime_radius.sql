-- =============================================================================
-- 0974_job_filters_language_worktime_radius.sql — filtry listy ofert: waluta wynagrodzenia,
-- wymagany język i poziom, wymiar czasu pracy, promień od miejscowości.
-- NUMER TYMCZASOWY — ostateczny nada integrator.
--
-- #787 — widełki i sortowanie po wynagrodzeniu porównywały same liczby, więc 3000 PLN
--   „mieściło się” w 2500–3500 EUR. Portal nie ma datowanego źródła kursów, więc kwot NIE
--   przeliczamy: filtr i sortowanie są w EUR, a oferta w innej walucie jest nieporównywalna —
--   dokładnie jak inny okres stawki (0080/0091): nie odpada z filtra kwoty (filtr jej nie
--   dotyczy, co opisuje notka pod suwakiem) i trafia na koniec sortowania „najwyższe
--   wynagrodzenie”. Nowe przeciążenia `job_salary_in_range(…, currency, …)` i
--   `job_salary_sort_key(…, currency, …)`; stare zostają (inni wołający). Lustro TS:
--   `src/lib/salary-compare.ts` (pole `currency`).
-- #786 — filtr wymaganego języka (`p_language` = kod z `public.languages`) i opcjonalnego
--   poziomu (`p_language_level`): oferta wymaga tego języka, a jej wymagany poziom jest NAJWYŻEJ
--   wybranym (poziom kandydata spełnia wymaganie); wymaganie bez poziomu pasuje do każdego.
--   Etykiety bez `language_id` (stare wpisy) rozwiązuje `language_id_for_label` (aliasy 0168).
--   „Bez wymogu języka” (`p_no_language`) zostaje osobnym filtrem.
-- #811 — `jobs.work_time` (`full_time` / `part_time` / `both`, null = brak deklaracji):
--   pole kreatora (krok 2, obok opisu godzin), zapis przez `save_job_draft` i
--   `update_published_job`, kopia szkicu przez trigger na `job_duplications`, odczyt
--   w `get_public_job`. Filtr `p_work_time` (`both` pasuje do obu). Starych ofert NIE
--   klasyfikujemy automatycznie (bez zgadywania z opisu godzin albo rodzaju umowy).
-- #824 — promień: `p_near` (miejscowość rozpoznana w `location_aliases`, jak filtr lokalizacji)
--   i `p_radius_km` (1–200, UI: 5/10/25/50/100). Odległość po współrzędnych `locations`
--   (część gminy bez współrzędnych = współrzędne gminy, 0151). Oferta bez rozpoznanej
--   miejscowości albo bez współrzędnych NIE pasuje (nieznana odległość nie jest faktem).
--   Oferta zdalna (`jobs.remote` = true, pole kreatora „Praca zdalna”) pasuje do KAŻDEGO
--   filtra promienia, bez względu na odległość i miejscowość środka (decyzja właściciela
--   29.09.2026 — dojazd nie dotyczy pracy zdalnej).
--   Nierozpoznana miejscowość promienia = same oferty zdalne (strona pokazuje komunikat).
--
-- Te same filtry w `get_public_jobs`, `get_public_jobs_count`, `get_public_job_filter_facets`
-- (baza wszystkich wymiarów) i kopii dla alertów `saved_search_jobs_after` (blok 1:1 —
-- test saved-search-keyset-sync). Zapisane wyszukiwania przechowują nowe klucze kanoniczne
-- `language`, `languageLevel`, `workTime`, `near`, `radiusKm` (`saved_search_canonical_filters`,
-- mapowanie w `saved_search_keyset_page`) — alert widzi ten sam zbiór ofert co lista.
-- Nowe parametry są OSTATNIE i mają wartości domyślne (wywołania nazwane i pozycyjne bez nich
-- działają jak dotąd); stare sygnatury są usuwane (inaczej wywołanie byłoby niejednoznaczne).
--
-- Nakładanie z PR #1186 (migracja 0183, części gmin w filtrach): facety są redefiniowane na
-- bazie definicji z 0183 (gmina nadrzędna części w wymiarze „miasto”); `location_filter_ids`
-- i `search_city_candidates` nie są tu zmieniane. Bez 0183 facety zachowują się jak po 0183
-- w wymiarze „miasto” (join `parent_location_id` istnieje od 0151).
--
-- Rollback: supabase/rollback/0974_job_filters_language_worktime_radius.down.sql.
-- =============================================================================

-- --- 1. Wymiar czasu pracy (#811) ---------------------------------------------------------------
alter table public.jobs
  add column if not exists work_time text,
  add constraint jobs_work_time_check check (work_time is null or work_time in ('full_time', 'part_time', 'both'));
comment on column public.jobs.work_time is
  '0974 (#811): wymiar czasu pracy deklarowany przez pracodawcę: full_time, part_time, both; null = brak danych.';
create index if not exists idx_jobs_work_time_active on public.jobs (work_time)
  where status = 'active' and deleted_at is null and work_time is not null;

-- --- 2. Wynagrodzenie tylko w EUR (#787) --------------------------------------------------------
create or replace function public.job_salary_in_range(
  p_job_min integer, p_job_max integer, p_period public.salary_period, p_currency text,
  p_filter_min integer, p_filter_max integer, p_unit text
) returns boolean language sql immutable parallel safe set search_path = public, pg_temp as $$
  select
    (p_filter_min is null and p_filter_max is null)
    -- Inna waluta niż EUR = nieporównywalna (bez przeliczania kursem): filtr kwoty jej nie dotyczy.
    or coalesce(p_currency, 'EUR') <> 'EUR'
    or public.job_salary_in_range(p_job_min, p_job_max, p_period, p_filter_min, p_filter_max, p_unit);
$$;
create or replace function public.job_salary_sort_key(
  p_job_min integer, p_job_max integer, p_period public.salary_period, p_currency text, p_unit text
) returns numeric language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case when coalesce(p_currency, 'EUR') = 'EUR'
    then public.job_salary_sort_key(p_job_min, p_job_max, p_period, p_unit) end;
$$;
revoke all on function public.job_salary_in_range(integer, integer, public.salary_period, text, integer, integer, text) from public;
revoke all on function public.job_salary_sort_key(integer, integer, public.salary_period, text, text) from public;
grant execute on function public.job_salary_in_range(integer, integer, public.salary_period, text, integer, integer, text)
  to anon, authenticated, service_role;
grant execute on function public.job_salary_sort_key(integer, integer, public.salary_period, text, text)
  to anon, authenticated, service_role;

-- --- 3. Wymagany język i poziom (#786) ----------------------------------------------------------
-- Poziomy rosną w kolejności enuma `language_level` (basic < intermediate < fluent < native).
-- Nieznany poziom (spoza enuma) pasuje tylko do wymagań bez poziomu.
create or replace function public.job_requires_language(p_job_id uuid, p_language text, p_level text)
returns boolean language sql stable parallel safe set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.job_languages jl
    join public.languages lg
      on lg.id = coalesce(jl.language_id, public.language_id_for_label(jl.language_label))
    where jl.job_id = p_job_id
      and lg.code = p_language
      and (p_level is null or jl.level is null
           or jl.level <= case when p_level in ('basic', 'intermediate', 'fluent', 'native')
                               then p_level::public.language_level end)
  );
$$;
revoke all on function public.job_requires_language(uuid, text, text) from public;
grant execute on function public.job_requires_language(uuid, text, text) to anon, authenticated, service_role;

-- --- 4. Promień od miejscowości (#824) ----------------------------------------------------------
-- Odległość po łuku koła wielkiego (haversine, promień Ziemi 6371 km) — bez rozszerzeń.
create or replace function public.geo_distance_km(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
) returns double precision language sql immutable strict parallel safe set search_path = public, pg_temp as $$
  select 2 * 6371.0 * asin(least(1.0, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2))));
$$;
revoke all on function public.geo_distance_km(double precision, double precision, double precision, double precision) from public;
grant execute on function public.geo_distance_km(double precision, double precision, double precision, double precision)
  to anon, authenticated, service_role;

-- Miejscowości (aktywne, ze współrzędnymi własnymi albo gminy nadrzędnej) w promieniu od
-- miejscowości wskazanej nazwą (alias PL/NL/FR/EN, `city_key` jak filtr lokalizacji 0153).
-- Nazwa nierozpoznana albo bez współrzędnych = pusta lista (brak wyników, nie brak filtra).
create or replace function public.locations_within_radius(p_near text, p_radius_km integer)
returns uuid[] language sql stable parallel safe security definer set search_path = public, pg_temp as $$
  with center as (
    select coalesce(l.latitude, pl.latitude)::double precision as lat,
           coalesce(l.longitude, pl.longitude)::double precision as lng
    from public.location_aliases a
    join public.locations l on l.id = a.location_id and l.is_active
    left join public.locations pl on pl.id = l.parent_location_id and pl.is_active
    where a.alias_key = public.city_key(left(btrim(coalesce(p_near, '')), 200))
    limit 1
  )
  select coalesce(array_agg(l.id), '{}'::uuid[])
  from center c
  join public.locations l on l.is_active
  left join public.locations pl on pl.id = l.parent_location_id and pl.is_active
  where c.lat is not null and c.lng is not null
    and coalesce(l.latitude, pl.latitude) is not null
    and coalesce(l.longitude, pl.longitude) is not null
    and public.geo_distance_km(c.lat, c.lng,
          coalesce(l.latitude, pl.latitude)::double precision,
          coalesce(l.longitude, pl.longitude)::double precision)
        <= least(greatest(coalesce(p_radius_km, 25), 1), 200);
$$;
revoke all on function public.locations_within_radius(text, integer) from public;
grant execute on function public.locations_within_radius(text, integer) to anon, authenticated, service_role;

-- --- 5. get_public_jobs (stan 0167) + nowe filtry ------------------------------------------------
drop function if exists public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean);
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
  -- 0974: język, poziom, wymiar pracy, promień
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
    -- 0974 (#787): widełki w EUR — oferta w innej walucie jest nieporównywalna (jak inny okres).
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
    -- 0167: „bezpośrednio od pracodawcy” = firma nie jest agencją pracy tymczasowej.
    and (coalesce(p_direct_only, false) = false or not c.is_agency)
    -- 0974 (#786): wymagany język ze słownika (kod ISO) — oferta wymaga tego języka na poziomie
    -- najwyżej wybranym (brak poziomu w ofercie = każdy poziom). Nieznany kod = brak wyników.
    and (coalesce(btrim(p_language), '') = ''
         or public.job_requires_language(j.id, btrim(p_language), p_language_level))
    -- 0974 (#811): wymiar czasu pracy deklarowany przez pracodawcę; `both` pasuje do obu.
    -- Oferta bez deklaracji nie pasuje (nie zgadujemy z opisu godzin).
    and (coalesce(p_work_time, '') = ''
         or (p_work_time in ('full_time', 'part_time') and j.work_time in (p_work_time, 'both')))
    -- 0974 (#824): promień od miejscowości ze słownika (współrzędne `locations`); oferta bez
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

drop function if exists public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean);
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
  -- 0974: język, poziom, wymiar pracy, promień
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
    -- 0974 (#787): widełki w EUR — oferta w innej walucie jest nieporównywalna (jak inny okres).
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
    and (coalesce(p_direct_only, false) = false or not c.is_agency)
    -- 0974 (#786): wymagany język ze słownika (kod ISO) — oferta wymaga tego języka na poziomie
    -- najwyżej wybranym (brak poziomu w ofercie = każdy poziom). Nieznany kod = brak wyników.
    and (coalesce(btrim(p_language), '') = ''
         or public.job_requires_language(j.id, btrim(p_language), p_language_level))
    -- 0974 (#811): wymiar czasu pracy deklarowany przez pracodawcę; `both` pasuje do obu.
    -- Oferta bez deklaracji nie pasuje (nie zgadujemy z opisu godzin).
    and (coalesce(p_work_time, '') = ''
         or (p_work_time in ('full_time', 'part_time') and j.work_time in (p_work_time, 'both')))
    -- 0974 (#824): promień od miejscowości ze słownika (współrzędne `locations`); oferta bez
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

-- --- 6. Facety (stan 0183 z PR #1186 — gmina nadrzędna części; bez niej stan 0167) + nowe filtry
drop function if exists public.get_public_job_filter_facets(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean);
create or replace function public.get_public_job_filter_facets(
  p_locale text default 'pl', p_keyword text default null, p_city text default null,
  p_categories text[] default null, p_locations text[] default null,
  p_contract_types text[] default null, p_salary_min integer default null,
  p_salary_max integer default null, p_accommodation boolean default null,
  p_immediate boolean default null, p_no_language boolean default null,
  p_since timestamptz default null, p_salary_unit text default 'month',
  p_direct_only boolean default null,
  -- 0974: język, poziom, wymiar pracy, promień (zawężają bazę wszystkich wymiarów)
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
      -- 0974 (#787): widełki w EUR — inna waluta nieporównywalna.
      and public.job_salary_in_range(
        j.salary_min,j.salary_max,j.salary_period,j.currency,p_salary_min,p_salary_max,p_salary_unit)
      -- 0974 (#786): wymagany język ze słownika (kod ISO) — oferta wymaga tego języka na poziomie
      -- najwyżej wybranym (brak poziomu w ofercie = każdy poziom). Nieznany kod = brak wyników.
      and (coalesce(btrim(p_language), '') = ''
           or public.job_requires_language(j.id, btrim(p_language), p_language_level))
      -- 0974 (#811): wymiar czasu pracy deklarowany przez pracodawcę; `both` pasuje do obu.
      -- Oferta bez deklaracji nie pasuje (nie zgadujemy z opisu godzin).
      and (coalesce(p_work_time, '') = ''
           or (p_work_time in ('full_time', 'part_time') and j.work_time in (p_work_time, 'both')))
      -- 0974 (#824): promień od miejscowości ze słownika (współrzędne `locations`); oferta bez
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

-- --- 7. Kopia filtrów dla alertów (test saved-search-keyset-sync: blok = get_public_jobs) -----
drop function if exists public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean);
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
    -- 0974 (#787): widełki w EUR — oferta w innej walucie jest nieporównywalna (jak inny okres).
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
    and (coalesce(p_direct_only, false) = false or not c.is_agency)
    -- 0974 (#786): wymagany język ze słownika (kod ISO) — oferta wymaga tego języka na poziomie
    -- najwyżej wybranym (brak poziomu w ofercie = każdy poziom). Nieznany kod = brak wyników.
    and (coalesce(btrim(p_language), '') = ''
         or public.job_requires_language(j.id, btrim(p_language), p_language_level))
    -- 0974 (#811): wymiar czasu pracy deklarowany przez pracodawcę; `both` pasuje do obu.
    -- Oferta bez deklaracji nie pasuje (nie zgadujemy z opisu godzin).
    and (coalesce(p_work_time, '') = ''
         or (p_work_time in ('full_time', 'part_time') and j.work_time in (p_work_time, 'both')))
    -- 0974 (#824): promień od miejscowości ze słownika (współrzędne `locations`); oferta bez
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

-- --- 8. Zapisane wyszukiwania: nowe klucze kanoniczne (stan 0092) i strona kursora (stan 0158) --
create or replace function public.saved_search_canonical_filters(p_filters jsonb, p_locale text)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_text text;
  v_arr text[];
  v_min integer;
  v_max integer;
begin
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then
    raise exception 'VALIDATION_FAILED: filtry muszą być obiektem' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_filters) k
    where k not in ('keyword', 'city', 'categories', 'locations', 'contractTypes',
                    'salaryMin', 'salaryMax', 'salaryUnit', 'accommodation', 'immediate',
                    'noLanguage', 'language', 'languageLevel', 'workTime', 'near', 'radiusKm')
  ) then
    raise exception 'VALIDATION_FAILED: nieznany filtr' using errcode = '22023';
  end if;

  foreach v_text in array array['keyword', 'city'] loop
    if p_filters ? v_text and jsonb_typeof(p_filters -> v_text) <> 'null' then
      if jsonb_typeof(p_filters -> v_text) <> 'string'
         or char_length(btrim(p_filters ->> v_text)) > 100 then
        raise exception 'VALIDATION_FAILED: nieprawidłowy filtr tekstowy' using errcode = '22023';
      end if;
      if btrim(p_filters ->> v_text) <> '' then
        v_out := v_out || jsonb_build_object(v_text, lower(btrim(p_filters ->> v_text)));
      end if;
    end if;
  end loop;

  v_arr := public.saved_search_text_array(p_filters -> 'categories', 50);
  if v_arr is not null then
    if not v_arr <@ enum_range(null::public.job_category)::text[] then
      raise exception 'VALIDATION_FAILED: nieznana kategoria' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('categories', to_jsonb(v_arr));
  end if;

  v_arr := public.saved_search_text_array(p_filters -> 'contractTypes', 50);
  if v_arr is not null then
    if not v_arr <@ enum_range(null::public.contract_type)::text[] then
      raise exception 'VALIDATION_FAILED: nieznany rodzaj umowy' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('contractTypes', to_jsonb(v_arr));
  end if;

  v_arr := public.saved_search_text_array(p_filters -> 'locations', 100);
  if v_arr is not null then
    v_out := v_out || jsonb_build_object('locations', to_jsonb(v_arr));
  end if;

  foreach v_text in array array['salaryMin', 'salaryMax'] loop
    if p_filters ? v_text and jsonb_typeof(p_filters -> v_text) <> 'null' then
      if jsonb_typeof(p_filters -> v_text) <> 'number'
         or (p_filters ->> v_text)::numeric <> trunc((p_filters ->> v_text)::numeric)
         or (p_filters ->> v_text)::numeric not between 0 and 1000000 then
        raise exception 'VALIDATION_FAILED: nieprawidłowe wynagrodzenie' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(v_text, (p_filters ->> v_text)::integer);
    end if;
  end loop;
  v_min := (v_out ->> 'salaryMin')::integer;
  v_max := (v_out ->> 'salaryMax')::integer;
  if v_min is not null and v_max is not null and v_min > v_max then
    raise exception 'VALIDATION_FAILED: minimum powyżej maksimum' using errcode = '22023';
  end if;

  -- Jednostka widełek (0091): 'month' (domyślna) albo 'hour'. Zapisujemy tylko 'hour'
  -- i tylko przy widełkach — bez kwot jednostka nie zawęża wyników.
  if p_filters ? 'salaryUnit' and jsonb_typeof(p_filters -> 'salaryUnit') <> 'null' then
    if jsonb_typeof(p_filters -> 'salaryUnit') <> 'string'
       or p_filters ->> 'salaryUnit' not in ('month', 'hour') then
      raise exception 'VALIDATION_FAILED: nieprawidłowa jednostka wynagrodzenia' using errcode = '22023';
    end if;
    if p_filters ->> 'salaryUnit' = 'hour' and (v_min is not null or v_max is not null) then
      v_out := v_out || jsonb_build_object('salaryUnit', 'hour');
    end if;
  end if;

  if p_filters ? 'accommodation' and jsonb_typeof(p_filters -> 'accommodation') <> 'null' then
    if jsonb_typeof(p_filters -> 'accommodation') <> 'boolean' then
      raise exception 'VALIDATION_FAILED: nieprawidłowy filtr zakwaterowania' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('accommodation', (p_filters ->> 'accommodation')::boolean);
  end if;

  foreach v_text in array array['immediate', 'noLanguage'] loop
    if p_filters ? v_text and jsonb_typeof(p_filters -> v_text) <> 'null' then
      if jsonb_typeof(p_filters -> v_text) <> 'boolean' then
        raise exception 'VALIDATION_FAILED: nieprawidłowy filtr' using errcode = '22023';
      end if;
      if (p_filters ->> v_text)::boolean then
        v_out := v_out || jsonb_build_object(v_text, true);
      end if;
    end if;
  end loop;

  -- 0974 (#786): język (kod słownika) i opcjonalny poziom (tylko razem z językiem).
  if p_filters ? 'language' and jsonb_typeof(p_filters -> 'language') <> 'null' then
    if jsonb_typeof(p_filters -> 'language') <> 'string'
       or not exists (select 1 from public.languages l
                      where l.is_active and l.code = p_filters ->> 'language') then
      raise exception 'VALIDATION_FAILED: nieznany język' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('language', p_filters ->> 'language');
  end if;
  if p_filters ? 'languageLevel' and jsonb_typeof(p_filters -> 'languageLevel') <> 'null' then
    if jsonb_typeof(p_filters -> 'languageLevel') <> 'string'
       or p_filters ->> 'languageLevel' not in ('basic', 'intermediate', 'fluent', 'native')
       or not v_out ? 'language' then
      raise exception 'VALIDATION_FAILED: nieprawidłowy poziom języka' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('languageLevel', p_filters ->> 'languageLevel');
  end if;

  -- 0974 (#811): wymiar czasu pracy.
  if p_filters ? 'workTime' and jsonb_typeof(p_filters -> 'workTime') <> 'null' then
    if jsonb_typeof(p_filters -> 'workTime') <> 'string'
       or p_filters ->> 'workTime' not in ('full_time', 'part_time') then
      raise exception 'VALIDATION_FAILED: nieprawidłowy wymiar pracy' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('workTime', p_filters ->> 'workTime');
  end if;

  -- 0974 (#824): promień od miejscowości — miejscowość (≤ 100 znaków) i promień z listy.
  if p_filters ? 'near' and jsonb_typeof(p_filters -> 'near') <> 'null' then
    if jsonb_typeof(p_filters -> 'near') <> 'string'
       or char_length(btrim(p_filters ->> 'near')) > 100 then
      raise exception 'VALIDATION_FAILED: nieprawidłowa miejscowość promienia' using errcode = '22023';
    end if;
    if btrim(p_filters ->> 'near') <> '' then
      v_out := v_out || jsonb_build_object('near', lower(btrim(p_filters ->> 'near')));
    end if;
  end if;
  if p_filters ? 'radiusKm' and jsonb_typeof(p_filters -> 'radiusKm') <> 'null' then
    if jsonb_typeof(p_filters -> 'radiusKm') <> 'number'
       or (p_filters ->> 'radiusKm') not in ('5', '10', '25', '50', '100') then
      raise exception 'VALIDATION_FAILED: nieprawidłowy promień' using errcode = '22023';
    end if;
    if v_out ? 'near' then
      v_out := v_out || jsonb_build_object('radiusKm', (p_filters ->> 'radiusKm')::integer);
    end if;
  end if;
  if v_out ? 'near' and not v_out ? 'radiusKm' then
    v_out := v_out || jsonb_build_object('radiusKm', 25);
  end if;

  if v_out = '{}'::jsonb then
    raise exception 'VALIDATION_FAILED: wymagany co najmniej jeden filtr' using errcode = '22023';
  end if;

  if v_out ? 'keyword' then
    if not coalesce(public.is_supported_locale(p_locale), false) then
      raise exception 'VALIDATION_FAILED: nieobsługiwany język' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('locale', p_locale);
  end if;

  return v_out;
end $$;
revoke all on function public.saved_search_canonical_filters(jsonb, text) from public, anon, authenticated;

create or replace function public.saved_search_keyset_page(
  p_filters             jsonb,
  p_locale              text,
  p_since               timestamptz,
  p_after_published_at  timestamptz,
  p_after_id            uuid,
  p_page_size           integer default 1000
) returns table (ids uuid[], last_published_at timestamptz, last_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    coalesce(array_agg(k.id order by k.published_at desc, k.id desc), '{}'::uuid[]),
    (array_agg(k.published_at order by k.published_at asc, k.id asc))[1],
    (array_agg(k.id order by k.published_at asc, k.id asc))[1]
  from public.saved_search_jobs_after(
    p_locale             => p_locale,
    p_keyword            => p_filters ->> 'keyword',
    p_city               => p_filters ->> 'city',
    p_categories         => (select array_agg(x) from jsonb_array_elements_text(p_filters -> 'categories') x),
    p_locations          => (select array_agg(x) from jsonb_array_elements_text(p_filters -> 'locations') x),
    p_contract_types     => (select array_agg(x) from jsonb_array_elements_text(p_filters -> 'contractTypes') x),
    p_salary_min         => (p_filters ->> 'salaryMin')::integer,
    p_salary_max         => (p_filters ->> 'salaryMax')::integer,
    p_accommodation      => (p_filters ->> 'accommodation')::boolean,
    p_immediate          => (p_filters ->> 'immediate')::boolean,
    p_no_language        => (p_filters ->> 'noLanguage')::boolean,
    p_since              => p_since,
    p_salary_unit        => coalesce(p_filters ->> 'salaryUnit', 'month'),
    p_after_published_at => p_after_published_at,
    p_after_id           => p_after_id,
    p_limit              => least(greatest(coalesce(p_page_size, 1000), 1), 1000),
    -- 0974: język, poziom, wymiar pracy, promień (klucze kanoniczne → parametry listy)
    p_language           => p_filters ->> 'language',
    p_language_level     => p_filters ->> 'languageLevel',
    p_work_time          => p_filters ->> 'workTime',
    p_near               => p_filters ->> 'near',
    p_radius_km          => (p_filters ->> 'radiusKm')::integer
  ) k;
$$;
revoke all on function public.saved_search_keyset_page(jsonb, text, timestamptz, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.saved_search_keyset_page(jsonb, text, timestamptz, timestamptz, uuid, integer)
  to service_role;

-- --- 9. Kreator: save_job_draft (stan 0184 — token wersji szkicu) + work_time ----------------------
create or replace function public.save_job_draft(
  p_job_id uuid, p_content jsonb, p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_status text; v_locale text; v_title text;
  v_updated timestamptz; v_new timestamptz;
  j jsonb := coalesce(p_content->'job', '{}'::jsonb);
  tr jsonb := coalesce(p_content->'translation', '{}'::jsonb);
  v_bad text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or jsonb_typeof(j) <> 'object' or jsonb_typeof(tr) <> 'object' then
    raise exception 'VALIDATION_FAILED: brak treści kroku' using errcode = '42501';
  end if;

  select k into v_bad from jsonb_object_keys(j) k
    where k not in ('title', 'category', 'occupation', 'contract_type', 'working_hours', 'shifts',
                    'start_immediately', 'start_date', 'city', 'region', 'address', 'remote',
                    'salary_min', 'salary_max', 'currency', 'salary_period',
                    'min_experience_years', 'requires_driving_license', 'no_language_required',
                    'accommodation', 'transport', 'contact_email',
                    -- 0169: koszty i dodatki
                    'accommodation_kind', 'accommodation_cost', 'accommodation_cost_period',
                    'accommodation_deducted', 'accommodation_registration',
                    'accommodation_after_contract', 'transport_shuttle', 'transport_reimbursed',
                    'meal_voucher_daily', 'joint_committee',
                    -- 0172: kanał aplikowania u ogłoszeniodawcy
                    'apply_url', 'apply_email', 'apply_phone',
                    -- 0974, #811: wymiar czasu pracy
                    'work_time')
    limit 1;
  if v_bad is null then
    select k into v_bad from jsonb_object_keys(tr) k
      where k not in ('description', 'responsibilities', 'conditions', 'benefits',
                      'company_description')
      limit 1;
  end if;
  if v_bad is not null then
    raise exception 'VALIDATION_FAILED: nieznane pole %', v_bad using errcode = '42501';
  end if;

  select j0.company_id, j0.status::text, j0.default_locale, j0.updated_at
    into v_company, v_status, v_locale, v_updated
    from public.jobs j0
    where j0.id = p_job_id and j0.deleted_at is null
    for update;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: edycja oferty wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'JOB_NOT_DRAFT: kreator zapisuje wyłącznie szkic' using errcode = '42501';
  end if;
  -- #1070: token wersji szkicu. Wiersz jest już zablokowany (FOR UPDATE), więc równoległy zapis
  -- czeka i po odblokowaniu widzi nową wersję → konflikt zamiast cichego nadpisania. Brak tokenu
  -- (świeży szkic tej karty, import) = bez kontroli, jak `update_published_job`.
  if p_expected_updated_at is not null and p_expected_updated_at <> v_updated then
    raise exception 'JOB_EDIT_CONFLICT: szkic zmienił się w międzyczasie' using errcode = '40001';
  end if;

  if j <> '{}'::jsonb then
    update public.jobs set
      title                    = case when j ? 'title' then btrim(coalesce(j->>'title', '')) else title end,
      category                 = case when j ? 'category' then (j->>'category')::public.job_category else category end,
      occupation               = case when j ? 'occupation' then nullif(btrim(coalesce(j->>'occupation', '')), '') else occupation end,
      contract_type            = case when j ? 'contract_type' then (j->>'contract_type')::public.contract_type else contract_type end,
      working_hours            = case when j ? 'working_hours' then nullif(btrim(coalesce(j->>'working_hours', '')), '') else working_hours end,
      shifts                   = case when j ? 'shifts' then nullif(btrim(coalesce(j->>'shifts', '')), '') else shifts end,
      start_immediately        = case when j ? 'start_immediately' then coalesce((j->>'start_immediately')::boolean, false) else start_immediately end,
      immediate                = case when j ? 'start_immediately' then coalesce((j->>'start_immediately')::boolean, false) else immediate end,
      start_date               = case when j ? 'start_date' then nullif(j->>'start_date', '')::date else start_date end,
      city                     = case when j ? 'city' then btrim(coalesce(j->>'city', '')) else city end,
      region                   = case when j ? 'region' then btrim(coalesce(j->>'region', '')) else region end,
      address                  = case when j ? 'address' then nullif(btrim(coalesce(j->>'address', '')), '') else address end,
      remote                   = case when j ? 'remote' then coalesce((j->>'remote')::boolean, false) else remote end,
      salary_min               = case when j ? 'salary_min' then (j->>'salary_min')::integer else salary_min end,
      salary_max               = case when j ? 'salary_max' then (j->>'salary_max')::integer else salary_max end,
      currency                 = case when j ? 'currency' then coalesce(nullif(j->>'currency', ''), 'EUR') else currency end,
      salary_period            = case when j ? 'salary_period' then coalesce(nullif(j->>'salary_period', ''), 'month')::public.salary_period else salary_period end,
      min_experience_years     = case when j ? 'min_experience_years' then (j->>'min_experience_years')::integer else min_experience_years end,
      requires_driving_license = case when j ? 'requires_driving_license' then coalesce((j->>'requires_driving_license')::boolean, false) else requires_driving_license end,
      no_language_required     = case when j ? 'no_language_required' then coalesce((j->>'no_language_required')::boolean, false) else no_language_required end,
      accommodation            = case when j ? 'accommodation' then coalesce((j->>'accommodation')::boolean, false) else accommodation end,
      transport                = case when j ? 'transport' then coalesce((j->>'transport')::boolean, false) else transport end,
      contact_email            = case when j ? 'contact_email' then nullif(btrim(coalesce(j->>'contact_email', '')), '') else contact_email end,
      accommodation_kind       = case when j ? 'accommodation_kind' then nullif(j->>'accommodation_kind', '') else accommodation_kind end,
      accommodation_cost       = case when j ? 'accommodation_cost' then (j->>'accommodation_cost')::numeric else accommodation_cost end,
      accommodation_cost_period = case when j ? 'accommodation_cost_period' then nullif(j->>'accommodation_cost_period', '') else accommodation_cost_period end,
      accommodation_deducted   = case when j ? 'accommodation_deducted' then (j->>'accommodation_deducted')::boolean else accommodation_deducted end,
      accommodation_registration = case when j ? 'accommodation_registration' then (j->>'accommodation_registration')::boolean else accommodation_registration end,
      accommodation_after_contract = case when j ? 'accommodation_after_contract' then nullif(j->>'accommodation_after_contract', '') else accommodation_after_contract end,
      transport_shuttle        = case when j ? 'transport_shuttle' then coalesce((j->>'transport_shuttle')::boolean, false) else transport_shuttle end,
      transport_reimbursed     = case when j ? 'transport_reimbursed' then coalesce((j->>'transport_reimbursed')::boolean, false) else transport_reimbursed end,
      meal_voucher_daily       = case when j ? 'meal_voucher_daily' then (j->>'meal_voucher_daily')::numeric else meal_voucher_daily end,
      joint_committee          = case when j ? 'joint_committee' then nullif(j->>'joint_committee', '') else joint_committee end,
      apply_url                = case when j ? 'apply_url' then nullif(btrim(coalesce(j->>'apply_url', '')), '') else apply_url end,
      apply_email              = case when j ? 'apply_email' then nullif(btrim(coalesce(j->>'apply_email', '')), '') else apply_email end,
      apply_phone              = case when j ? 'apply_phone' then nullif(btrim(coalesce(j->>'apply_phone', '')), '') else apply_phone end,
      work_time                = case when j ? 'work_time' then nullif(j->>'work_time', '') else work_time end
    where id = p_job_id;
  end if;

  -- Tłumaczenie w języku oferty; tytuł zawsze z `jobs.title` (kolumna NOT NULL).
  if p_content ? 'translation' or j ? 'title' or j ? 'working_hours' or j ? 'shifts' then
    select title into v_title from public.jobs where id = p_job_id;
    insert into public.job_translations (job_id, locale, title, working_hours, shifts, description,
                                         responsibilities, conditions, benefits, highlights,
                                         company_description)
    values (
      p_job_id, v_locale, coalesce(v_title, ''),
      nullif(btrim(coalesce(j->>'working_hours', '')), ''),
      nullif(btrim(coalesce(j->>'shifts', '')), ''),
      tr->>'description',
      array(select jsonb_array_elements_text(coalesce(tr->'responsibilities', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(tr->'conditions', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(tr->'benefits', '[]'::jsonb))),
      array(select x from jsonb_array_elements_text(coalesce(tr->'benefits', '[]'::jsonb)) x limit 4),
      tr->>'company_description'
    )
    on conflict (job_id, locale) do update set
      title               = excluded.title,
      working_hours       = case when j ? 'working_hours' then excluded.working_hours else job_translations.working_hours end,
      shifts              = case when j ? 'shifts' then excluded.shifts else job_translations.shifts end,
      description         = case when tr ? 'description' then excluded.description else job_translations.description end,
      responsibilities    = case when tr ? 'responsibilities' then excluded.responsibilities else job_translations.responsibilities end,
      conditions          = case when tr ? 'conditions' then excluded.conditions else job_translations.conditions end,
      benefits            = case when tr ? 'benefits' then excluded.benefits else job_translations.benefits end,
      highlights          = case when tr ? 'benefits' then excluded.highlights else job_translations.highlights end,
      company_description = case when tr ? 'company_description' then excluded.company_description else job_translations.company_description end;
  end if;

  -- Relacje replace-all tymi samymi funkcjami co dotąd (walidacja i limity bez zmian).
  if p_content ? 'requirements_mandatory' then
    perform public.set_job_requirements(p_job_id, v_locale, 'mandatory',
      array(select jsonb_array_elements_text(coalesce(p_content->'requirements_mandatory', '[]'::jsonb))));
  end if;
  if p_content ? 'requirements_optional' then
    perform public.set_job_requirements(p_job_id, v_locale, 'optional',
      array(select jsonb_array_elements_text(coalesce(p_content->'requirements_optional', '[]'::jsonb))));
  end if;
  -- Najpierw zakres dodatkowy, potem obowiązkowy: etykieta w obu listach kończy jako obowiązkowa.
  if p_content ? 'skills_optional' then
    perform public.set_job_skills(p_job_id, false,
      array(select jsonb_array_elements_text(coalesce(p_content->'skills_optional', '[]'::jsonb))));
  end if;
  if p_content ? 'skills_mandatory' then
    perform public.set_job_skills(p_job_id, true,
      array(select jsonb_array_elements_text(coalesce(p_content->'skills_mandatory', '[]'::jsonb))));
  end if;
  if p_content ? 'languages' then
    perform public.set_job_languages(p_job_id, coalesce(p_content->'languages', '[]'::jsonb));
  end if;
  if p_content ? 'certificates' then
    perform public.set_job_certificates(p_job_id,
      array(select jsonb_array_elements_text(coalesce(p_content->'certificates', '[]'::jsonb))));
  end if;
  -- #101: pytania screeningowe w tej samej transakcji co reszta kroku.
  if p_content ? 'screening_questions' then
    perform public.set_job_screening_questions(p_job_id, p_content->'screening_questions');
  end if;

  -- #1070: nowa wersja szkicu. Każdy zapis kroku ją podbija — także krok, który zmienia tylko
  -- relacje albo tłumaczenie (nie dotyka wiersza `jobs`); `strict_job_version` (0077) gwarantuje
  -- ścisły wzrost nawet w jednej transakcji.
  select updated_at into v_new from public.jobs where id = p_job_id;
  if v_new is not distinct from v_updated then
    update public.jobs set updated_at = now() where id = p_job_id
      returning updated_at into v_new;
  end if;
  return jsonb_build_object('updated_at', v_new);
end $$;
revoke all on function public.save_job_draft(uuid, jsonb, timestamptz) from public;
grant execute on function public.save_job_draft(uuid, jsonb, timestamptz) to authenticated;

-- --- 10. update_published_job (stan 0172) + work_time -------------------------------------------
create or replace function public.update_published_job(
  p_job_id uuid, p_content jsonb, p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_cstatus text; v_status text; v_slug text; v_locale text;
  v_updated timestamptz; v_before jsonb; v_after jsonb;
  j jsonb := coalesce(p_content->'job', '{}'::jsonb);
  tr jsonb := coalesce(p_content->'translation', '{}'::jsonb);
  v_title text;
  v_has_translation boolean; v_has_mandatory boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'VALIDATION_FAILED: brak treści oferty' using errcode = '42501';
  end if;

  select j0.company_id, c.status::text, j0.status::text, j0.slug, j0.default_locale, j0.updated_at,
         jsonb_build_object('title', j0.title, 'city', j0.city, 'region', j0.region,
                            'salary_min', j0.salary_min, 'salary_max', j0.salary_max,
                            'start_date', j0.start_date, 'contract_type', j0.contract_type)
    into v_company, v_cstatus, v_status, v_slug, v_locale, v_updated, v_before
    from public.jobs j0 join public.companies c on c.id = j0.company_id
    where j0.id = p_job_id and j0.deleted_at is null
    for update of j0;

  if v_company is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.can_manage_jobs(v_company) then
    raise exception 'PERMISSION_DENIED: edycja oferty wymaga roli recruiter+' using errcode = '42501';
  end if;
  if v_status not in ('active', 'paused') then
    raise exception 'JOB_NOT_EDITABLE: edytować można ofertę aktywną lub wstrzymaną (stan %)', v_status
      using errcode = '42501';
  end if;
  if v_cstatus <> 'verified' then
    raise exception 'COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana' using errcode = '42501';
  end if;
  if p_expected_updated_at is not null and p_expected_updated_at <> v_updated then
    raise exception 'JOB_EDIT_CONFLICT: oferta zmieniła się w międzyczasie' using errcode = '40001';
  end if;

  v_title := btrim(coalesce(j->>'title', ''));

  -- 0144: znacznik tej rewizji — trigger powiadomień reaguje tylko na zapis z tego RPC.
  perform set_config('pracujbe.job_terms_notify', p_job_id::text, true);
  update public.jobs set
    title                    = v_title,
    category                 = (j->>'category')::public.job_category,
    occupation               = nullif(btrim(coalesce(j->>'occupation', '')), ''),
    contract_type            = (j->>'contract_type')::public.contract_type,
    working_hours            = nullif(btrim(coalesce(j->>'working_hours', '')), ''),
    shifts                   = nullif(btrim(coalesce(j->>'shifts', '')), ''),
    start_immediately        = coalesce((j->>'start_immediately')::boolean, false),
    immediate                = coalesce((j->>'start_immediately')::boolean, false),
    start_date               = nullif(j->>'start_date', '')::date,
    city                     = btrim(coalesce(j->>'city', '')),
    region                   = btrim(coalesce(j->>'region', '')),
    address                  = nullif(btrim(coalesce(j->>'address', '')), ''),
    remote                   = coalesce((j->>'remote')::boolean, false),
    salary_min               = (j->>'salary_min')::integer,
    salary_max               = (j->>'salary_max')::integer,
    currency                 = coalesce(nullif(j->>'currency', ''), 'EUR'),
    salary_period            = coalesce(nullif(j->>'salary_period', ''), 'month')::public.salary_period,
    min_experience_years     = (j->>'min_experience_years')::integer,
    requires_driving_license = coalesce((j->>'requires_driving_license')::boolean, false),
    no_language_required     = coalesce((j->>'no_language_required')::boolean, false),
    accommodation            = coalesce((j->>'accommodation')::boolean, false),
    transport                = coalesce((j->>'transport')::boolean, false),
    contact_email            = nullif(btrim(coalesce(j->>'contact_email', '')), ''),
    -- 0169: koszty i dodatki (brak klucza = brak wartości, jak pozostałe pola rewizji).
    accommodation_kind       = nullif(j->>'accommodation_kind', ''),
    accommodation_cost       = (j->>'accommodation_cost')::numeric,
    accommodation_cost_period = nullif(j->>'accommodation_cost_period', ''),
    accommodation_deducted   = (j->>'accommodation_deducted')::boolean,
    accommodation_registration = (j->>'accommodation_registration')::boolean,
    accommodation_after_contract = nullif(j->>'accommodation_after_contract', ''),
    transport_shuttle        = coalesce((j->>'transport_shuttle')::boolean, false),
    transport_reimbursed     = coalesce((j->>'transport_reimbursed')::boolean, false),
    meal_voucher_daily       = (j->>'meal_voucher_daily')::numeric,
    joint_committee          = nullif(j->>'joint_committee', ''),
    -- 0172: kanał aplikowania (brak klucza = brak wartości; co najmniej jeden wymagany niżej).
    apply_url                = nullif(btrim(coalesce(j->>'apply_url', '')), ''),
    apply_email              = nullif(btrim(coalesce(j->>'apply_email', '')), ''),
    apply_phone              = nullif(btrim(coalesce(j->>'apply_phone', '')), ''),
    -- 0974 (#811): wymiar czasu pracy (brak klucza = brak deklaracji).
    work_time                = nullif(j->>'work_time', ''),
    updated_at               = now()
  where id = p_job_id;
  perform set_config('pracujbe.job_terms_notify', '', true);

  -- 0172: oferta opublikowana nie może stracić kanału aplikowania (błąd cofa całą rewizję).
  if not exists (select 1 from public.jobs where id = p_job_id and public.job_has_apply_channel(jobs)) then
    raise exception 'JOB_APPLY_CHANNEL_REQUIRED: oferta wymaga adresu strony, e-maila albo telefonu do aplikowania'
      using errcode = '23514';
  end if;

  insert into public.job_translations (job_id, locale, title, working_hours, shifts, description,
                                       responsibilities, conditions, benefits, highlights,
                                       company_description)
  values (
    p_job_id, v_locale, v_title,
    nullif(btrim(coalesce(j->>'working_hours', '')), ''),
    nullif(btrim(coalesce(j->>'shifts', '')), ''),
    coalesce(tr->>'description', ''),
    array(select jsonb_array_elements_text(coalesce(tr->'responsibilities', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(tr->'conditions', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(tr->'benefits', '[]'::jsonb))),
    array(select x from jsonb_array_elements_text(coalesce(tr->'benefits', '[]'::jsonb)) x limit 4),
    coalesce(tr->>'company_description', '')
  )
  on conflict (job_id, locale) do update set
    title = excluded.title, working_hours = excluded.working_hours, shifts = excluded.shifts,
    description = excluded.description, responsibilities = excluded.responsibilities,
    conditions = excluded.conditions, benefits = excluded.benefits,
    highlights = excluded.highlights, company_description = excluded.company_description;

  -- Relacje replace-all tymi samymi funkcjami co kreator; znacznik dopuszcza ofertę nie-szkic.
  perform set_config('pracujbe.job_edit', p_job_id::text, true);
  perform public.set_job_requirements(p_job_id, v_locale, 'mandatory',
    array(select jsonb_array_elements_text(coalesce(p_content->'requirements_mandatory', '[]'::jsonb))));
  perform public.set_job_requirements(p_job_id, v_locale, 'optional',
    array(select jsonb_array_elements_text(coalesce(p_content->'requirements_optional', '[]'::jsonb))));
  -- Najpierw zakres dodatkowy, potem obowiązkowy: etykieta w obu listach kończy jako obowiązkowa.
  perform public.set_job_skills(p_job_id, false,
    array(select jsonb_array_elements_text(coalesce(p_content->'skills_optional', '[]'::jsonb))));
  perform public.set_job_skills(p_job_id, true,
    array(select jsonb_array_elements_text(coalesce(p_content->'skills_mandatory', '[]'::jsonb))));
  perform public.set_job_languages(p_job_id, coalesce(p_content->'languages', '[]'::jsonb));
  perform public.set_job_certificates(p_job_id,
    array(select jsonb_array_elements_text(coalesce(p_content->'certificates', '[]'::jsonb))));
  perform set_config('pracujbe.job_edit', '', true);

  -- Kompletność jak w publish_job (0073) — po zapisie, więc błąd cofa całą rewizję.
  if v_title = '' or v_title ilike 'draft%' or v_title ilike '%placeholder%'
     or btrim(coalesce(j->>'city', '')) = '' or btrim(coalesce(j->>'region', '')) = '' then
    raise exception 'VALIDATION_FAILED: oferta niekompletna (tytuł/miasto/region)' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.job_translations t
    where t.job_id = p_job_id
      and coalesce(btrim(t.title), '') <> ''
      and coalesce(btrim(t.description), '') <> ''
      and coalesce(array_length(t.responsibilities, 1), 0) > 0
  ) into v_has_translation;
  if not v_has_translation then
    raise exception 'VALIDATION_FAILED: oferta niekompletna (opis i obowiązki w tłumaczeniu)'
      using errcode = '42501';
  end if;
  select exists (
    select 1 from public.job_requirements r
    where r.job_id = p_job_id and r.kind = 'mandatory' and coalesce(btrim(r.content), '') <> ''
  ) into v_has_mandatory;
  if not v_has_mandatory then
    raise exception 'VALIDATION_FAILED: brak wymagań obowiązkowych' using errcode = '42501';
  end if;

  select jsonb_build_object('title', title, 'city', city, 'region', region,
                            'salary_min', salary_min, 'salary_max', salary_max,
                            'start_date', start_date, 'contract_type', contract_type),
         updated_at
    into v_after, v_updated from public.jobs where id = p_job_id;
  perform public.write_audit('job.update_published', 'job', p_job_id, v_before, v_after);

  return jsonb_build_object('slug', v_slug, 'updated_at', v_updated);
end $$;
revoke all on function public.update_published_job(uuid, jsonb, timestamptz) from public;
grant execute on function public.update_published_job(uuid, jsonb, timestamptz) to authenticated;

-- --- 11. get_public_job (stan 0172) + work_time --------------------------------------------------
drop function if exists public.get_public_job(text, text);

create or replace function public.get_public_job(p_slug text, p_locale text default 'pl')
returns table (
  id uuid, slug text, title text, company_name text, company_verified boolean,
  city text, region text, contract_type text, salary_min integer, salary_max integer,
  currency text, published_at timestamptz, highlights text[], category text,
  accommodation boolean, immediate boolean, no_language_required boolean,
  description text, responsibilities text[], requirements_mandatory text[],
  requirements_optional text[], conditions text[], working_hours text, shifts text,
  languages text[], transport boolean, start_date date, company_description text,
  salary_period text, expires_at timestamptz,
  company_website text, company_logo_url text, company_slug text,
  apply_url text, apply_email text, apply_phone text,
  work_time text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.id, j.slug,
    coalesce(t.title, j.title) as title,
    c.name as company_name,
    (c.status = 'verified') as company_verified,
    j.city, j.region, j.contract_type::text,
    j.salary_min, j.salary_max, coalesce(j.currency, 'EUR') as currency,
    j.published_at,
    coalesce(t.highlights, '{}'::text[]) as highlights,
    j.category::text,
    j.accommodation, j.immediate, j.no_language_required,
    coalesce(t.description, '') as description,
    coalesce(t.responsibilities, '{}'::text[]) as responsibilities,
    coalesce(
      nullif(array(select r.content from public.job_requirements r
                   where r.job_id = j.id and r.kind = 'mandatory' and r.locale = p_locale
                   order by r.position), '{}'::text[]),
      array(select r.content from public.job_requirements r
            where r.job_id = j.id and r.kind = 'mandatory' and r.locale = j.default_locale
            order by r.position)
    ) as requirements_mandatory,
    coalesce(
      nullif(array(select r.content from public.job_requirements r
                   where r.job_id = j.id and r.kind = 'optional' and r.locale = p_locale
                   order by r.position), '{}'::text[]),
      array(select r.content from public.job_requirements r
            where r.job_id = j.id and r.kind = 'optional' and r.locale = j.default_locale
            order by r.position)
    ) as requirements_optional,
    coalesce(t.conditions, '{}'::text[]) as conditions,
    coalesce(t.working_hours, j.working_hours, '') as working_hours,
    coalesce(t.shifts, j.shifts) as shifts,
    coalesce(array(select jl.language_label from public.job_languages jl
                   where jl.job_id = j.id order by jl.language_label), '{}'::text[]) as languages,
    j.transport, j.start_date,
    coalesce(t.company_description, c.description, '') as company_description,
    j.salary_period::text as salary_period,
    j.expires_at,
    case when c.status = 'verified' then public.public_https_url(c.website) end as company_website,
    case when c.status = 'verified' then public.public_https_url(c.logo_url) end as company_logo_url,
    case when c.status = 'verified' then c.slug end as company_slug,
    -- 0172: kanał aplikowania (bramki oferty publicznej bez zmian — warunki WHERE niżej).
    j.apply_url, j.apply_email, j.apply_phone,
    -- 0974 (#811): wymiar czasu pracy (null = pracodawca nie podał).
    j.work_time
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title, jt.description, jt.responsibilities, jt.conditions,
           jt.highlights, jt.working_hours, jt.shifts, jt.company_description
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = p_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.slug = p_slug
    and j.status = 'active'
    and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;

revoke all on function public.get_public_job(text, text) from public;
grant execute on function public.get_public_job(text, text) to anon, authenticated, service_role;

-- --- 12. Kopia oferty jako szkic (0148): wymiar pracy przenosi trigger (jak 0169/0172) ----------
create or replace function public.job_duplications_copy_work_time()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.jobs d set work_time = s.work_time
  from public.jobs s
  where s.id = new.source_job_id and d.id = new.new_job_id and d.status = 'draft';
  return null;
end $$;
revoke all on function public.job_duplications_copy_work_time() from public;

drop trigger if exists trg_job_duplications_copy_work_time on public.job_duplications;
create trigger trg_job_duplications_copy_work_time
  after insert on public.job_duplications
  for each row execute function public.job_duplications_copy_work_time();
