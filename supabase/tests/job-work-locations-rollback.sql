-- =============================================================================
-- JWL850-R — rollback migracji 0230 (dodatkowe miejsca pracy oferty, #850). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql; rollback w transakcji cofanej, baza zostaje po 0230.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  to_regclass('public.job_work_locations') is not null
  and to_regprocedure('public.set_job_work_locations(uuid, text[])') is not null
  and position('job_work_locations' in pg_get_functiondef('public.search_city_candidates(text)'::regprocedure)) > 0,
  'JWL850-R0 baza w stanie po 0230');

begin;
\ir ../rollback/0230_job_work_locations.down.sql
select pg_temp.assert(
  to_regclass('public.job_work_locations') is null
  and to_regprocedure('public.set_job_work_locations(uuid, text[])') is null
  and to_regprocedure('public.get_public_job_work_locations(uuid)') is null
  and to_regprocedure('public.job_duplications_copy_work_locations()') is null
  and to_regprocedure('public.job_work_locations_relink_alias()') is null
  and position('job_work_locations' in pg_get_functiondef('public.search_city_candidates(text)'::regprocedure)) = 0
  and position('location_filter_ids' in pg_get_functiondef('public.search_city_candidates(text)'::regprocedure)) > 0,
  'JWL850-R1 rollback usuwa tabelę, RPC i triggery; search_city_candidates wraca do 0183');
set local role anon;
select count(*) as jwr_rows from public.get_public_jobs('pl', p_city => 'Hasselt', p_limit => 5) \gset
reset role;
select pg_temp.assert(:'jwr_rows'::int >= 0, 'JWL850-R2 lista ofert z miastem działa po rollbacku');
rollback;

select pg_temp.assert(to_regclass('public.job_work_locations') is not null,
  'JWL850-R3 po teście baza wraca do stanu po 0230');
\echo '--- JWL850-R rollback 0230 OK ---'
