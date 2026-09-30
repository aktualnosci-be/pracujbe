-- =============================================================================
-- Rollback 0996 — miasto oferty z dopiskiem i nazwy miejscowości w języku widoku (#1119).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy usunąć
-- wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT
-- (supabase/tests/location-postal-names-rollback.sql wykonuje go w transakcji i cofa).
-- Przywraca resolve_location_id z 0153, location_filter_ids z 0183 i relink_jobs_for_city_keys
-- z 0199, usuwa location_names, location_display_name i location_lookup_key. Oferty rozpoznane
-- tylko po kluczu bez dopisku wracają do location_id = null (bez podbicia updated_at).
-- Aplikacja po rollbacku: zapytanie facetów (src/lib/db/public-jobs.ts) i podpowiedź miasta
-- (src/lib/actions/job-location.ts) wołają location_display_name — wycofać razem z kodem.
-- =============================================================================

create or replace function public.resolve_location_id(p_city text)
returns uuid language sql stable parallel safe security definer set search_path = public, pg_temp as $$
  select a.location_id
  from public.location_aliases a
  join public.locations l on l.id = a.location_id and l.is_active
  where a.alias_key = public.city_key(left(p_city, 200))
  limit 1;
$$;
revoke all on function public.resolve_location_id(text) from public;
grant execute on function public.resolve_location_id(text) to anon, authenticated, service_role;

create or replace function public.location_filter_ids(p_values text[])
returns uuid[] language sql stable parallel safe security definer set search_path = public, pg_temp as $$
  with matched as (
    select distinct a.location_id
    from unnest(p_values[1:100]) v
    join public.location_aliases a on a.alias_key = public.city_key(left(v, 200))
    join public.locations l on l.id = a.location_id and l.is_active
  )
  select coalesce(array_agg(distinct x.location_id), '{}'::uuid[])
  from (
    select m.location_id from matched m
    union
    select s.id from matched m
    join public.locations s on s.parent_location_id = m.location_id and s.is_active
  ) x;
$$;
revoke all on function public.location_filter_ids(text[]) from public;
grant execute on function public.location_filter_ids(text[]) to anon, authenticated, service_role;

create or replace function public.relink_jobs_for_city_keys(p_keys text[], p_location_ids uuid[] default '{}')
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  if coalesce(array_length(p_keys, 1), 0) = 0 and coalesce(array_length(p_location_ids, 1), 0) = 0 then
    return 0;
  end if;
  update public.jobs j
     set location_id = r.location_id
    from (
      select j2.id, public.resolve_location_id(j2.city) as location_id
        from public.jobs j2
       where (public.city_key(j2.city) = any(coalesce(p_keys, '{}'))
              or j2.location_id = any(coalesce(p_location_ids, '{}')))
    ) r
   where j.id = r.id
     and j.location_id is distinct from r.location_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.relink_jobs_for_city_keys(text[], uuid[]) from public, anon, authenticated;
grant execute on function public.relink_jobs_for_city_keys(text[], uuid[]) to service_role;

drop function if exists public.location_display_name(text, text);
drop table if exists public.location_names;
drop function if exists public.location_lookup_key(text);

alter table public.jobs disable trigger trg_set_updated_at;
alter table public.jobs disable trigger trg_strict_job_version;
update public.jobs
   set location_id = public.resolve_location_id(city)
 where location_id is distinct from public.resolve_location_id(city);
alter table public.jobs enable trigger trg_set_updated_at;
alter table public.jobs enable trigger trg_strict_job_version;
