-- =============================================================================
-- SD1111-R — rollback migracji 0189 (kontrakt soft-delete i limity plików CV). Uruchamiany
-- przez scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się
-- w transakcji i jest cofany, więc baza po teście nadal ma stan po 0189.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

-- Rollback 0189 przywraca polityki bez deleted_at i zdejmuje strażniki (w transakcji cofanej).
begin;
\ir ../rollback/0189_soft_delete_contract_cv_quota.down.sql
select pg_temp.assert(
  (select count(*) from pg_policies where schemaname = 'public' and policyname in
     ('applications_select', 'offers_select', 'conversations_select_member', 'messages_select_member')
     and qual like '%deleted_at%') = 0
  and to_regprocedure('public.enforce_soft_delete_contract()') is null
  and to_regprocedure('public.enforce_cv_account_quota()') is null,
  'SD1111-R rollback 0189 przywraca stan sprzed migracji');
rollback;
