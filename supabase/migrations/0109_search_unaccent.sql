-- =============================================================================
-- 0109_search_unaccent.sql
-- #47 (dokończenie): wyszukiwanie ofert odporne na znaki diakrytyczne i literalne
-- `%`/`_`/`\` w słowie kluczowym i mieście.
--
-- Dotąd `get_public_jobs`/`_count`/`get_public_job_filter_facets` porównywały
-- `ilike '%' || wartość || '%'`: „sprzatania” nie znajdowało „sprzątania”, „Liege” —
-- „Liège”, a `%`/`_` wpisane przez użytkownika działały jak symbole wieloznaczne
-- („50%” dopasowywało wszystko). Pomiar: docs/railway/OPERATIONS.md §3.
--
--   * `unaccent` (contrib, trusted) + `search_fold(text)` = lower(unaccent(...)) ze stałym
--     słownikiem `public.unaccent` — IMMUTABLE, więc nadaje się do indeksu wyrażeniowego.
--     Obie strony porównania są składane tą samą funkcją (tytuł/miasto i wpis użytkownika).
--   * `search_like_pattern(text)` = '%' || literał || '%' z escapowaniem `\`, `%`, `_`
--     (znak ucieczki `\`, jawnie `escape '\'`). Wpis jest składany PRZED escapowaniem.
--   * indeksy GIN `gin_trgm_ops` na `search_fold(jobs.title)`, `search_fold(job_translations.title)`
--     i `search_fold(jobs.city)` (częściowe dla aktywnych jak `idx_jobs_city_trgm` z 0096,
--     który przestaje być używany i jest usuwany).
--   * `search_city_candidates(text)` = aktywne oferty, których złożone miasto zawiera
--     złożony wpis (skan `idx_jobs_city_fold_trgm`); zastępuje warunek na `j.city`.
--   * `search_title_candidates(text)` = oferty, których tytuł albo tytuł dowolnego
--     tłumaczenia pasuje (dwa skany indeksów). Warunek konieczny: wyświetlany tytuł to
--     tłumaczenie albo tytuł oferty. Dokładny warunek na wyświetlanym tytule zostaje, więc
--     wynik jest identyczny jak bez prefiltra (bez fałszywych trafień z innego języka).
--
-- Parametry i semantyka pozostałych filtrów = stan z 0091 (0080 wynagrodzenie, 0090
-- blokady firm, 0091 jednostka). Sygnatury, domyślne wartości i granty bez zmian
-- (`create or replace`), więc aplikacja nie wymaga zmian. Aliasy miast w innych językach
-- (Brussels → Bruxelles) nadal poza zakresem — rozwija je aplikacja (`job-list-query.ts`).
--
-- Rollback: NOWA migracja naprawcza — odtworzenie trzech RPC z 0091 (create or replace,
-- te same sygnatury), `drop function search_city_candidates, search_title_candidates, search_like_pattern,
-- search_fold`, drop trzech indeksów `idx_*_fold_trgm`, odtworzenie `idx_jobs_city_trgm`
-- z 0096; `drop extension unaccent` na końcu. Migracja nie zmienia danych. Nie edytować
-- tej migracji po zastosowaniu.
-- =============================================================================

create extension if not exists unaccent with schema public;

-- Stały słownik (argument regdictionary) zamiast zależności od search_path: wynik zależy
-- tylko od argumentu i reguł słownika, stąd IMMUTABLE. Bez `set search_path`, żeby
-- planista mógł wstawić ciało w wyrażenia (także indeksu) — wszystko kwalifikowane schematem.
create or replace function public.search_fold(p_value text)
returns text language sql immutable strict parallel safe as $$
  select pg_catalog.lower(public.unaccent('public.unaccent'::regdictionary, p_value));
$$;

-- Wzorzec LIKE „zawiera literał” po złożeniu. Kolejność: najpierw `\`, potem `%` i `_`.
create or replace function public.search_like_pattern(p_value text)
returns text language sql immutable strict parallel safe as $$
  select '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
    public.search_fold(p_value), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

create index if not exists idx_jobs_title_fold_trgm
  on public.jobs using gin (public.search_fold(title) gin_trgm_ops)
  where status = 'active' and deleted_at is null;
create index if not exists idx_job_translations_title_fold_trgm
  on public.job_translations using gin (public.search_fold(title) gin_trgm_ops);
create index if not exists idx_jobs_city_fold_trgm
  on public.jobs using gin (public.search_fold(city) gin_trgm_ops)
  where status = 'active' and deleted_at is null;
drop index if exists public.idx_jobs_city_trgm;

-- Kandydaci po tytule: tylko identyfikatory, bez żadnych innych danych. Wołają ją
-- wyłącznie trzy RPC poniżej (SECURITY DEFINER, właściciel = migrator); bez grantów
-- dla ról aplikacji.
create or replace function public.search_title_candidates(p_keyword text)
returns setof uuid language sql stable strict parallel safe
set search_path = public, pg_temp as $$
  select j.id from public.jobs j
  where j.status = 'active' and j.deleted_at is null
    and public.search_fold(j.title) like public.search_like_pattern(p_keyword) escape '\'
  union
  select jt.job_id from public.job_translations jt
  where public.search_fold(jt.title) like public.search_like_pattern(p_keyword) escape '\';
$$;
revoke all on function public.search_title_candidates(text) from public;

-- Oferty, których miasto pasuje — dokładny warunek (nie prefiltr): ta sama reguła co
-- `search_fold(city) like …` na aktywnych ofertach, ale przez indeks, bez składania
-- miasta każdej oferty w planie ogólnym (PG16).
create or replace function public.search_city_candidates(p_city text)
returns setof uuid language sql stable strict parallel safe
set search_path = public, pg_temp as $$
  select j.id from public.jobs j
  where j.status = 'active' and j.deleted_at is null
    and public.search_fold(j.city) like public.search_like_pattern(p_city) escape '\';
$$;
revoke all on function public.search_city_candidates(text) from public;

-- --- get_public_jobs (0091) + wyszukiwanie bez diakrytyków -------------------------------------
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
  accommodation boolean, immediate boolean, no_language_required boolean
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
    j.accommodation, j.immediate, j.no_language_required
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
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations))
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
    j.published_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

revoke all on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text
) from public;
grant execute on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text
) to anon, authenticated;

-- --- get_public_jobs_count (0091) + wyszukiwanie bez diakrytyków -------------------------------
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
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations))
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

revoke all on function public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text
) from public;
grant execute on function public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text
) to anon, authenticated;

-- --- get_public_job_filter_facets (0091) + wyszukiwanie bez diakrytyków -----------------------
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
      (select array_agg(distinct left(v,100)) from unnest(p_contract_types[1:100]) v where v <> '') contracts
  ), base as materialized (
    select j.id, j.category::text category, j.city, j.contract_type::text contract_type,
      j.accommodation, j.immediate, j.no_language_required
    from public.jobs j
    join public.companies c on c.id=j.company_id
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
    (s.locations is null or b.city=any(s.locations)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required)
  union all
  select 'category',b.category,count(*) from base b cross join selected s where
    (s.locations is null or b.city=any(s.locations)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) group by b.category
  union all
  select 'location',b.city,count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) group by b.city
  union all
  select 'contract',b.contract_type,count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) group by b.contract_type
  union all
  select 'accommodation',case when b.accommodation then 'provided' else 'unavailable' end,count(*)
    from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required)
    group by b.accommodation
  union all
  select 'additional','immediate',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and b.immediate and
    (coalesce(p_no_language,false)=false or b.no_language_required)
  union all
  select 'additional','no_language',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and b.no_language_required;
$$;

revoke all on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text) from public;
grant execute on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text) to anon, authenticated;
