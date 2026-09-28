-- 0956_public_jobs_updated_at.sql — numer tymczasowy (ostateczny nada integrator).
--
-- #796: sitemap ofert ustawiał `lastmod` wyłącznie z `published_at`. Po istotnej edycji
-- opublikowanej oferty (`update_published_job`, 0077/0144) baza aktualizuje `jobs.updated_at`,
-- ale publiczny `get_public_jobs` nie zwracał tej kolumny, więc każda wersja językowa URL-a
-- nadal wskazywała dzień pierwotnej publikacji, niezależnie od liczby późniejszych edycji treści.
--
-- Zmiana: `get_public_jobs` zwraca dodatkowo `updated_at` (kolumna z `jobs`, bez zmiany
-- semantyki pozostałych pól ani filtrów/sortowania). Definicja = NAJNOWSZA z 0167 (filtr
-- „bezpośrednio od pracodawcy” `p_direct_only`, miejscowość kanoniczna 0153, blokada firmy #97)
-- z jedną dodaną kolumną wyniku; `create or replace` jest niemożliwe przy zmianie listy kolumn
-- wyniku, więc `drop function` + ponowne utworzenie z tą samą sygnaturą argumentów (17).
-- Blok FROM … WHERE zostaje kopią 1:1, więc `saved_search_jobs_after` (0158) nie wymaga zmian.
-- `src/lib/jobs.ts` (`rowToJobListItem`) mapuje nowe pole jako `updatedAt`, a
-- `src/app/sitemap.ts` liczy `lastModified` z `updatedAt` (fallback na `publishedAt`, gdy pole
-- nieobecne — dane demonstracyjne, błąd odczytu, starsze wiersze RPC).
--
-- `get_public_jobs_count`, `get_public_job` i `get_public_company_jobs` nie są tu zmieniane —
-- `updated_at` służy wyłącznie liście używanej przez sitemap (#796).
--
-- Rollback: `drop function public.get_public_jobs(text, text, text, text[], text[], text[],
--   integer, integer, boolean, boolean, boolean, timestamptz, text, integer, integer, text,
--   boolean);` + odtworzyć wersję z 0167 (bez `updated_at`).

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
  p_direct_only    boolean     default null
)
returns table (
  id uuid, slug text, title text, company_name text, company_verified boolean,
  city text, region text, contract_type text, salary_min integer, salary_max integer,
  currency text, salary_period text, published_at timestamptz, highlights text[], category text,
  accommodation boolean, immediate boolean, no_language_required boolean, company_slug text,
  updated_at timestamptz
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
    c.slug as company_slug,
    j.updated_at
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
    -- 0167: „bezpośrednio od pracodawcy” = firma nie jest agencją pracy tymczasowej.
    and (coalesce(p_direct_only, false) = false or not c.is_agency)
  order by
    (case when p_sort = 'salary' then public.job_salary_sort_key(
      j.salary_min, j.salary_max, j.salary_period, p_salary_unit) end) desc nulls last,
    j.published_at desc,
    -- #594 (0136): tie-breaker deterministyczny (PK, unikalny).
    j.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;
revoke all on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean
) from public;
grant execute on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean
) to anon, authenticated;
