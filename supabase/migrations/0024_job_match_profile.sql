-- =============================================================================
-- 0024_job_match_profile.sql
-- Etap 5 — integracja silnika dopasowania z UI (deterministyczny `scoreMatch`).
--
-- RPC zwraca ZNORMALIZOWANE tokeny wymagań oferty (umiejętności + wymiary), których
-- potrzebuje TS-owy silnik `src/lib/matching/score.ts` do policzenia dopasowania
-- kandydata do oferty NA ŻYWO (z realnego profilu, nie z prekalkulowanej tabeli `matches`).
--
-- Bezpieczeństwo: dane oferty są publiczne tylko przez RPC (P1-01/02). Zwracamy WYŁĄCZNIE
-- pola potrzebne do matchu (bez kolumn kontaktowych/rejestrowych), i tylko dla ofert
-- widocznych publicznie (active + firma verified) — jak `get_public_job`. Grant tylko dla
-- `authenticated` (match jest personalny; anon nie ma profilu). Kandydat czyta WŁASNY profil
-- osobno pod RLS; scoring dzieje się w warstwie serwera (TS), nie w SQL.
-- =============================================================================

create or replace function public.get_job_match_profile(p_job_id uuid)
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
  mandatory_skills text[]
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
    coalesce(
      array(select js.skill_label from public.job_skills js
            where js.job_id = j.id order by js.skill_label),
      '{}'::text[]
    ),
    coalesce(
      array(select js.skill_label from public.job_skills js
            where js.job_id = j.id and js.is_mandatory order by js.skill_label),
      '{}'::text[]
    )
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
