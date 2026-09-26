-- =============================================================================
-- 0140_public_company_profile.sql — #591: stabilna, publiczna strona profilu firmy.
--
-- Dotąd CTA „Dowiedz się więcej o firmie” na szczególe oferty prowadziło do wyszukiwarki
-- ofert po nazwie firmy (`?keyword=<companyName>`) — dopasowanie tekstowe mogło zwrócić
-- oferty INNEJ firmy o podobnej nazwie, nic (gdy tytuł/opis nie zawiera nazwy), albo
-- pomieszać wyniki bez jednoznacznego adresu. `companies.slug` (unikalny, ustawiany raz przy
-- zakładaniu firmy, NIE zmieniany przy zmianie nazwy — patrz `src/lib/actions/company.ts`)
-- już jest stabilnym identyfikatorem w publicznych URL, tylko nic go dotąd nie czytało
-- publicznie. Ta migracja:
--
--   1. `get_public_company(p_slug)` — profil TYLKO zweryfikowanej, nieusuniętej firmy
--      (jak każdy inny publiczny widok firmy): nazwa, opis, miasto/region/branża, logo i
--      strona (https, `public_https_url` z 0114) oraz liczba AKTYWNYCH, niewygasłych ofert.
--      Firma unverified/rejected/suspended/usunięta albo zły slug → brak wiersza (strona
--      renderuje 404 — Invariant #8, żadnych technikaliów).
--   2. `get_public_company_jobs(p_slug, p_locale, p_limit, p_offset)` — te same kolumny co
--      `get_public_jobs`, filtrowane po firmie (ten sam warunek co profil: verified + aktywna
--      + niewygasła oferta), limit/offset clamp jak w 0091.
--   3. `get_public_job` i `get_public_jobs` zwracają dodatkowo `company_slug` (na końcu listy
--      kolumn, jak `0114` dodało `company_website`/`company_logo_url``) — CTA na szczególe
--      oferty linkuje przez slug zamiast budować zapytanie do wyszukiwarki, a sitemap (#591)
--      dodaje profile firm bez osobnego zapytania (zbiera sluga przy iteracji po ofertach, którą
--      już robi). Bez sluga (nie powinno się zdarzyć dla zweryfikowanej firmy, ale bezpiecznik na
--      wszelki wypadek) strona ukrywa CTA zamiast linkować donikąd.
--
-- Rollback: NOWA migracja naprawcza —
--   drop function if exists public.get_public_company(text);
--   drop function if exists public.get_public_company_jobs(text, text, integer, integer);
--   odtworzyć get_public_job z 0114 i get_public_jobs z 0110 (drop + create, bez company_slug).
-- Migracja nie zmienia danych.
-- =============================================================================

-- --- get_public_company ------------------------------------------------------------------
create or replace function public.get_public_company(p_slug text)
returns table (
  id uuid, slug text, name text, description text, city text, region text, industry text,
  logo_url text, website text, active_jobs_count bigint
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    c.id, c.slug, c.name, coalesce(c.description, '') as description,
    c.city, c.region, c.industry,
    public.public_https_url(c.logo_url) as logo_url,
    public.public_https_url(c.website) as website,
    (
      select count(*) from public.jobs j
      where j.company_id = c.id and j.status = 'active' and j.deleted_at is null
        and (j.expires_at is null or j.expires_at > now())
    ) as active_jobs_count
  from public.companies c
  where c.slug = p_slug
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;

revoke all on function public.get_public_company(text) from public;
grant execute on function public.get_public_company(text) to anon, authenticated, service_role;

-- --- get_public_company_jobs -------------------------------------------------------------
create or replace function public.get_public_company_jobs(
  p_slug   text,
  p_locale text default 'pl',
  p_limit  integer default 20,
  p_offset integer default 0
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
    true as company_verified,
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
  where c.slug = p_slug
    and c.status = 'verified' and c.deleted_at is null
    and j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
  order by j.published_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

revoke all on function public.get_public_company_jobs(text, text, integer, integer) from public;
grant execute on function public.get_public_company_jobs(text, text, integer, integer)
  to anon, authenticated, service_role;

-- --- get_public_job: + company_slug ------------------------------------------------------
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
  company_website text, company_logo_url text, company_slug text
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
    case when c.status = 'verified' then c.slug end as company_slug
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

-- --- get_public_jobs: + company_slug (#591, sitemap firm bez osobnego zapytania) ---------
drop function if exists public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text
);

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
    j.published_at desc,
    -- #594 (0136): tie-breaker deterministyczny (PK, unikalny) — bez niego remis na kluczu
    -- wynagrodzenia/dacie publikacji może zmieniać kolejność między wywołaniami i ciąć
    -- grupę remisową w innym miejscu przy offsetowej paginacji (pominięcia/duplikaty).
    j.id desc
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
