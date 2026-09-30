-- =============================================================================
-- EX1232-R — rollback migracji 0992 (eksport pracodawcy: odwołania i zgłoszenia, #1232).
-- Uruchamiany przez scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się
-- w transakcji i jest cofany, więc baza po teście nadal ma stan po 0992.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  position('moderationAppeals' in pg_get_functiondef('public.export_my_employer_data()'::regprocedure)) > 0
  and position('contentReports' in pg_get_functiondef('public.export_my_employer_data()'::regprocedure)) > 0,
  'EX1232-R0 baza w stanie po 0992');

begin;
\ir ../rollback/0992_employer_export_appeals_reports.down.sql
select pg_temp.assert(
  position('moderationAppeals' in pg_get_functiondef('public.export_my_employer_data()'::regprocedure)) = 0
  and position('contentReports' in pg_get_functiondef('public.export_my_employer_data()'::regprocedure)) = 0
  and position('invitationsReceived' in pg_get_functiondef('public.export_my_employer_data()'::regprocedure)) > 0
  and has_function_privilege('authenticated', 'public.export_my_employer_data()', 'execute')
  and not has_function_privilege('anon', 'public.export_my_employer_data()', 'execute'),
  'EX1232-R1 rollback przywraca eksport z 0161 z tymi samymi uprawnieniami');
rollback;

select pg_temp.assert(
  position('contentReports' in pg_get_functiondef('public.export_my_employer_data()'::regprocedure)) > 0,
  'EX1232-R2 po cofnięciu transakcji baza wraca do stanu po 0992');
