-- =============================================================================
-- WD792-R — rollback migracji 0956 (#792, tryb pracy oferty). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql, na tej samej bazie (dane WD792 z rls.sql). Rollback wykonuje
-- się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'work_mode')
  and position('work_mode' in pg_get_functiondef('public.save_job_draft(uuid,jsonb,timestamptz)'::regprocedure)) > 0
  and position('work_mode' in pg_get_functiondef('public.update_published_job(uuid,jsonb,timestamptz)'::regprocedure)) > 0
  and exists (select 1 from public.jobs where work_mode is not null),
  'WD792-R0 stan wyjściowy: migracja 0956 zastosowana, są oferty z trybem');

begin;
\ir ../rollback/0956_job_work_mode.down.sql
select pg_temp.assert(
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs'
                and column_name in ('work_mode', 'remote_applicant_countries'))
  and to_regprocedure('public.job_country_codes(jsonb)') is null
  and to_regprocedure('public.job_applicant_countries_ok(text[])') is null
  and to_regprocedure('public.jobs_sync_remote_from_work_mode()') is null
  and to_regprocedure('public.job_duplications_copy_work_mode()') is null,
  'WD792-R1 kolumny, triggery i funkcje 0956 usunięte');
select pg_temp.assert(
  position('work_mode' in pg_get_functiondef('public.save_job_draft(uuid,jsonb,timestamptz)'::regprocedure)) = 0
  and position('work_time' in pg_get_functiondef('public.save_job_draft(uuid,jsonb,timestamptz)'::regprocedure)) > 0
  and position('shift_patterns' in pg_get_functiondef('public.save_job_draft(uuid,jsonb,timestamptz)'::regprocedure)) > 0
  and position('shift_patterns' in pg_get_functiondef('public.update_published_job(uuid,jsonb,timestamptz)'::regprocedure)) > 0
  and position('work_mode' in pg_get_functiondef('public.update_published_job(uuid,jsonb,timestamptz)'::regprocedure)) = 0
  and position('job_operation_context' in pg_get_functiondef('public.update_published_job(uuid,jsonb,timestamptz)'::regprocedure)) > 0
  and position('work_mode' in pg_get_functiondef('public.job_edit_audit_snapshot(public.jobs)'::regprocedure)) = 0
  and has_function_privilege('authenticated', 'public.save_job_draft(uuid,jsonb,timestamptz)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_published_job(uuid,jsonb,timestamptz)', 'EXECUTE')
  and has_function_privilege('anon', 'public.get_public_job(text,text)', 'EXECUTE')
  and not exists (select 1 from pg_proc p cross join lateral unnest(p.proargnames) a
                   where p.oid = 'public.get_public_job(text,text)'::regprocedure and a = 'work_mode'),
  'WD792-R2 definicje z 0194/0200/0227 przywrócone (z grantami RPC)');
rollback;
select pg_temp.assert(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'work_mode'),
  'WD792-R3 rollback testu cofnięty');
\echo 'WD792-R rollback 0956: PASS'
