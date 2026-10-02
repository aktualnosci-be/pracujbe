-- =============================================================================
-- SD1112-R — rollback migracji 0211 (termin digestu zapisanych wyszukiwań, #1112). Uruchamiany
-- przez scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się
-- w transakcji i jest cofany, więc baza po teście nadal ma stan po 0211.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  to_regprocedure('public.saved_search_next_run_at(timestamptz, text, timestamptz)') is not null
  and position('saved_search_next_run_at' in pg_get_functiondef('public.process_saved_search_alerts(integer)'::regprocedure)) > 0,
  'SD1112-R0 baza w stanie po 0211');

begin;
\ir ../rollback/0211_saved_search_digest_schedule.down.sql

select pg_temp.assert(
  to_regprocedure('public.saved_search_next_run_at(timestamptz, text, timestamptz)') is null
  and position('saved_search_next_run_at' in pg_get_functiondef('public.process_saved_search_alerts(integer)'::regprocedure)) = 0
  and position('saved_search_matching_jobs' in pg_get_functiondef('public.process_saved_search_alerts(integer)'::regprocedure)) > 0
  and has_function_privilege('service_role', 'public.process_saved_search_alerts(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.process_saved_search_alerts(integer)', 'execute'),
  'SD1112-R1 rollback przywraca worker z 0138 (z uprawnieniami) i usuwa funkcję pomocniczą');

-- SD1112-R2: worker po rollbacku działa.
set local role service_role;
select pg_temp.assert(public.process_saved_search_alerts(10) >= 0, 'SD1112-R2 worker z 0138 działa po rollbacku');
reset role;
rollback;

select pg_temp.assert(
  to_regprocedure('public.saved_search_next_run_at(timestamptz, text, timestamptz)') is not null,
  'SD1112-R3 po cofnięciu transakcji baza wraca do stanu po 0211');
