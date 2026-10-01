-- =============================================================================
-- 0976_job_benefits.sql — strukturalne świadczenia oferty (#826).
-- NUMER TYMCZASOWY — ostateczny nada integrator.
--
-- Rozszerza „Koszty i dodatki” (0169) zamiast je dublować:
--   * `jobs.benefit_codes text[]` — kategorie świadczeń zaznaczone przez pracodawcę ze stałego
--     katalogu (kody danych; etykiety PL/NL/FR/EN w src/messages, lustro kodów
--     src/lib/job-benefits.ts — zgodność pilnuje tests/unit/job-benefits.test.ts). Brak kodu =
--     „nie podano”, nie „nie oferuje”. Starych ofert NIE klasyfikujemy (bez zgadywania z tekstu).
--     Tekstowe `job_translations.benefits` zostaje jako „inne świadczenia / szczegóły”.
--   * Bony żywieniowe i zwrot kosztów dojazdu mają już strukturalne pola z 0169
--     (`meal_voucher_daily`, `transport_reimbursed`) — `job_effective_benefits(…)` łączy je
--     z zaznaczonymi kodami (jedno źródło dla filtra i szczegółu), więc oferta z kwotą bonów
--     pasuje do filtra „bony żywieniowe” bez drugiej deklaracji.
--   * Filtr `p_benefits text[]` (oferta ma KAŻDE wybrane świadczenie) w `get_public_jobs`,
--     `get_public_jobs_count`, `get_public_job_filter_facets` (baza wymiarów) i kopii dla alertów
--     `saved_search_jobs_after` (blok 1:1 — test saved-search-keyset-sync). Klucz kanoniczny
--     zapisanego wyszukiwania `benefits` (`saved_search_canonical_filters`, `saved_search_keyset_page`).
--     Nowy parametr jest OSTATNI i ma wartość domyślną; stare sygnatury są usuwane.
--   * Zapis: `save_job_draft` (stan 0194) i `update_published_job` (stan 0203) — klucz
--     `benefit_codes` (`job_benefit_codes_from_jsonb`: tablica znanych kodów, deduplikacja,
--     porządek katalogu); migawka audytu edycji (stan 0200) + `benefit_codes`; kopia szkicu
--     przez trigger na `job_duplications` (jak 0169/0194).
--   * Odczyt: `get_public_job_benefits(p_job_id, p_locale)` — tylko oferta publiczna
--     (`job_is_public`), kody efektywne + tekstowe „inne” z tego samego tłumaczenia, które
--     wybiera `get_public_job` (`get_public_job` bez zmian — jak `get_public_job_costs`).
--   Portal nie przelicza świadczeń na kwoty netto ani nie porównuje ich z wynagrodzeniem.
--
-- Rollback: supabase/rollback/0976_job_benefits.down.sql (dowód: supabase/tests/job-benefits-rollback.sql).
-- =============================================================================

-- --- 1. Kolumna i katalog -------------------------------------------------------------------------
create or replace function public.job_benefit_catalog()
returns text[] language sql immutable parallel safe set search_path = public, pg_temp as $$
  select array['meal_vouchers', 'eco_vouchers', 'commute_allowance', 'bike_allowance', 'company_car', 'mobility_budget', 'hospital_insurance', 'group_insurance', 'year_end_bonus', 'extra_leave', 'training', 'phone_laptop']::text[];
$$;
revoke all on function public.job_benefit_catalog() from public;
grant execute on function public.job_benefit_catalog() to anon, authenticated, service_role;

alter table public.jobs
  add column if not exists benefit_codes text[] not null default '{}'::text[],
  add constraint jobs_benefit_codes_known
    check (benefit_codes <@ public.job_benefit_catalog()
           and cardinality(benefit_codes) <= cardinality(public.job_benefit_catalog())
           and array_position(benefit_codes, null) is null);
comment on column public.jobs.benefit_codes is
  '0976 (#826): kategorie świadczeń zaznaczone przez pracodawcę (kody z job_benefit_catalog()); pusta = nie podano.';

-- Świadczenia efektywne: zaznaczone kody + bony żywieniowe (kwota z 0169) + zwrot dojazdu (0169).
-- Porządek katalogu, bez powtórzeń. Lustro TS: `effectiveBenefitCodes` (src/lib/job-benefits.ts).
create or replace function public.job_effective_benefits(
  p_codes text[], p_transport_reimbursed boolean, p_meal_voucher_daily numeric
) returns text[] language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(array_agg(c order by o), '{}'::text[])
  from unnest(public.job_benefit_catalog()) with ordinality as k(c, o)
  where c = any(coalesce(p_codes, '{}'::text[]))
     or (c = 'meal_vouchers' and p_meal_voucher_daily is not null)
     or (c = 'commute_allowance' and coalesce(p_transport_reimbursed, false));
$$;
revoke all on function public.job_effective_benefits(text[], boolean, numeric) from public;
grant execute on function public.job_effective_benefits(text[], boolean, numeric) to anon, authenticated, service_role;

create index if not exists idx_jobs_effective_benefits_active on public.jobs
  using gin (public.job_effective_benefits(benefit_codes, transport_reimbursed, meal_voucher_daily))
  where status = 'active' and deleted_at is null;

-- Wejście kreatora: tablica JSON znanych kodów → text[] w porządku katalogu (null/brak = pusta).
create or replace function public.job_benefit_codes_from_jsonb(p_value jsonb)
returns text[] language plpgsql immutable set search_path = public, pg_temp as $$
declare v_out text[];
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return '{}'::text[]; end if;
  if jsonb_typeof(p_value) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string')
     or exists (select 1 from jsonb_array_elements_text(p_value) e
                where not e = any(public.job_benefit_catalog())) then
    raise exception 'VALIDATION_FAILED: nieznane świadczenie' using errcode = '22023';
  end if;
  select coalesce(array_agg(c order by o), '{}'::text[]) into v_out
    from unnest(public.job_benefit_catalog()) with ordinality as k(c, o)
    where p_value ? c;
  return v_out;
end $$;
revoke all on function public.job_benefit_codes_from_jsonb(jsonb) from public;
grant execute on function public.job_benefit_codes_from_jsonb(jsonb) to authenticated, service_role;

-- --- 2. get_public_jobs i licznik (stan 0194) + świadczenia ------------------------------------------------
drop function if exists public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean, text, text, text, text, integer);
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
  p_radius_km      integer     default null,
  -- 0976 (#826): świadczenia (oferta ma każde wybrane)
  p_benefits       text[]      default null
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
    -- 0976 (#826): świadczenia — oferta ma KAŻDE wybrane (deklaracja pracodawcy, z bonami
    -- żywieniowymi i zwrotem dojazdu z pól „Koszty i dodatki” 0169); brak deklaracji nie pasuje.
    and (coalesce(cardinality(p_benefits), 0) = 0
         or public.job_effective_benefits(j.benefit_codes, j.transport_reimbursed, j.meal_voucher_daily)
            @> p_benefits)
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
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean, text, text, text, text, integer, text[]
) from public;
grant execute on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean, text, text, text, text, integer, text[]
) to anon, authenticated;

drop function if exists public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer);
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
  p_radius_km      integer     default null,
  -- 0976 (#826): świadczenia (oferta ma każde wybrane)
  p_benefits       text[]      default null
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
         or j.location_id in (select unnest(public.locations_within_radius(left(btrim(p_near), 100), p_radius_km))))
    -- 0976 (#826): świadczenia — oferta ma KAŻDE wybrane (deklaracja pracodawcy, z bonami
    -- żywieniowymi i zwrotem dojazdu z pól „Koszty i dodatki” 0169); brak deklaracji nie pasuje.
    and (coalesce(cardinality(p_benefits), 0) = 0
         or public.job_effective_benefits(j.benefit_codes, j.transport_reimbursed, j.meal_voucher_daily)
            @> p_benefits);
$$;
revoke all on function public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer, text[]
) from public;
grant execute on function public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer, text[]
) to anon, authenticated;

-- --- 3. Facety (stan 0194) + świadczenia (zawężają bazę wszystkich wymiarów)
drop function if exists public.get_public_job_filter_facets(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer);
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
  p_radius_km integer default null,
  -- 0976 (#826): świadczenia
  p_benefits text[] default null
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
      -- 0976 (#826): świadczenia — oferta ma KAŻDE wybrane (deklaracja pracodawcy, z bonami
      -- żywieniowymi i zwrotem dojazdu z pól „Koszty i dodatki” 0169); brak deklaracji nie pasuje.
      and (coalesce(cardinality(p_benefits), 0) = 0
           or public.job_effective_benefits(j.benefit_codes, j.transport_reimbursed, j.meal_voucher_daily)
              @> p_benefits)
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
revoke all on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean,text,text,text,text,integer,text[]) from public;
grant execute on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean,text,text,text,text,integer,text[]) to anon, authenticated;

-- --- 4. Kopia filtrów dla alertów (test saved-search-keyset-sync: blok = get_public_jobs) -----
drop function if exists public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean, text, text, text, text, integer);
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
  p_radius_km           integer default null,
  p_benefits            text[]  default null
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
    -- 0976 (#826): świadczenia — oferta ma KAŻDE wybrane (deklaracja pracodawcy, z bonami
    -- żywieniowymi i zwrotem dojazdu z pól „Koszty i dodatki” 0169); brak deklaracji nie pasuje.
    and (coalesce(cardinality(p_benefits), 0) = 0
         or public.job_effective_benefits(j.benefit_codes, j.transport_reimbursed, j.meal_voucher_daily)
            @> p_benefits)
  -- END get_public_jobs filters
    and j.published_at is not null
    and (p_after_published_at is null
         or (j.published_at, j.id) < (p_after_published_at, p_after_id))
  order by j.published_at desc, j.id desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;
revoke all on function public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean, text, text, text, text, integer, text[]
) from public, anon, authenticated;
grant execute on function public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean, text, text, text, text, integer, text[]
) to service_role;

-- --- 5. Zapisane wyszukiwania: klucz kanoniczny `benefits` (stan 0194) ---------------------------
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
                    'noLanguage', 'language', 'languageLevel', 'workTime', 'near', 'radiusKm',
                    'benefits')
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

  -- 0194 (#786): język (kod słownika) i opcjonalny poziom (tylko razem z językiem).
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

  -- 0194 (#811): wymiar czasu pracy.
  if p_filters ? 'workTime' and jsonb_typeof(p_filters -> 'workTime') <> 'null' then
    if jsonb_typeof(p_filters -> 'workTime') <> 'string'
       or p_filters ->> 'workTime' not in ('full_time', 'part_time') then
      raise exception 'VALIDATION_FAILED: nieprawidłowy wymiar pracy' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('workTime', p_filters ->> 'workTime');
  end if;

  -- 0194 (#824): promień od miejscowości — miejscowość (≤ 100 znaków) i promień z listy.
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

  -- 0976 (#826): świadczenia — znane kody, porządek katalogu (ten sam zbiór = ten sam zapis).
  v_arr := public.saved_search_text_array(p_filters -> 'benefits', 50);
  if v_arr is not null then
    if not v_arr <@ public.job_benefit_catalog() then
      raise exception 'VALIDATION_FAILED: nieznane świadczenie' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('benefits', to_jsonb(public.job_benefit_codes_from_jsonb(to_jsonb(v_arr))));
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
    -- 0194: język, poziom, wymiar pracy, promień (klucze kanoniczne → parametry listy)
    p_language           => p_filters ->> 'language',
    p_language_level     => p_filters ->> 'languageLevel',
    p_work_time          => p_filters ->> 'workTime',
    p_near               => p_filters ->> 'near',
    p_radius_km          => (p_filters ->> 'radiusKm')::integer,
    -- 0976 (#826): świadczenia
    p_benefits           => (select array_agg(x) from jsonb_array_elements_text(p_filters -> 'benefits') x)
  ) k;
$$;
revoke all on function public.saved_search_keyset_page(jsonb, text, timestamptz, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.saved_search_keyset_page(jsonb, text, timestamptz, timestamptz, uuid, integer)
  to service_role;

-- --- 6. Kreator: save_job_draft (stan 0194) + benefit_codes -------------------------------------
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
                    -- 0194, #811: wymiar czasu pracy
                    'work_time',
                    -- 0976, #826: świadczenia z katalogu
                    'benefit_codes')
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
      work_time                = case when j ? 'work_time' then nullif(j->>'work_time', '') else work_time end,
      benefit_codes            = case when j ? 'benefit_codes' then public.job_benefit_codes_from_jsonb(j->'benefit_codes') else benefit_codes end
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

-- --- 7. update_published_job (stan 0203) + benefit_codes ------------------------------------------
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

  -- 0200: migawka audytu z jednego źródła (job_edit_audit_snapshot ⊇ job_material_terms).
  select j0.company_id, c.status::text, j0.status::text, j0.slug, j0.default_locale, j0.updated_at,
         public.job_edit_audit_snapshot(j0)
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

  -- 0200: kontekst tej rewizji w tabeli bez grantów dla klienta (zamiast GUC z 0144, który
  -- klient mógł ustawić sam przez set_config) — trigger powiadomień reaguje tylko na ten zapis.
  insert into public.job_operation_context (job_id, kind) values (p_job_id, 'job_terms_notify');
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
    -- 0194 (#811): wymiar czasu pracy (brak klucza = brak deklaracji; przeniesione z main).
    work_time                = nullif(j->>'work_time', ''),
    -- 0976 (#826): świadczenia z katalogu (brak klucza = brak deklaracji).
    benefit_codes            = public.job_benefit_codes_from_jsonb(j->'benefit_codes'),
    updated_at               = now()
  where id = p_job_id;
  delete from public.job_operation_context
   where tx = pg_current_xact_id() and job_id = p_job_id and kind = 'job_terms_notify';

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

  -- Relacje replace-all tymi samymi funkcjami co kreator; kontekst operacji (0200, zamiast GUC
  -- z 0077) dopuszcza ofertę nie-szkic tylko na czas tych wywołań.
  insert into public.job_operation_context (job_id, kind) values (p_job_id, 'job_edit');
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
  delete from public.job_operation_context
   where tx = pg_current_xact_id() and job_id = p_job_id and kind = 'job_edit';

  -- Kompletność jak w publish_job — po zapisie, więc błąd cofa całą rewizję. Tytuł: tylko
  -- niepusty (#1221, bez heurystyki, która odrzucała np. „Draftsman”).
  if v_title = ''
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

  select public.job_edit_audit_snapshot(j1), j1.updated_at
    into v_after, v_updated from public.jobs j1 where j1.id = p_job_id;
  perform public.write_audit('job.update_published', 'job', p_job_id, v_before, v_after);

  return jsonb_build_object('slug', v_slug, 'updated_at', v_updated);
end $$;
revoke all on function public.update_published_job(uuid, jsonb, timestamptz) from public;
grant execute on function public.update_published_job(uuid, jsonb, timestamptz) to authenticated;

-- --- 8. Migawka audytu edycji (stan 0200) + benefit_codes ---------------------------------------
create or replace function public.job_edit_audit_snapshot(j public.jobs)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'title', j.title, 'city', j.city, 'region', j.region,
    'salary_min', j.salary_min, 'salary_max', j.salary_max,
    'salary_period', j.salary_period, 'currency', j.currency,
    'start_date', j.start_date, 'contract_type', j.contract_type,
    'working_hours', j.working_hours, 'shifts', j.shifts,
    'accommodation_kind', j.accommodation_kind, 'accommodation_cost', j.accommodation_cost,
    'accommodation_cost_period', j.accommodation_cost_period,
    'accommodation_deducted', j.accommodation_deducted,
    -- 0976 (#826): świadczenia z katalogu.
    'benefit_codes', to_jsonb(j.benefit_codes),
    -- Ten sam zakres co powiadomienie kandydata (0144/0169).
    'terms', public.job_material_terms(j))
$$;
revoke all on function public.job_edit_audit_snapshot(public.jobs) from public, anon, authenticated;

-- --- 9. Kopia oferty jako szkic (0148): świadczenia przenosi trigger (jak 0169/0194) -------------
create or replace function public.job_duplications_copy_benefits()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.jobs d set benefit_codes = s.benefit_codes
  from public.jobs s
  where s.id = new.source_job_id and d.id = new.new_job_id and d.status = 'draft';
  return null;
end $$;
revoke all on function public.job_duplications_copy_benefits() from public;

drop trigger if exists trg_job_duplications_copy_benefits on public.job_duplications;
create trigger trg_job_duplications_copy_benefits
  after insert on public.job_duplications
  for each row execute function public.job_duplications_copy_benefits();

-- --- 10. Odczyt sekcji „Świadczenia” oferty publicznej -----------------------------------------------
-- Kody efektywne + tekstowe „inne” z tego samego tłumaczenia, które pokazuje `get_public_job`
-- (ta sama kolejność wyboru: język strony → język oferty → en).
create or replace function public.get_public_job_benefits(p_job_id uuid, p_locale text default 'pl')
returns table (codes text[], other text[])
language sql stable security definer set search_path = public, pg_temp as $$
  select public.job_effective_benefits(j.benefit_codes, j.transport_reimbursed, j.meal_voucher_daily),
         coalesce(t.benefits, '{}'::text[])
    from public.jobs j
    left join lateral (
      select jt.benefits
      from public.job_translations jt
      where jt.job_id = j.id
      order by (jt.locale = p_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
      limit 1
    ) t on true
    where j.id = p_job_id and j.deleted_at is null and public.job_is_public(p_job_id);
$$;
revoke all on function public.get_public_job_benefits(uuid, text) from public;
grant execute on function public.get_public_job_benefits(uuid, text) to anon, authenticated, service_role;
