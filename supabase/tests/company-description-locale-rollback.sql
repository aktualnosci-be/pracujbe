-- =============================================================================
-- CDL975-R — rollback migracji 0975 (język opisu firmy, #708). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql; rollback w transakcji cofanej, baza zostaje po 0975.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select pg_temp.assert(
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'companies' and column_name = 'description_locale')
  and to_regprocedure('public.set_company_description_locale(uuid, text)') is not null
  and position('description_locale' in pg_get_function_result('public.get_public_company(text)'::regprocedure)) > 0,
  'CDL975-R0 baza w stanie po 0975');

begin;
\ir ../rollback/0975_company_description_locale.down.sql

select pg_temp.assert(
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'companies' and column_name = 'description_locale')
  and to_regprocedure('public.set_company_description_locale(uuid, text)') is null
  and to_regprocedure('public.reset_company_description_locale()') is null
  and position('description_locale' in pg_get_function_result('public.get_public_company(text)'::regprocedure)) = 0
  and position('active_jobs_count' in pg_get_function_result('public.get_public_company(text)'::regprocedure)) > 0,
  'CDL975-R1 rollback usuwa kolumnę, RPC i trigger; get_public_company wraca do definicji z 0140');

-- Profil nadal działa dla anonima po rollbacku.
set local role anon;
select count(*) as cdl_rows from public.get_public_company('nie-ma-takiej-firmy') \gset
reset role;
select pg_temp.assert(:'cdl_rows'::int = 0, 'CDL975-R2 get_public_company po rollbacku wykonywalne przez anon');
rollback;

select pg_temp.assert(
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'companies' and column_name = 'description_locale'),
  'CDL975-R3 po teście baza wraca do stanu po 0975');

\echo '--- CDL975-R rollback 0975 OK ---'
