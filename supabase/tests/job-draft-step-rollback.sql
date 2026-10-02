-- =============================================================================
-- DS834-R — rollback migracji 0216 (postęp kreatora szkicu, #834). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji
-- i jest cofany, więc baza po teście nadal ma stan po 0216.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

-- Punkt wyjścia: stan po 0216.
select pg_temp.assert(
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'jobs' and column_name = 'draft_step')
  and pg_get_functiondef('public.save_job_draft(uuid, jsonb, timestamptz)'::regprocedure) like '%draft_step%',
  'DS834-R0 baza w stanie po 0216');

begin;
\ir ../rollback/0216_job_draft_resume_step.down.sql

select pg_temp.assert(
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'jobs' and column_name = 'draft_step'),
  'DS834-R1 kolumna jobs.draft_step usunięta');
select pg_temp.assert(
  pg_get_functiondef('public.save_job_draft(uuid, jsonb, timestamptz)'::regprocedure) not like '%draft_step%'
  and pg_get_functiondef('public.save_job_draft(uuid, jsonb, timestamptz)'::regprocedure) like '%JOB_EDIT_CONFLICT%'
  and pg_get_functiondef('public.save_job_draft(uuid, jsonb, timestamptz)'::regprocedure) like '%work_time%'
  and has_function_privilege('authenticated', 'public.save_job_draft(uuid, jsonb, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.save_job_draft(uuid, jsonb, timestamptz)', 'EXECUTE'),
  'DS834-R2 save_job_draft z 0194 przywrócone (token wersji, work_time, grant tylko authenticated)');
rollback;

select pg_temp.assert(
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'jobs' and column_name = 'draft_step'),
  'DS834-R3 po cofnięciu transakcji baza wraca do stanu po 0216');
\echo 'DS834-R rollback 0216 OK'
