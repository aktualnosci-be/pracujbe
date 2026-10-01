-- =============================================================================
-- CX1091-R — rollback migracji 0949 (eksport kandydata: zgłoszenia treści i ostrzeżenia
-- retencji, #1091). Uruchamiany przez scripts/test-rls.sh po rls.sql; rollback w transakcji
-- cofanej, baza zostaje po 0949.
-- =============================================================================
\set ON_ERROR_STOP on
\set CXR 'c1091000-0000-4000-8000-0000000000f1'

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  to_regprocedure('public.export_my_data_pre_reports()') is not null
  and position('contentReports' in pg_get_functiondef('public.export_my_data()'::regprocedure)) > 0
  and not has_function_privilege('authenticated', 'public.export_my_data_pre_reports()', 'execute'),
  'CX1091-R0 baza w stanie po 0949 (część wewnętrzna bez EXECUTE dla klienta)');

begin;
insert into auth.users(id, email, name, raw_user_meta_data) values
  (:'CXR', 'cxr@test.be', 'Cx R', '{"role":"candidate","first_name":"Cx","last_name":"R","locale":"pl"}');

set local role authenticated; set local app.current_uid = :'CXR';
select public.export_my_data()::text as cxr_before \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'cxr_before'::jsonb ? 'contentReports' and :'cxr_before'::jsonb ? 'retentionWarnings'
  and :'cxr_before'::jsonb ? 'applicationJournal',
  'CX1091-R1 przed rollbackiem eksport ma nowe klucze i klucze z 0196');

\ir ../rollback/0949_candidate_export_reports_warnings.down.sql

select pg_temp.assert(
  to_regprocedure('public.export_my_data_pre_reports()') is null
  and to_regprocedure('public.export_my_data()') is not null
  and has_function_privilege('authenticated', 'public.export_my_data()', 'execute')
  and not has_function_privilege('anon', 'public.export_my_data()', 'execute'),
  'CX1091-R2 rollback przywraca funkcję sprzed 0949 z uprawnieniami');

set local role authenticated; set local app.current_uid = :'CXR';
select public.export_my_data()::text as cxr_after \gset
reset role; reset app.current_uid;
select pg_temp.assert(not (:'cxr_after'::jsonb ? 'contentReports')
  and not (:'cxr_after'::jsonb ? 'retentionWarnings')
  and :'cxr_after'::jsonb ? 'applicationJournal' and :'cxr_after'::jsonb ? 'profile',
  'CX1091-R3 po rollbacku eksport działa bez nowych kluczy');
rollback;

select pg_temp.assert(
  to_regprocedure('public.export_my_data_pre_reports()') is not null
  and position('retentionWarnings' in pg_get_functiondef('public.export_my_data()'::regprocedure)) > 0,
  'CX1091-R4 po teście baza wraca do stanu po 0949');

\echo '--- CX1091-R rollback 0949 OK ---'
