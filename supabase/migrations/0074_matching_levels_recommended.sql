-- =============================================================================
-- 0074 — dopasowanie: poziomy języków, dostępność „w ciągu 2 tygodni",
--        polecane oferty po ID dopasowań (#195, #190, #196).
--
-- 1. availability_status += 'within_two_weeks' (#190). Formularz aplikowania miał dwie
--    opcje („za 2 tygodnie", „za miesiąc") zapisywane jako ta sama wartość within_month.
--    Istniejące rekordy within_month zostają bez zmian. Nowa wartość nie jest używana
--    w tej migracji (ALTER TYPE ... ADD VALUE w transakcji).
-- 2. get_job_match_profile zwraca dodatkowo `language_requirements` (jsonb:
--    [{label, level}]) — poziom wymagany przez ofertę trafia do scoreMatch (#195).
--    Kolumna `languages` bez zmian (zgodność). Zmiana RETURNS TABLE → DROP + CREATE.
-- 3. get_public_jobs_by_ids(p_ids, p_locale) — publiczne dane dokładnie dla podanych ofert,
--    z tymi samymi filtrami widoczności co get_public_jobs (active, nieusunięta, niewygasła,
--    firma verified). Polecane oferty kandydata nie są już ograniczone do 100 najnowszych (#196).
--
-- Rollback: odtworzyć get_job_match_profile z 0034, `drop function
-- public.get_public_jobs_by_ids(uuid[], text)`. Wartości enuma nie da się usunąć bez
-- przebudowy typu — pozostaje nieużywana po rollbacku aplikacji. Migracja nie zmienia danych.
-- =============================================================================

alter type public.availability_status add value if not exists 'within_two_weeks' after 'immediate';

drop function if exists public.get_job_match_profile(uuid);
create function public.get_job_match_profile(p_job_id uuid)
returns table (
  occupation text,
  category text,
  city text,
  region text,
  remote boolean,
  min_experience_years integer,
  requires_driving_license boolean,
  contract_type text,
  start_immediately boolean,
  skills text[],
  mandatory_skills text[],
  languages text[],
  certificates text[],
  language_requirements jsonb
) language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.occupation,
    j.category::text,
    j.city,
    j.region,
    j.remote,
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
                   where jc.job_id = j.id order by jc.certificate_label), '{}'::text[]),
    coalesce((select jsonb_agg(jsonb_build_object('label', jl.language_label, 'level', jl.level::text)
                               order by jl.language_label)
              from public.job_languages jl where jl.job_id = j.id), '[]'::jsonb)
  from public.jobs j
  join public.companies c on c.id = j.company_id
  where j.id = p_job_id
    and j.status = 'active'
    and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;
revoke all on function public.get_job_match_profile(uuid) from public;
grant execute on function public.get_job_match_profile(uuid) to authenticated;

create or replace function public.get_public_jobs_by_ids(
  p_ids    uuid[],
  p_locale text default 'pl'
)
returns table (id uuid, slug text, title text, company_name text, city text)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.id, j.slug,
    coalesce(t.title, j.title) as title,
    c.name as company_name,
    j.city
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
  -- Twardy sufit: najwyżej 100 identyfikatorów na wywołanie.
  where j.id = any(p_ids[1:100])
    and j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified' and c.deleted_at is null
  order by j.id;
$$;
revoke all on function public.get_public_jobs_by_ids(uuid[], text) from public;
grant execute on function public.get_public_jobs_by_ids(uuid[], text) to anon, authenticated;
