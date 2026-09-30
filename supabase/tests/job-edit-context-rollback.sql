-- =============================================================================
-- JC967-R — rollback migracji 0200 (kontekst zaufanej edycji oferty, #753/#752/#750). Uruchamiany
-- przez scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji
-- i jest cofany, więc baza po teście nadal ma stan po 0200.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

-- Punkt wyjścia: stan po 0200.
select pg_temp.assert(to_regclass('public.job_operation_context') is not null
  and to_regprocedure('public.job_edit_audit_snapshot(public.jobs)') is not null
  and pg_get_functiondef('public.assert_job_draft_or_editing(uuid)'::regprocedure) not like '%current_setting%'
  and pg_get_functiondef('public.notify_job_terms_changed()'::regprocedure) not like '%current_setting%'
  and pg_get_functiondef('public.update_published_job(uuid, jsonb, timestamptz)'::regprocedure) not like '%perform set_config%',
  'JC967-R0 baza w stanie po 0200');

begin;
\ir ../rollback/0200_job_edit_trusted_context.down.sql

select pg_temp.assert(to_regclass('public.job_operation_context') is null
  and to_regprocedure('public.job_edit_audit_snapshot(public.jobs)') is null
  and to_regprocedure('public.job_operation_context_active(uuid, text)') is null
  and to_regprocedure('public.job_operation_context_take(uuid, text)') is null,
  'JC967-R1 tabela i funkcje 0200 usunięte');
select pg_temp.assert(
  pg_get_functiondef('public.assert_job_draft_or_editing(uuid)'::regprocedure) like '%pracujbe.job_edit%'
  and pg_get_functiondef('public.notify_job_terms_changed()'::regprocedure) like '%pracujbe.job_terms_notify%'
  and pg_get_functiondef('public.update_published_job(uuid, jsonb, timestamptz)'::regprocedure) like '%pracujbe.job_edit%'
  and pg_get_functiondef('public.update_published_job(uuid, jsonb, timestamptz)'::regprocedure) like '%JOB_APPLY_CHANNEL_REQUIRED%'
  and pg_get_functiondef('public.update_published_job(uuid, jsonb, timestamptz)'::regprocedure) like '%work_time%'
  and has_function_privilege('authenticated', 'public.update_published_job(uuid, jsonb, timestamptz)', 'EXECUTE'),
  'JC967-R2 definicje z 0077/0144/0194 przywrócone (z grantem RPC)');
rollback;

select pg_temp.assert(to_regclass('public.job_operation_context') is not null,
  'JC967-R3 po cofnięciu transakcji baza wraca do stanu po 0200');
\echo 'JC967-R rollback 0200 OK'
