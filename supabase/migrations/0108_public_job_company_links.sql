-- =============================================================================
-- 0108_public_job_company_links.sql — SEO (CLAUDE.md, Etap 2): JobPosting
-- `hiringOrganization.sameAs` / `logo` z danych firmy.
--
-- get_public_job zwraca dodatkowo `company_website` i `company_logo_url` (nowe kolumny na
-- końcu). Obie wartości:
--   - tylko dla firmy `verified` (funkcja i tak zwraca wyłącznie oferty zweryfikowanych firm;
--     warunek w kolumnie jest drugą, jawną bramką na wypadek zmiany filtra wierszy),
--   - tylko bezwzględny adres https bez danych logowania, z nazwą hosta z kropką, bez spacji,
--     cudzysłowów i nawiasów kątowych, najwyżej 2048 znaków (`public_https_url`);
--     każda inna wartość (http, javascript:, względny adres, pusty tekst) → null.
-- Reszta ciała = wierna kopia z 0052. Zmiana typu wyniku wymaga DROP + CREATE; EXECUTE po
-- odtworzeniu nadajemy jawnie anon/authenticated/service_role, bez PUBLIC (jak 0058).
--
-- Rollback: odtworzyć get_public_job z 0052 (drop + create) i
--           drop function public.public_https_url(text);  (bez zmian danych)
-- =============================================================================

-- Adres publikowany w danych strukturalnych: bezwzględny https albo null.
create or replace function public.public_https_url(p_url text)
returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case
    when length(btrim(p_url)) between 12 and 2048
     and btrim(p_url) ~ '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?([/?#][A-Za-z0-9._~!$&''()*+,;=:@%/?#-]*)?$'
    then btrim(p_url)
  end
$$;
revoke all on function public.public_https_url(text) from public;
grant execute on function public.public_https_url(text) to anon, authenticated, service_role;

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
  company_website text, company_logo_url text
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
    case when c.status = 'verified' then public.public_https_url(c.logo_url) end as company_logo_url
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

-- Jawne ACL jak po 0058 (definer bez PUBLIC EXECUTE; detal oferty woła anon).
revoke all on function public.get_public_job(text, text) from public;
grant execute on function public.get_public_job(text, text) to anon, authenticated, service_role;
