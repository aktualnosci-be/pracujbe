-- =============================================================================
-- 0211 (NUMER TYMCZASOWY — ostateczny nada integrator) — alerty zapisanych wyszukiwań
-- bez górnej granicy 10 100 ofert na przebieg (#100).
--
-- Problem (0138): saved_search_matching_jobs zbierał strony get_public_jobs po OFFSECIE.
-- get_public_jobs klampuje p_offset do 10 000 (limit publicznej listy), więc w jednym
-- przebiegu worker widział najwyżej 101 stron = 10 100 ofert na wyszukiwanie. Watermark
-- przesuwał się na czas przebiegu, więc oferty 10 101+ (najstarsze w oknie) przepadały.
--
-- Zmiana:
--   1. saved_search_jobs_after(...) — wewnętrzna strona z KURSOREM (published_at, id):
--      te same parametry filtrów co get_public_jobs i ten sam blok FROM … WHERE
--      (skopiowany 1:1; zgodność pilnuje test tests/unit/saved-search-keyset-sync.test.ts —
--      zmiana filtrów get_public_jobs bez tej funkcji = czerwony test) + warunek kursora
--      `(published_at, id) < (p_after_published_at, p_after_id)` w porządku listy
--      „najnowsze” (published_at desc, id desc). Bez offsetu, bez sufitu.
--   2. saved_search_keyset_page(filtry jsonb, …) — jedna strona (1000 ofert) z kanonicznymi
--      filtrami v1 (jak saved_search_job_page z 0138) jako (ids w kolejności, kursor końca).
--   3. saved_search_matching_jobs — rekurencyjne CTE po kursorze zamiast offsetu, w JEDNYM
--      zapytaniu (jeden snapshot: oferta zamknięta/opublikowana w trakcie przebiegu nie
--      przesuwa stron). p_max_pages domyślnie NULL = bez limitu (liczba stron kursora,
--      nie offsetu). Sygnatura bez zmian, więc process_saved_search_alerts (0138) działa
--      dalej bez zmian: pomijanie firm zablokowanych, rejestr (wyszukiwanie, oferta) z PK,
--      digest ≤ 5 ofert, count = wszystkie nowe, jedno in-app i jeden e-mail na przebieg.
--   Publiczny kontrakt get_public_jobs (lista ofert, clamp limitu/offsetu) — BEZ ZMIAN.
--   saved_search_job_page (0138) zostaje (nieużywane przez workera; kontrola ujemna testu).
--
-- Warunek `j.published_at is not null`: kursor wymaga klucza; worker zawsze podaje p_since,
-- a `published_at >= p_since` i tak wyklucza NULL — wynik dla workera bez zmian.
--
-- Dowód: supabase/tests/rls.sql sekcja SK100 (10 150 ofert z jednym published_at; kontrola
-- ujemna: wariant z offsetem z 0138 gubi 50 ofert).
-- Rollback: odtwórz saved_search_matching_jobs z 0138 (create or replace, default 101),
-- drop function saved_search_keyset_page(jsonb, text, timestamptz, timestamptz, uuid, integer),
-- saved_search_jobs_after(text, text, text, text[], text[], text[], integer, integer,
--   boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer).
-- =============================================================================

-- --- Strona z kursorem: filtry = get_public_jobs (0140), porządek „najnowsze” -----------
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
  p_limit               integer
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
  -- END get_public_jobs filters
    -- Kursor (published_at, id): strona zaczyna się ZA ostatnią ofertą poprzedniej strony.
    and j.published_at is not null
    and (p_after_published_at is null
         or (j.published_at, j.id) < (p_after_published_at, p_after_id))
  order by j.published_at desc, j.id desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

-- --- Jedna strona kursora z kanonicznymi filtrami v1 (0092) -------------------------------
-- Zwraca jeden wiersz: identyfikatory w porządku listy i kursor ostatniej oferty strony.
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
    p_limit              => least(greatest(coalesce(p_page_size, 1000), 1), 1000)
  ) k;
$$;

-- --- Wszystkie pasujące oferty zapisanego wyszukiwania — kursor zamiast offsetu ----------
-- Sygnatura jak w 0138 (worker bez zmian). p_max_pages = liczba stron kursora (po 1000),
-- NULL = bez limitu.
create or replace function public.saved_search_matching_jobs(
  p_filters   jsonb,
  p_locale    text,
  p_since     timestamptz,
  p_max_pages integer default null
) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive pages(page_no, ids, last_published_at, last_id) as (
    select 1, p.ids, p.last_published_at, p.last_id
    from public.saved_search_keyset_page(p_filters, p_locale, p_since, null, null, 1000) p
    union all
    select pg.page_no + 1, p.ids, p.last_published_at, p.last_id
    from pages pg
    cross join lateral public.saved_search_keyset_page(
      p_filters, p_locale, p_since, pg.last_published_at, pg.last_id, 1000) p
    where cardinality(pg.ids) = 1000
      and (p_max_pages is null or pg.page_no < greatest(p_max_pages, 1))
  )
  select distinct unnest(ids) from pages;
$$;

revoke all on function public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer
) from public, anon, authenticated;
grant execute on function public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer
) to service_role;
revoke all on function public.saved_search_keyset_page(jsonb, text, timestamptz, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.saved_search_keyset_page(jsonb, text, timestamptz, timestamptz, uuid, integer)
  to service_role;
revoke all on function public.saved_search_matching_jobs(jsonb, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.saved_search_matching_jobs(jsonb, text, timestamptz, integer) to service_role;
