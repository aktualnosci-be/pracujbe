-- =============================================================================
-- M2RD-R — rollback migracji 0185 (#1033, #1034, #1089, #1091, #1090). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji
-- i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(to_regprocedure('public.job_has_process_records(uuid)') is not null
  and exists (select 1 from pg_trigger where tgname = 'trg_auth_accounts_invalidate_reset_links'),
  'M2RD-R0 migracja 0185 jest zastosowana przed rollbackiem');

begin;
\ir ../rollback/0185_rls_data_hardening.down.sql
select pg_temp.assert(
  to_regprocedure('public.job_has_process_records(uuid)') is null
  and to_regprocedure('public.audit_job_delete()') is null
  and to_regprocedure('public.guard_company_immutable_fields()') is null
  and to_regprocedure('public.guard_files_client_write()') is null
  and to_regprocedure('public.retention_purge_auth_batch(integer)') is null
  and to_regprocedure('public.auth_user_delete_cleanup()') is null
  and to_regprocedure('public.auth_invalidate_reset_links()') is null
  and not exists (select 1 from pg_trigger where tgname in ('trg_audit_job_delete', 'trg_guard_company_immutable_fields',
        'trg_files_guard_client_write', 'trg_auth_users_delete_cleanup', 'trg_auth_accounts_invalidate_reset_links'))
  and not exists (select 1 from public.retention_policies where key in ('expired_auth_session', 'expired_auth_verification'))
  -- definicje z 0019 / 0084 / 0099 / 0132 / 0165 wróciły
  and position('is_active' in pg_get_functiondef('public.is_admin()'::regprocedure)) = 0
  and position('registration_number' in pg_get_functiondef('public.protect_company_verification()'::regprocedure)) = 0
  and position('current_user' in pg_get_functiondef('public.guard_job_moderation_lock()'::regprocedure)) = 0
  and position('current_user in (''anon''' in pg_get_functiondef('public.guard_company_moderation_lock()'::regprocedure)) = 0
  and position('retention_purge_auth_batch' in pg_get_functiondef('public.run_retention_purge(integer, boolean)'::regprocedure)) = 0
  and position('count_other_active_owners' in pg_get_functiondef('public.enforce_owner_invariants()'::regprocedure)) > 0
  and has_function_privilege('authenticated', 'public.count_other_active_owners(uuid, uuid)', 'execute')
  and position('job_has_process_records' in (select pg_get_expr(polqual, polrelid) from pg_policy
        where polrelid = 'public.jobs'::regclass and polname = 'jobs_delete_member')) = 0,
  'M2RD-R rollback usuwa obiekty 0185 i przywraca definicje z 0019/0033/0084/0099/0132/0165');
rollback;
select pg_temp.assert(to_regprocedure('public.job_has_process_records(uuid)') is not null
  and not has_function_privilege('authenticated', 'public.count_other_active_owners(uuid, uuid)', 'execute'),
  'M2RD-R po cofnięciu transakcji migracja 0185 zostaje');
\echo '=================== 0185 ROLLBACK OK ==================='
