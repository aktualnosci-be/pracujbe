-- =============================================================================
-- OD981-R — rollback migracji 0202 (#1222, #1233). Uruchamiany przez scripts/test-rls.sh
-- po rls.sql, na tej samej bazie (dane OD981 z rls.sql: zaproszenia z wyzerowanym adresem).
-- Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  position('p_action = ''reopen'' then now()' in pg_get_functiondef('public.set_job_status(uuid,text)'::regprocedure)) > 0
  and position('company_invitations' in pg_get_functiondef('public.erase_employer_subject(uuid,text,uuid)'::regprocedure)) > 0
  and exists (select 1 from public.company_invitations where email is null),
  'OD981-R0 stan wyjściowy: migracja 0202 zastosowana, są zaproszenia z wyzerowanym adresem');

begin;
\ir ../rollback/0202_owner_decisions_reopen_invitations.down.sql
select pg_temp.assert(
  position('p_action = ''reopen'' then now()' in pg_get_functiondef('public.set_job_status(uuid,text)'::regprocedure)) = 0
  and position('published_at is null then now()' in pg_get_functiondef('public.set_job_status(uuid,text)'::regprocedure)) > 0
  and position('company_invitations' in pg_get_functiondef('public.erase_employer_subject(uuid,text,uuid)'::regprocedure)) = 0
  and (select attnotnull from pg_attribute
        where attrelid = 'public.company_invitations'::regclass and attname = 'email')
  and not exists (select 1 from pg_constraint where conname = 'company_invitations_email_when_pending')
  and not exists (select 1 from public.company_invitations where email is null)
  and exists (select 1 from public.company_invitations where email::text like 'erased-%@erased.invalid'),
  'OD981-R rollback przywraca definicje 0085/0161 i NOT NULL (adres zastępczy .invalid)');
rollback;
select pg_temp.assert(exists (select 1 from public.company_invitations where email is null),
  'OD981-R2 rollback testu cofnięty');
\echo 'OD981-R rollback 0202: PASS'
