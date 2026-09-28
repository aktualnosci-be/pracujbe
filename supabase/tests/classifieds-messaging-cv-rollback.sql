-- =============================================================================
-- CL174-R — rollback migracji 0174 (#1134, #1138). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

begin;
\ir ../rollback/0174_classifieds_messaging_cv_off.down.sql
select pg_temp.assert(
  not exists (select 1 from pg_trigger where tgname = 'trg_aa_recruitment_mode_cv')
  and to_regprocedure('public.enforce_recruitment_cv_file()') is null
  and to_regprocedure('public.apply_candidate_cv_proposals_impl(text[], text[], jsonb, text[], integer)') is null
  and position('ensure_candidate_profile' in pg_get_functiondef(
        'public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer)'::regprocedure)) > 0
  and has_function_privilege('authenticated',
        'public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer)', 'execute')
  and position('suppressed_recruitment_disabled' in pg_get_functiondef(
        'public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)'::regprocedure)) = 0,
  'CL174-R rollback przywraca stan sprzed 0174 (0115/0124)');
rollback;
select pg_temp.assert(to_regprocedure('public.enforce_recruitment_cv_file()') is not null,
  'CL174-R2 rollback testu cofnięty');
\echo 'CL174-R rollback 0174: PASS'
