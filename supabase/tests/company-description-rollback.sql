-- =============================================================================
-- CDR971-R — rollback migracji 0198 (#868). Uruchamiany przez scripts/test-rls.sh po
-- rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select count(*) as cdrcompanies from public.companies \gset

begin;
\ir ../rollback/0198_company_description_review.down.sql
select pg_temp.assert(
  to_regprocedure('public.submit_company_description(uuid, text)') is null
  and to_regprocedure('public.admin_decide_company_description(uuid, text, timestamptz, text)') is null
  and to_regprocedure('public.guard_company_description()') is null
  and not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'companies'
                     and column_name = 'description_pending')
  and exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'companies' and column_name = 'description')
  and to_regprocedure('public.submit_company_links(uuid, boolean, text, boolean, text)') is not null
  and (select count(*) from public.companies) = :cdrcompanies,
  'CDR971-R rollback usuwa tylko obiekty 0198 (opis zatwierdzony i linki zostają)');
rollback;
select pg_temp.assert(to_regprocedure('public.submit_company_description(uuid, text)') is not null,
  'CDR971-R2 rollback testu cofnięty');
\echo 'CDR971-R rollback 0198: PASS'
