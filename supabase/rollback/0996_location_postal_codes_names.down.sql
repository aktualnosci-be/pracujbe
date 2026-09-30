-- =============================================================================
-- Rollback 0996 — miasto oferty z dopiskiem i nazwy miejscowości w języku widoku (#1119).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy usunąć
-- wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT
-- (supabase/tests/location-postal-names-rollback.sql wykonuje go w transakcji i cofa).
-- Przywraca resolve_location_id i location_aliases_relink_jobs z 0153 oraz location_filter_ids
-- z 0183, usuwa location_names, location_display_name i location_lookup_key. Oferty rozpoznane
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
