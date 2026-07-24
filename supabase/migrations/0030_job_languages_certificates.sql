-- =============================================================================
-- 0030_job_languages_certificates.sql
-- Remediacja audytu 2026-07-24 — Wave E2: FUN-03 (kreator przyjmował języki i certyfikaty
--   oferty, ale ich nie zapisywał; publiczny detal zawsze zwracał pustą listę języków, a
--   matching nie mógł uwzględnić realnych wymagań językowych/certyfikatów).
--
-- Dodajemy relacje job_languages / job_certificates (analogicznie do job_skills), wpinamy je
-- w publiczny detal oferty (get_public_job.languages) oraz profil dopasowania
-- (get_job_match_profile.languages/certificates). Persystencja z kreatora — w warstwie app.
-- =============================================================================

-- --- Tabele relacji wymagań oferty --------------------------------------------
create table if not exists public.job_languages (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs(id) on delete cascade,
  language_label text not null,
  level          public.language_level,
  created_at     timestamptz not null default now(),
  unique (job_id, language_label)
);
create index if not exists idx_job_languages_job on public.job_languages(job_id);

create table if not exists public.job_certificates (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs(id) on delete cascade,
  certificate_label text not null,
  created_at        timestamptz not null default now(),
  unique (job_id, certificate_label)
);
create index if not exists idx_job_certificates_job on public.job_certificates(job_id);

-- Twarde sufity długości (spójnie z SEC-04, path-independent).
alter table public.job_languages    add constraint job_languages_label_len    check (length(language_label) <= 80);
alter table public.job_certificates add constraint job_certificates_label_len check (length(certificate_label) <= 160);

-- --- RLS: odczyt gdy oferta publiczna lub członek firmy; zapis = członek firmy -
-- (Dokładnie ten sam wzorzec co job_translations/job_requirements/job_skills w 0009.)
do $$
declare
  t text;
  child text[] := array['job_languages', 'job_certificates'];
begin
  foreach t in array child loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for select to anon, authenticated
        using (public.job_is_public(job_id) or public.is_job_company_member(job_id));
    $f$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I;', t || '_insert_member', t);
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (public.is_job_company_member(job_id));
    $f$, t || '_insert_member', t);

    execute format('drop policy if exists %I on public.%I;', t || '_update_member', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (public.is_job_company_member(job_id))
        with check (public.is_job_company_member(job_id));
    $f$, t || '_update_member', t);

    execute format('drop policy if exists %I on public.%I;', t || '_delete_member', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (public.is_job_company_member(job_id));
    $f$, t || '_delete_member', t);
  end loop;
end $$;

-- --- Publiczny detal: realne języki oferty (zamiast pustej listy) --------------
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
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;

-- --- Profil dopasowania: realne języki i certyfikaty oferty --------------------
-- Zmiana kontraktu RETURNS TABLE → DROP + CREATE.
drop function if exists public.get_job_match_profile(uuid);
create function public.get_job_match_profile(p_job_id uuid)
returns table (
  occupation text,
  category text,
  city text,
  region text,
  min_experience_years integer,
  requires_driving_license boolean,
  contract_type text,
  start_immediately boolean,
  skills text[],
  mandatory_skills text[],
  languages text[],
  certificates text[]
) language sql stable security definer set search_path = public as $$
  select
    j.occupation,
    j.category::text,
    j.city,
    j.region,
    j.min_experience_years,
    j.requires_driving_license,
    j.contract_type::text,
    j.start_immediately,
    coalesce(array(select js.skill_label from public.job_skills js
                   where js.job_id = j.id order by js.skill_label), '{}'::text[]),
    coalesce(array(select js.skill_label from public.job_skills js
                   where js.job_id = j.id and js.is_mandatory order by js.skill_label), '{}'::text[]),
    coalesce(array(select jl.language_label from public.job_languages jl
                   where jl.job_id = j.id order by jl.language_label), '{}'::text[]),
    coalesce(array(select jc.certificate_label from public.job_certificates jc
                   where jc.job_id = j.id order by jc.certificate_label), '{}'::text[])
  from public.jobs j
  join public.companies c on c.id = j.company_id
  where j.id = p_job_id
    and j.status = 'active'
    and j.deleted_at is null
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;
revoke all on function public.get_job_match_profile(uuid) from public;
grant execute on function public.get_job_match_profile(uuid) to authenticated;
