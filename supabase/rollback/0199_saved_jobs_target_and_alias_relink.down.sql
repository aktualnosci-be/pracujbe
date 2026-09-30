-- =============================================================================
-- Rollback 0199_saved_jobs_target_and_alias_relink.sql (numer tymczasowy).
-- Przywraca: get_saved_jobs_display z 0162, brak strażnika celu zapisu i kolumny
-- saved_while_public, trigger relinku aliasów z 0153 (tylko INSERT) i brak strażnika wersji.
-- Powiązania jobs.location_id zostają (wartości zgodne ze słownikiem w chwili rollbacku).
-- Test: supabase/tests/saved-jobs-alias-relink-rollback.sql (scripts/test-rls.sh).
-- =============================================================================

-- Część B
drop trigger if exists trg_zz_jobs_location_only_keep_version on public.jobs;
drop function if exists public.jobs_location_only_keep_version();
drop trigger if exists trg_locations_relink_jobs on public.locations;
drop function if exists public.locations_relink_jobs();
drop trigger if exists trg_location_aliases_relink_jobs_upd on public.location_aliases;
drop trigger if exists trg_location_aliases_relink_jobs_del on public.location_aliases;

create or replace function public.location_aliases_relink_jobs()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.jobs j
     set location_id = public.resolve_location_id(j.city)
   where j.location_id is null
     and public.city_key(j.city) in (select n.alias_key from new_aliases n);
  return null;
end $$;
revoke all on function public.location_aliases_relink_jobs() from public, anon, authenticated;
drop trigger if exists trg_location_aliases_relink_jobs on public.location_aliases;
create trigger trg_location_aliases_relink_jobs
  after insert on public.location_aliases
  referencing new table as new_aliases
  for each statement execute function public.location_aliases_relink_jobs();

drop function if exists public.relink_jobs_for_city_keys(text[], uuid[]);

-- Część A
create or replace function public.get_saved_jobs_display(p_locale text default 'pl')
returns table (
  id uuid,
  slug text,
  title text,
  company_name text,
  city text,
  job_availability text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.id,
    case when v.availability = 'available' then j.slug end as slug,
    coalesce(t.title, j.title) as title,
    coalesce(c.name, '') as company_name,
    coalesce(j.city, '') as city,
    v.availability
  from public.saved_jobs s
  join public.jobs j on j.id = s.job_id
  left join public.companies c on c.id = j.company_id
  cross join lateral (
    select case
      when j.deleted_at is null and j.status = 'active'
           and (j.expires_at is null or j.expires_at > now())
           and c.status = 'verified' and c.deleted_at is null
        then 'available'
      when j.deleted_at is not null or j.status = 'closed' or c.deleted_at is not null
        then 'closed'
      when j.status = 'expired'
           or (j.status in ('active', 'paused') and j.expires_at is not null and j.expires_at <= now())
        then 'expired'
      when j.status = 'paused'
        then 'paused'
      else 'unavailable'
    end as availability
  ) v
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by
      (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
      (jt.locale = j.default_locale) desc,
      (jt.locale = 'en') desc
    limit 1
  ) t on true
  where s.candidate_id = auth.uid()
  order by s.created_at desc, j.id desc;
$$;
revoke all on function public.get_saved_jobs_display(text) from public, anon;
grant execute on function public.get_saved_jobs_display(text) to authenticated;

drop trigger if exists trg_saved_jobs_guard_target on public.saved_jobs;
drop function if exists public.saved_jobs_guard_target();
alter table public.saved_jobs drop column if exists saved_while_public;
