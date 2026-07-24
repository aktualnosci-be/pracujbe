-- =============================================================================
-- 0046_public_jobs_full_filters.sql
-- Remediacja audytu produkcyjnego 2026-07-24 — P1-12: pełne filtrowanie/sortowanie/paginacja
-- listy ofert PO STRONIE SQL. Wcześniej strona pobierała max 200 rekordów i filtrowała/sortowała/
-- paginowała w pamięci → po przekroczeniu 200 dopasowań oferty znikały, liczba stron była błędna,
-- a sort po pensji obejmował tylko wycinek. get_public_jobs(_count) dostają komplet filtrów
-- sidebara (kategorie/lokalizacje/typy umów/widełki/zakwaterowanie/od zaraz/bez języka/data)
-- oraz sort ('newest'|'salary'). Wynik, licznik i paginacja są teraz dokładne dla dowolnej skali.
--
-- Semantyka widełek (spójna z dotychczasowym matchesSidebar): oferta BEZ podanego wynagrodzenia
-- NIE jest wykluczana filtrem widełek; oferty z widełkami muszą się z zakresem pokrywać.
-- =============================================================================

-- Zmiana arności → najpierw usuń stare sygnatury (unikamy przeciążeń/„not unique").
drop function if exists public.get_public_jobs(text, text, text, text, text, integer, integer);
drop function if exists public.get_public_jobs_count(text, text, text, text, text);

create or replace function public.get_public_jobs(
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
  p_sort           text      default 'newest',
  p_limit          integer   default 20,
  p_offset         integer   default 0
)
returns table (
  id uuid, slug text, title text, company_name text, company_verified boolean,
  city text, region text, contract_type text, salary_min integer, salary_max integer,
  currency text, published_at timestamptz, highlights text[], category text,
  accommodation boolean, immediate boolean, no_language_required boolean
)
language sql stable security definer set search_path = public as $$
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
    j.accommodation, j.immediate, j.no_language_required
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title, jt.highlights
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when p_locale in ('pl','nl','fr','en') then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active' and j.deleted_at is null
    and c.status = 'verified' and c.deleted_at is null
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.city ilike '%' || left(p_city, 100) || '%')
    and (p_keyword is null or coalesce(t.title, j.title) ilike '%' || left(p_keyword, 100) || '%')
    and (
      (p_salary_min is null and p_salary_max is null)
      or (j.salary_min is null and j.salary_max is null)
      or (coalesce(j.salary_max, j.salary_min) >= coalesce(p_salary_min, 0)
          and coalesce(j.salary_min, j.salary_max) <= coalesce(p_salary_max, 2147483647))
    )
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
  order by
    (case when p_sort = 'salary' then coalesce(j.salary_max, j.salary_min) end) desc nulls last,
    j.published_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;
revoke all on function public.get_public_jobs(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, integer, integer) from public;
grant execute on function public.get_public_jobs(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, integer, integer) to anon, authenticated;

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
  p_since          timestamptz default null
) returns bigint language sql stable security definer set search_path = public as $$
  select count(*)::bigint
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when p_locale in ('pl','nl','fr','en') then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active' and j.deleted_at is null
    and c.status = 'verified' and c.deleted_at is null
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.city ilike '%' || left(p_city, 100) || '%')
    and (p_keyword is null or coalesce(t.title, j.title) ilike '%' || left(p_keyword, 100) || '%')
    and (
      (p_salary_min is null and p_salary_max is null)
      or (j.salary_min is null and j.salary_max is null)
      or (coalesce(j.salary_max, j.salary_min) >= coalesce(p_salary_min, 0)
          and coalesce(j.salary_min, j.salary_max) <= coalesce(p_salary_max, 2147483647))
    )
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since);
$$;
revoke all on function public.get_public_jobs_count(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz) from public;
grant execute on function public.get_public_jobs_count(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz) to anon, authenticated;
