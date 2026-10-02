-- =============================================================================
-- OC778-R — rollback migracji 0226 (blokada firmy przy odebraniu roli/dostępu właściciela #778,
-- blokada źródła „Kopiuj jako szkic” #1098). Uruchamiany przez scripts/test-rls.sh po rls.sql,
-- na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany, więc baza po teście
-- nadal ma stan po 0226.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

-- Punkt wyjścia: stan po 0226.
select pg_temp.assert(
  pg_get_functiondef('public.set_company_member_role(uuid, text)'::regprocedure) like '%company_owners:%'
  and pg_get_functiondef('public.set_company_member_active(uuid, boolean)'::regprocedure) like '%company_owners:%'
  and pg_get_functiondef('public.enforce_owner_invariants()'::regprocedure) like '%company_owners:%'
  and pg_get_functiondef('public.duplicate_job_as_draft(uuid, uuid)'::regprocedure) like '%for share%',
  'OC778-R0 baza w stanie po 0226');

begin;
\ir ../rollback/0226_owner_invariant_job_copy_locks.down.sql

select pg_temp.assert(
  pg_get_functiondef('public.set_company_member_role(uuid, text)'::regprocedure) not like '%company_owners:%'
  and pg_get_functiondef('public.set_company_member_active(uuid, boolean)'::regprocedure) not like '%company_owners:%'
  and pg_get_functiondef('public.enforce_owner_invariants()'::regprocedure) not like '%company_owners:%'
  and pg_get_functiondef('public.enforce_owner_invariants()'::regprocedure) like '%kolumny tożsamości członkostwa%'
  and pg_get_functiondef('public.duplicate_job_as_draft(uuid, uuid)'::regprocedure) not like '%for share%'
  and pg_get_functiondef('public.duplicate_job_as_draft(uuid, uuid)'::regprocedure) like '%job_duplications%',
  'OC778-R1 definicje z 0086/0185/0148 przywrócone');
select pg_temp.assert(
  has_function_privilege('authenticated', 'public.set_company_member_role(uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_company_member_active(uuid, boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.duplicate_job_as_draft(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.duplicate_job_as_draft(uuid, uuid)', 'EXECUTE'),
  'OC778-R2 granty RPC bez zmian po rollbacku');
rollback;

select pg_temp.assert(
  pg_get_functiondef('public.duplicate_job_as_draft(uuid, uuid)'::regprocedure) like '%for share%',
  'OC778-R3 po cofnięciu transakcji baza wraca do stanu po 0226');
\echo 'OC778-R rollback 0226 OK'
