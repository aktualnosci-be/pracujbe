-- =============================================================================
-- Rollback 0229 — strukturalne świadczenia oferty (#826).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy usunąć
-- wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT
-- (supabase/tests/job-benefits-rollback.sql wykonuje go w transakcji i cofa).
--
-- Przywraca: get_public_jobs, get_public_jobs_count, get_public_job_filter_facets,
-- saved_search_jobs_after, saved_search_canonical_filters, saved_search_keyset_page,
-- DOKŁADNIE w stanie 0227 (grafik pracy zostaje); save_job_draft, update_published_job
-- i job_edit_audit_snapshot DOKŁADNIE w stanie 0228 (tryb pracy zostaje).
-- Uruchamiać PRZED rollbackiem 0228 i 0227.
-- Usuwa kolumnę jobs.benefit_codes (ZAZNACZONE ŚWIADCZENIA PRZEPADAJĄ; tekstowe benefity
-- w job_translations zostają) i funkcje pomocnicze. Zapisane wyszukiwania z kluczem `benefits`
-- trzeba przed rollbackiem usunąć albo oczyścić — stara kanonizacja go nie zna.
-- Aplikacja wysyła nowy parametr RPC — przed rollbackiem wycofać wersję aplikacji.
-- =============================================================================

drop trigger if exists trg_job_duplications_copy_benefits on public.job_duplications;
drop function if exists public.job_duplications_copy_benefits();
drop function if exists public.get_public_job_benefits(uuid, text);

drop function if exists public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean, text, text, text, text, integer, text[], text[]);
drop function if exists public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer, text[], text[]);
drop function if exists public.get_public_job_filter_facets(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer, text[], text[]);
drop function if exists public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean, text, text, text, text, integer, text[], text[]);

-- --- Definicje ze stanu 0227 (skopiowane 1:1 z supabase/migrations/0227_job_shift_patterns.sql)
-- --- 2. get_public_jobs i get_public_jobs_count (stan 0214) + p_shift_patterns ------------------
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
  -- 0227 (#858): typy grafiku pracy (oferta z którymkolwiek z nich)
  p_shift_patterns text[]      default null
)
returns table (
  id uuid, slug text, title text, company_name text, company_verified boolean,
  city text, region text, contract_type text, salary_min integer, salary_max integer,
  currency text, salary_period text, published_at timestamptz, highlights text[], category text,
  accommodation boolean, immediate boolean, no_language_required boolean, company_slug text
)
language plpgsql stable security definer
set search_path = public, pg_temp
-- 0213 (#1215): plan dla konkretnych wartości parametrów (bez planu generycznego); bez JIT —
-- kompilacja (dziesiątki ms) jest dłuższa niż krótkie zapytanie strony.
set plan_cache_mode = force_custom_plan
set jit = off
as $$
#variable_conflict use_column
declare
  v_locale text := case when public.is_supported_locale(p_locale) then p_locale else 'pl' end;
begin
  return query
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
  from (
    -- 0213 (#1215): najpierw strona identyfikatorów (indeks published_at albo klucza
    -- wynagrodzenia + LIMIT), dopiero potem tłumaczenie tytułu dla wierszy strony.
    select j.id, j.published_at,
      (case when p_sort = 'salary' then public.job_salary_sort_key(
        j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_unit) end) as salary_key
    from public.jobs j
    join public.companies c on c.id = j.company_id
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
      -- Prefiltr po indeksach (tytuł oferty, któregokolwiek tłumaczenia albo kwalifikacji —
      -- 0214, #866); dokładny warunek na wyświetlanym tytule i kwalifikacjach niżej.
      and (p_keyword is null or j.id in (
        select public.search_keyword_candidates(left(p_keyword, 100))))
      -- 0213 (#1215): wyświetlany tytuł = to samo tłumaczenie co lateral z 0194 (język strony,
      -- język oferty, en), ale jako podzapytanie liczone TYLKO przy słowie kluczowym.
      and (p_keyword is null or public.search_fold(coalesce((
            select jt.title from public.job_translations jt
            where jt.job_id = j.id
            order by (jt.locale = v_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
            limit 1), j.title))
        like public.search_like_pattern(left(p_keyword, 100)) escape '\'
      -- 0214 (#866): albo umiejętność, certyfikat lub wymaganie oferty (wymagania w wyświetlanym języku).
      or public.job_keyword_qualification_match(j.id, j.default_locale, v_locale, left(p_keyword, 100)))
      -- 0194 (#787): widełki w EUR — oferta w innej walucie jest nieporównywalna (jak inny okres).
      -- 0213 (#1215): bez widełek warunek znika z planu (pierwszy człon job_salary_in_range).
      and ((p_salary_min is null and p_salary_max is null) or public.job_salary_in_range(
        j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_min, p_salary_max, p_salary_unit))
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
      -- #858: grafik pracy deklarowany przez pracodawcę (`jobs.shift_patterns`); oferta pasuje,
      -- gdy ma co najmniej jeden z wybranych typów. Oferta bez deklaracji nie pasuje (bez zgadywania
      -- ze starego opisu godzin/zmian).
      and (p_shift_patterns is null or cardinality(p_shift_patterns) = 0
           or j.shift_patterns && p_shift_patterns)
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
    offset least(greatest(coalesce(p_offset, 0), 0), 10000)
  ) page
  join public.jobs j on j.id = page.id
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title, jt.highlights
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = v_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  order by page.salary_key desc nulls last, page.published_at desc, page.id desc;
end;
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
  -- 0227 (#858): typy grafiku pracy (oferta z którymkolwiek z nich)
  p_shift_patterns text[]      default null
) returns bigint language plpgsql stable security definer
set search_path = public, pg_temp
-- 0213 (#1215): plan dla konkretnych wartości parametrów (bez planu generycznego); bez JIT —
-- kompilacja (dziesiątki ms) jest dłuższa niż krótkie zapytanie strony.
set plan_cache_mode = force_custom_plan
set jit = off
as $$
#variable_conflict use_column
declare
  v_locale text := case when public.is_supported_locale(p_locale) then p_locale else 'pl' end;
begin
  return (
  select count(*)::bigint
  from public.jobs j
  join public.companies c on c.id = j.company_id
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
    -- Prefiltr po indeksach (tytuł oferty, któregokolwiek tłumaczenia albo kwalifikacji —
    -- 0214, #866); dokładny warunek na wyświetlanym tytule i kwalifikacjach niżej.
    and (p_keyword is null or j.id in (
      select public.search_keyword_candidates(left(p_keyword, 100))))
    -- 0213 (#1215): wyświetlany tytuł = to samo tłumaczenie co lateral z 0194 (język strony,
    -- język oferty, en), ale jako podzapytanie liczone TYLKO przy słowie kluczowym.
    and (p_keyword is null or public.search_fold(coalesce((
          select jt.title from public.job_translations jt
          where jt.job_id = j.id
          order by (jt.locale = v_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
          limit 1), j.title))
      like public.search_like_pattern(left(p_keyword, 100)) escape '\'
      -- 0214 (#866): albo umiejętność, certyfikat lub wymaganie oferty (wymagania w wyświetlanym języku).
      or public.job_keyword_qualification_match(j.id, j.default_locale, v_locale, left(p_keyword, 100)))
    -- 0194 (#787): widełki w EUR — oferta w innej walucie jest nieporównywalna (jak inny okres).
    -- 0213 (#1215): bez widełek warunek znika z planu (pierwszy człon job_salary_in_range).
    and ((p_salary_min is null and p_salary_max is null) or public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_min, p_salary_max, p_salary_unit))
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
    -- #858: grafik pracy deklarowany przez pracodawcę (`jobs.shift_patterns`); oferta pasuje,
    -- gdy ma co najmniej jeden z wybranych typów. Oferta bez deklaracji nie pasuje (bez zgadywania
    -- ze starego opisu godzin/zmian).
    and (p_shift_patterns is null or cardinality(p_shift_patterns) = 0
         or j.shift_patterns && p_shift_patterns)
    -- 0194 (#824): promień od miejscowości ze słownika (współrzędne `locations`); oferta bez
    -- rozpoznanej miejscowości albo bez współrzędnych nie pasuje (odległość nieznana); oferta
    -- zdalna (`jobs.remote`) pasuje do każdego promienia (decyzja właściciela 29.09.2026).
    and (coalesce(btrim(p_near), '') = ''
         or j.remote is true
         or j.location_id in (select unnest(public.locations_within_radius(left(btrim(p_near), 100), p_radius_km))))
  );
end;
$$;
revoke all on function public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer, text[]
) from public;
grant execute on function public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer, text[]
) to anon, authenticated;


-- --- 3. Facety (stan 0214) + p_shift_patterns (zawęża bazę wszystkich wymiarów) -------------------
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
  -- 0227 (#858): typy grafiku pracy
  p_shift_patterns text[] default null
) returns table (dimension text, key text, total bigint)
language plpgsql stable security definer
set search_path = public, pg_temp
-- 0213 (#1215): plan dla konkretnych wartości parametrów (bez planu generycznego); bez JIT —
-- kompilacja (dziesiątki ms) jest dłuższa niż krótkie zapytanie strony.
set plan_cache_mode = force_custom_plan
set jit = off
as $$
#variable_conflict use_column
declare
  v_locale text := case when public.is_supported_locale(p_locale) then p_locale else 'pl' end;
begin
  return query
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
      -- 0213 (#1215): nazwa jako podzapytanie po kluczu głównym (to samo co dawne złączenia
      -- `left join locations l … left join locations pl …`): przy małej liczbie ofert po filtrze
      -- słowa kluczowego planer wybierał pętlę z pełnym skanem słownika na każdą ofertę.
      coalesce((
        select coalesce(pl.name, l.name)
        from public.locations l
        left join public.locations pl on pl.id=l.parent_location_id and pl.is_active
        where l.id=j.location_id and l.is_active
      ), j.city) city_label, j.contract_type::text contract_type,
      j.accommodation, j.immediate, j.no_language_required, c.is_agency
    from public.jobs j
    join public.companies c on c.id=j.company_id
    where j.status='active' and j.deleted_at is null
      and (j.expires_at is null or j.expires_at>now())
      and c.status='verified' and c.deleted_at is null
      and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
      and (nullif(left(p_keyword,100),'') is null or j.id in (
        select public.search_keyword_candidates(left(p_keyword,100))))
      -- 0213 (#1215): wyświetlany tytuł jak lateral z 0194, ale liczony tylko przy słowie kluczowym;
      -- warunki na parametrach (nie na kolumnach CTE `input`), żeby planer znał je jako stałe.
      and (nullif(left(p_keyword,100),'') is null or public.search_fold(coalesce((
            select jt.title from public.job_translations jt where jt.job_id=j.id
            order by (jt.locale=v_locale) desc, (jt.locale=j.default_locale) desc,
              (jt.locale='en') desc limit 1),j.title))
        like public.search_like_pattern(left(p_keyword,100)) escape '\'
        -- 0214 (#866): albo umiejętność, certyfikat lub wymaganie oferty.
        or public.job_keyword_qualification_match(j.id, j.default_locale, v_locale, left(p_keyword,100)))
      and (nullif(left(p_city,100),'') is null or j.id in (
        select public.search_city_candidates(left(p_city,100))))
      -- 0194 (#787): widełki w EUR — inna waluta nieporównywalna.
      -- 0213 (#1215): bez widełek warunek znika z planu (pierwszy człon job_salary_in_range).
      and ((p_salary_min is null and p_salary_max is null) or public.job_salary_in_range(
        j.salary_min,j.salary_max,j.salary_period,j.currency,p_salary_min,p_salary_max,p_salary_unit))
      -- 0194 (#786): wymagany język ze słownika (kod ISO) — oferta wymaga tego języka na poziomie
      -- najwyżej wybranym (brak poziomu w ofercie = każdy poziom). Nieznany kod = brak wyników.
      and (coalesce(btrim(p_language), '') = ''
           or public.job_requires_language(j.id, btrim(p_language), p_language_level))
      -- 0194 (#811): wymiar czasu pracy deklarowany przez pracodawcę; `both` pasuje do obu.
      -- Oferta bez deklaracji nie pasuje (nie zgadujemy z opisu godzin).
      and (coalesce(p_work_time, '') = ''
           or (p_work_time in ('full_time', 'part_time') and j.work_time in (p_work_time, 'both')))
      -- #858: grafik pracy deklarowany przez pracodawcę (`jobs.shift_patterns`); oferta pasuje,
      -- gdy ma co najmniej jeden z wybranych typów. Oferta bez deklaracji nie pasuje (bez zgadywania
      -- ze starego opisu godzin/zmian).
      and (p_shift_patterns is null or cardinality(p_shift_patterns) = 0
           or j.shift_patterns && p_shift_patterns)
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
end;
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
  p_shift_patterns      text[]  default null
)
returns table (id uuid, published_at timestamptz)
language plpgsql stable security definer
set search_path = public, pg_temp
-- 0213 (#1215): plan dla konkretnych wartości parametrów (bez planu generycznego); bez JIT —
-- kompilacja (dziesiątki ms) jest dłuższa niż krótkie zapytanie strony.
set plan_cache_mode = force_custom_plan
set jit = off
as $$
#variable_conflict use_column
declare
  v_locale text := case when public.is_supported_locale(p_locale) then p_locale else 'pl' end;
begin
  return query
  select j.id, j.published_at
  -- BEGIN get_public_jobs filters (kopia 1:1 z najnowszej definicji get_public_jobs)
  from public.jobs j
  join public.companies c on c.id = j.company_id
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
    -- Prefiltr po indeksach (tytuł oferty, któregokolwiek tłumaczenia albo kwalifikacji —
    -- 0214, #866); dokładny warunek na wyświetlanym tytule i kwalifikacjach niżej.
    and (p_keyword is null or j.id in (
      select public.search_keyword_candidates(left(p_keyword, 100))))
    -- 0213 (#1215): wyświetlany tytuł = to samo tłumaczenie co lateral z 0194 (język strony,
    -- język oferty, en), ale jako podzapytanie liczone TYLKO przy słowie kluczowym.
    and (p_keyword is null or public.search_fold(coalesce((
          select jt.title from public.job_translations jt
          where jt.job_id = j.id
          order by (jt.locale = v_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
          limit 1), j.title))
      like public.search_like_pattern(left(p_keyword, 100)) escape '\'
      -- 0214 (#866): albo umiejętność, certyfikat lub wymaganie oferty (wymagania w wyświetlanym języku).
      or public.job_keyword_qualification_match(j.id, j.default_locale, v_locale, left(p_keyword, 100)))
    -- 0194 (#787): widełki w EUR — oferta w innej walucie jest nieporównywalna (jak inny okres).
    -- 0213 (#1215): bez widełek warunek znika z planu (pierwszy człon job_salary_in_range).
    and ((p_salary_min is null and p_salary_max is null) or public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, j.currency, p_salary_min, p_salary_max, p_salary_unit))
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
    -- #858: grafik pracy deklarowany przez pracodawcę (`jobs.shift_patterns`); oferta pasuje,
    -- gdy ma co najmniej jeden z wybranych typów. Oferta bez deklaracji nie pasuje (bez zgadywania
    -- ze starego opisu godzin/zmian).
    and (p_shift_patterns is null or cardinality(p_shift_patterns) = 0
         or j.shift_patterns && p_shift_patterns)
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
end;
$$;
revoke all on function public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean, text, text, text, text, integer, text[]
) from public, anon, authenticated;
grant execute on function public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean, text, text, text, text, integer, text[]
) to service_role;


-- --- 5. Zapisane wyszukiwania: klucz kanoniczny `shiftPatterns` (stan 0194) ------------------
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
                    -- 0227 (#858)
                    'shiftPatterns')
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

  -- 0227 (#858): typy grafiku pracy (lista z `job_shift_pattern_values`, posortowana, bez duplikatów).
  v_arr := public.saved_search_text_array(p_filters -> 'shiftPatterns', 20);
  if v_arr is not null then
    if not v_arr <@ public.job_shift_pattern_values() then
      raise exception 'VALIDATION_FAILED: nieznany typ grafiku' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('shiftPatterns', to_jsonb(v_arr));
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
    -- 0227 (#858)
    p_shift_patterns     => (select array_agg(x) from jsonb_array_elements_text(p_filters -> 'shiftPatterns') x)
  ) k;
$$;
revoke all on function public.saved_search_keyset_page(jsonb, text, timestamptz, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.saved_search_keyset_page(jsonb, text, timestamptz, timestamptz, uuid, integer)
  to service_role;

-- --- 6. Kreator: save_job_draft — definicja 0228 (stan 0227 + tryb pracy) -----------------------------------
create or replace function public.save_job_draft(
  p_job_id uuid, p_content jsonb, p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_status text; v_locale text; v_title text;
  v_updated timestamptz; v_new timestamptz;
  j jsonb := coalesce(p_content->'job', '{}'::jsonb);
  tr jsonb := coalesce(p_content->'translation', '{}'::jsonb);
  v_bad text;
  v_step smallint;
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
                    -- 0227, #858: typy grafiku pracy
                    'shift_patterns',
                    -- 0228, #792: tryb pracy i kraje kandydata przy pracy w 100% zdalnej
                    'work_mode', 'remote_applicant_countries')
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
  -- 0216 (#834): numer kroku kreatora (1–9), którego zapis jest tą treścią. Brak klucza = zapis
  -- spoza kreatora (import) — postęp bez zmian. Wartość spoza zakresu = odrzucenie całego kroku.
  if p_content ? 'draft_step' then
    if jsonb_typeof(p_content->'draft_step') <> 'number'
       or (p_content->>'draft_step') !~ '^[1-9]$' then
      raise exception 'VALIDATION_FAILED: nieprawidłowy krok kreatora' using errcode = '42501';
    end if;
    v_step := (p_content->>'draft_step')::smallint;
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
      shift_patterns           = case when j ? 'shift_patterns' then public.job_shift_patterns_from_jsonb(j->'shift_patterns') else shift_patterns end,
      work_mode                = case when j ? 'work_mode' then nullif(j->>'work_mode', '') else work_mode end,
      -- Tryb inny niż w 100% zdalny = bez krajów (CHECK), także gdy klucz krajów nie przyszedł.
      remote_applicant_countries = case
                                     when j ? 'work_mode' and coalesce(j->>'work_mode', '') <> 'remote' then '{}'::text[]
                                     when j ? 'remote_applicant_countries'
                                       then public.job_country_codes(j->'remote_applicant_countries')
                                     else remote_applicant_countries end
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

  -- 0216 (#834): postęp kreatora = najdalszy krok z udanym zapisem. Ta sama transakcja co treść
  -- kroku (błąd dowolnej części cofa też postęp); powrót do wcześniejszego kroku go nie cofa.
  if v_step is not null then
    update public.jobs set draft_step = greatest(coalesce(draft_step, 0), v_step)
      where id = p_job_id and draft_step is distinct from greatest(coalesce(draft_step, 0), v_step);
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

-- --- 7. update_published_job — definicja 0228 (stan 0227 + tryb pracy) --------------------------------------
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
    -- 0227 (#858): typy grafiku pracy (brak klucza = brak deklaracji, jak work_time).
    shift_patterns           = public.job_shift_patterns_from_jsonb(j->'shift_patterns'),
    -- 0228 (#792): tryb pracy i kraje kandydata (brak klucza = tryb nieznany, bez krajów).
    work_mode                = nullif(j->>'work_mode', ''),
    remote_applicant_countries = case when coalesce(j->>'work_mode', '') = 'remote'
                                      then public.job_country_codes(j->'remote_applicant_countries')
                                      else '{}'::text[] end,
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

-- --- job_edit_audit_snapshot — definicja 0228
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
    -- 0228 (#792): tryb pracy i kraje kandydata.
    'work_mode', j.work_mode, 'remote_applicant_countries', to_jsonb(j.remote_applicant_countries),
    -- Ten sam zakres co powiadomienie kandydata (0144/0169).
    'terms', public.job_material_terms(j))
$$;
revoke all on function public.job_edit_audit_snapshot(public.jobs) from public, anon, authenticated;

drop index if exists public.idx_jobs_effective_benefits_active;
alter table public.jobs drop constraint if exists jobs_benefit_codes_known;
alter table public.jobs drop column if exists benefit_codes;
drop function if exists public.job_benefit_codes_from_jsonb(jsonb);
drop function if exists public.job_effective_benefits(text[], boolean, numeric);
drop function if exists public.job_benefit_catalog();
