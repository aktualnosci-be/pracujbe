-- =============================================================================
-- 0048_offer_expiry_public.sql
-- Remediacja audytu 2026-07-24 (AUDIT_REPORT) — P1-11: WYGASŁE oferty pozostają publiczne
-- i przyjmują aplikacje. Status 'active' nie jest automatycznie zmieniany po `expires_at`
-- (brak crona), a publiczne RPC/`job_is_public` nie sprawdzały daty ważności.
--
-- Naprawa: dodajemy warunek `(expires_at is null or expires_at > now())` do:
--   - job_is_public          → apply_to_job odrzuci aplikację na wygasłą ofertę,
--   - get_public_jobs/_count  → wygasła oferta znika z listy i licznika,
--   - get_public_job          → detal wygasłej oferty nie jest zwracany (404).
-- Funkcje odtworzone wiernie (z 0009/0046/0030) + jeden warunek WHERE. Bez zmian kontraktu.
-- =============================================================================

-- --- job_is_public (0009) + expiry ---------------------------------------------
create or replace function public.job_is_public(p_job_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job_id
      and j.status = 'active'
      and j.deleted_at is null
      and (j.expires_at is null or j.expires_at > now())
  );
$$;

-- --- get_public_jobs (0046) + expiry -------------------------------------------
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
    and (j.expires_at is null or j.expires_at > now())
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

-- --- get_public_jobs_count (0046) + expiry -------------------------------------
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
    and (j.expires_at is null or j.expires_at > now())
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

-- --- get_public_job (0030) + expiry (kontrakt bez zmian) -----------------------
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
    coalesce(array(select jl.language_label from public.job_languages jl
                   where jl.job_id = j.id order by jl.language_label), '{}'::text[]) as languages,
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
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;
