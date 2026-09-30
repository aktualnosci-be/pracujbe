-- =============================================================================
-- SJ968-R — rollback migracji 0199 (cel zapisu oferty #882, relink aliasów #715). Uruchamiany
-- przez scripts/test-rls.sh po rls.sql. Rollback w transakcji cofanej: baza po teście nadal
-- ma stan po 0199.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  exists (select 1 from pg_trigger where tgname = 'trg_saved_jobs_guard_target')
  and exists (select 1 from pg_trigger where tgname = 'trg_location_aliases_relink_jobs_upd')
  and exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'saved_jobs' and column_name = 'saved_while_public'),
  'SJ968-R0 baza w stanie po 0199');

begin;
\ir ../rollback/0199_saved_jobs_target_and_alias_relink.down.sql

select pg_temp.assert(
  not exists (select 1 from pg_trigger where tgname in ('trg_saved_jobs_guard_target',
      'trg_location_aliases_relink_jobs_upd', 'trg_location_aliases_relink_jobs_del',
      'trg_locations_relink_jobs', 'trg_zz_jobs_location_only_keep_version'))
  and exists (select 1 from pg_trigger where tgname = 'trg_location_aliases_relink_jobs'
               and tgrelid = 'public.location_aliases'::regclass)
  and to_regprocedure('public.relink_jobs_for_city_keys(text[], uuid[])') is null
  and to_regprocedure('public.saved_jobs_guard_target()') is null
  and not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'saved_jobs' and column_name = 'saved_while_public'),
  'SJ968-R1 rollback usuwa strażniki, kolumnę i triggery, przywraca trigger INSERT z 0153');
select pg_temp.assert(
  position('saved_while_public' in pg_get_functiondef('public.get_saved_jobs_display(text)'::regprocedure)) = 0
  and has_function_privilege('authenticated', 'public.get_saved_jobs_display(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_saved_jobs_display(text)', 'EXECUTE'),
  'SJ968-R2 get_saved_jobs_display z 0162 z tymi samymi grantami');
rollback;

select pg_temp.assert(
  exists (select 1 from pg_trigger where tgname = 'trg_saved_jobs_guard_target'),
  'SJ968-R3 po cofnięciu transakcji stan 0199 zostaje');
