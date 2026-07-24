-- =============================================================================
-- 0034_match_profile_remote.sql
-- Remediacja audytu 2026-07-24 — Wave F/FUN-06: silnik dopasowania uwzględnia pracę zdalną.
-- get_job_match_profile zwraca teraz `remote` (jobs.remote) — praca zdalna znosi ograniczenie
-- lokalizacji w scoreMatch (pełne punkty), zamiast karać kandydata za odległość.
-- Zmiana kontraktu RETURNS TABLE → DROP + CREATE.
-- =============================================================================

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
  certificates text[]
) language sql stable security definer set search_path = public as $$
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
