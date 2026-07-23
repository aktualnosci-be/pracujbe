-- =============================================================================
-- 0014_public_job_views.sql
-- P1-01 / P1-02 — publiczny dostęp do ofert/firm wyłącznie przez bezpieczne RPC.
--   * P1-01: anon NIE może już czytać wprost tabel companies/jobs (wyciek VAT, e-mail,
--            telefonu, contact_email, created_by, verified_by przez select=*).
--   * P1-02: RPC zwracają kompletny, znormalizowany kontrakt (join firmy + tłumaczeń +
--            wymagań) z fallbackiem locale — zgodny z mapperem w src/lib/jobs.ts.
-- Kolumny prywatne (kontakt/rejestrowe) NIE są zwracane publicznie.
-- =============================================================================

-- Publiczny odczyt tabel bazowych: usuwamy politykę wierszową dla anon/authenticated.
-- Członkowie firmy nadal czytają swoje dane przez polityki *_select_member.
drop policy if exists companies_select_public on public.companies;
drop policy if exists jobs_select_public on public.jobs;

-- Anon nie ma już żadnego dostępu do tabel bazowych (dane publiczne tylko przez RPC).
revoke select on public.companies from anon;
revoke select on public.jobs from anon;

-- --- Lista ofert (bezpieczne kolumny + tłumaczenie wg locale) ----------------
create or replace function public.get_public_jobs(
  p_locale text default 'pl',
  p_keyword text default null,
  p_city text default null,
  p_category text default null,
  p_contract_type text default null,
  p_limit integer default 20,
  p_offset integer default 0
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
    order by (jt.locale = p_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active'
    and j.deleted_at is null
    and c.status = 'verified'
    and c.deleted_at is null
    and (p_category is null or j.category::text = p_category)
    and (p_contract_type is null or j.contract_type::text = p_contract_type)
    and (p_city is null or j.city ilike '%' || p_city || '%')
    and (p_keyword is null or coalesce(t.title, j.title) ilike '%' || p_keyword || '%')
  order by j.published_at desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

-- --- Licznik ofert (do paginacji) -------------------------------------------
create or replace function public.get_public_jobs_count(
  p_keyword text default null,
  p_city text default null,
  p_category text default null,
  p_contract_type text default null
)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)::bigint
  from public.jobs j
  join public.companies c on c.id = j.company_id
  where j.status = 'active' and j.deleted_at is null
    and c.status = 'verified' and c.deleted_at is null
    and (p_category is null or j.category::text = p_category)
    and (p_contract_type is null or j.contract_type::text = p_contract_type)
    and (p_city is null or j.city ilike '%' || p_city || '%')
    and (p_keyword is null or j.title ilike '%' || p_keyword || '%');
$$;

-- --- Szczegóły oferty (pełny kontrakt detalu) -------------------------------
create or replace function public.get_public_job(p_slug text, p_locale text default 'pl')
returns table (
  id uuid, slug text, title text, company_name text, company_verified boolean,
  city text, region text, contract_type text, salary_min integer, salary_max integer,
  currency text, published_at timestamptz, highlights text[], category text,
  accommodation boolean, immediate boolean, no_language_required boolean,
  description text, responsibilities text[], requirements_mandatory text[],
  requirements_optional text[], conditions text[], working_hours text, shifts text,
  languages text[], transport boolean, start_date date, company_description text
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
    '{}'::text[] as languages,             -- brak relacji job_languages (TODO: gdy powstanie)
    j.transport, j.start_date,
    coalesce(t.company_description, c.description, '') as company_description
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
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;

-- Publiczny dostęp do danych ofert wyłącznie przez te RPC (anon + authenticated).
grant execute on function public.get_public_jobs(text, text, text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.get_public_jobs_count(text, text, text, text) to anon, authenticated;
grant execute on function public.get_public_job(text, text) to anon, authenticated;
