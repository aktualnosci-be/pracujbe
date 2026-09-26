-- =============================================================================
-- 0136_public_jobs_deterministic_pagination.sql — numer nadany w kolejce integratora (wcześniej
-- tymczasowy 0150). #594: `get_public_jobs` sortuje po `published_at` (i opcjonalnie po kluczu
-- wynagrodzenia), ale bez unikalnego tie-breakera. Oferty z remisem na kolumnie sortowania
-- mogą wrócić w innej kolejności między kolejnymi wywołaniami (nowy plan, równoległy skan,
-- zmiana danych), co przy paginacji offsetowej gubi albo dubluje wiersze na sąsiednich
-- stronach. #593 (uzupełnienie): offset ponad 10 000 jest klampowany do 10 000 (0026,
-- anty-abuse) — każda strona POZA rzeczywistą granicą danych musi jawnie kończyć listę,
-- a nie cicho powtarzać tego samego, klampowanego wycinka. Backend (`src/lib/db/public-jobs.ts`)
-- przestaje wołać RPC z naturalnym offsetem > 10 000: taka strona zwraca pusty wynik zamiast
-- zduplikowanego, a `getPublicJobsMaxPage` ogranicza nawigację/redirect (#228) do ostatniej
-- rzeczywiście osiągalnej strony — total (licznik) zostaje dokładny.
--
-- Zmiana w tej migracji dotyczy WYŁĄCZNIE `get_public_jobs` (zwraca wiersze — jedyna funkcja
-- z ORDER BY do paginacji; `get_public_jobs_count` i `get_public_job_filter_facets` agregują
-- bez porządku wynikowego, więc tie-breaker jest dla nich bez znaczenia): dopisany `j.id desc`
-- na końcu ORDER BY (po kluczu wynagrodzenia i po dacie publikacji) — unikalny PK, więc
-- kolejność jest teraz w pełni deterministyczna dla danego zestawu filtrów i sortowania.
-- Sygnatura, domyślne wartości, granty i pozostała semantyka filtrów bez zmian (`create or
-- replace`), więc aplikacja nie wymaga migracji parametrów.
--
-- Rollback: NOWA migracja naprawcza — `create or replace function public.get_public_jobs(...)`
-- z ciałem z 0110 (bez `j.id desc` w ORDER BY), ta sama sygnatura. Migracja nie zmienia danych.
-- Nie edytować tej migracji po zastosowaniu.
-- =============================================================================

-- --- get_public_jobs (0110) + deterministyczny tie-breaker `j.id` ---------------------------
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
    j.published_at desc,
    -- #594: tie-breaker deterministyczny (PK, unikalny) — bez niego remis na kluczu
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
