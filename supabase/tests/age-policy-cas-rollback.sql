-- =============================================================================
-- APC1102-R — rollback migracji 0209 (CAS progu wieku i zatwierdzenie właściciela, #1102/#639).
-- Uruchamiany przez scripts/test-rls.sh po rls.sql; rollback w transakcji cofanej, baza zostaje
-- po 0209.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  to_regprocedure('public.admin_set_candidate_min_age(integer, text, timestamptz)') is not null
  and to_regprocedure('public.admin_set_candidate_min_age(integer, boolean, text)') is null
  and to_regprocedure('public.owner_confirm_candidate_min_age(integer, timestamptz, text)') is not null,
  'APC1102-R0 baza w stanie po 0209');

begin;
\ir ../rollback/0209_age_policy_cas_owner_confirmation.down.sql

select pg_temp.assert(
  to_regprocedure('public.admin_set_candidate_min_age(integer, text, timestamptz)') is null
  and to_regprocedure('public.owner_confirm_candidate_min_age(integer, timestamptz, text)') is null
  and to_regprocedure('public.admin_set_candidate_min_age(integer, boolean, text)') is not null
  and has_function_privilege('authenticated', 'public.admin_set_candidate_min_age(integer, boolean, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_set_candidate_min_age(integer, boolean, text)', 'execute'),
  'APC1102-R1 rollback przywraca sygnaturę z 0126 z grantami i usuwa funkcję zatwierdzenia');
rollback;

select pg_temp.assert(
  to_regprocedure('public.admin_set_candidate_min_age(integer, text, timestamptz)') is not null,
  'APC1102-R2 po teście baza wraca do stanu po 0209');

\echo '--- APC1102-R rollback 0209 OK ---'
