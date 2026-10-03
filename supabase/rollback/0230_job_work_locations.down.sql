-- Rollback 0230_job_work_locations.sql (#850): usuwa dodatkowe miejsca pracy ofert,
-- RPC i triggery; `search_city_candidates` wraca do definicji z 0183.
drop trigger if exists trg_job_duplications_copy_work_locations on public.job_duplications;
drop function if exists public.job_duplications_copy_work_locations();
drop trigger if exists trg_location_aliases_relink_work_locations on public.location_aliases;
drop function if exists public.job_work_locations_relink_alias();
drop function if exists public.get_public_job_work_locations(uuid);
drop function if exists public.set_job_work_locations(uuid, text[]);

-- search_city_candidates — stan 0183 (przed tabelą, bo nowa definicja jej używa).
create or replace function public.search_city_candidates(p_city text)
returns setof uuid language sql stable strict
set search_path = public, pg_temp as $$
  select j.id from public.jobs j
  where j.status = 'active' and j.deleted_at is null
    and public.search_fold(j.city) like public.search_like_pattern(p_city) escape '\'
  union
  select j.id from public.jobs j
  where j.status = 'active' and j.deleted_at is null
    and j.location_id in (select unnest(public.location_filter_ids(array[left(p_city, 200)])));
$$;
revoke all on function public.search_city_candidates(text) from public;

drop table if exists public.job_work_locations;
drop function if exists public.job_work_locations_normalize();
