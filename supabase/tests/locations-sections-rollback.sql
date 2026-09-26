-- =============================================================================
-- SEC-R — rollback migracji 0191 (części gmin). Uruchamiany przez scripts/test-rls.sh po
-- rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select md5(string_agg(concat_ws('|', l.slug, l.name, l.latitude, l.longitude, l.kind, l.refnis), ',' order by l.slug))
  as locmun from public.locations l where l.kind <> 'section' \gset
select md5(string_agg(concat_ws('|', a.alias_key, l.slug), ',' order by a.alias_key))
  as aliasmun from public.location_aliases a join public.locations l on l.id = a.location_id
 where l.kind <> 'section' \gset

begin;
\ir ../rollback/0191_locations_be_sections.down.sql
select pg_temp.assert(
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'locations' and column_name = 'parent_location_id')
  and to_regprocedure('public.locations_section_parent_guard()') is null
  and (select md5(string_agg(concat_ws('|', l.slug, l.name, l.latitude, l.longitude, l.kind, l.refnis), ',' order by l.slug))
         from public.locations l) = :'locmun'
  and (select md5(string_agg(concat_ws('|', a.alias_key, l.slug), ',' order by a.alias_key))
         from public.location_aliases a join public.locations l on l.id = a.location_id) = :'aliasmun'
  and not exists (select 1 from public.location_aliases where alias_key = 'heverlee'),
  'SEC-R rollback usuwa tylko części gmin, gminy i ich aliasy bez zmian');
rollback;
select pg_temp.assert((select count(*) from public.locations where kind = 'section') > 1500
  and exists (select 1 from public.location_aliases where alias_key = 'heverlee'),
  'SEC-R2 rollback testu cofnięty');
\echo 'SEC-R rollback 0191: PASS'
