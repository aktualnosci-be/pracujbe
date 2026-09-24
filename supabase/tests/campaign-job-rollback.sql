-- =============================================================================
-- CJ186-R — rollback migracji 0105 (#186). Uruchamiany przez scripts/test-rls.sh po
-- rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select count(*) as cjjobs from public.jobs \gset

begin;
\ir ../rollback/0105_campaign_job_source.down.sql
select pg_temp.assert(to_regprocedure('public.get_campaign_job(text, text)') is null
  and to_regprocedure('public.get_managed_campaign_job(uuid, text)') is null
  and to_regprocedure('public.campaign_job_source(uuid, text, text)') is null
  and to_regprocedure('public.get_public_job(text, text)') is not null
  and (select count(*) from public.jobs) = :cjjobs,
  'CJ186-R rollback usuwa tylko funkcje 0105');
rollback;
select pg_temp.assert(to_regprocedure('public.get_campaign_job(text, text)') is not null,
  'CJ186-R2 rollback testu cofnięty');
\echo 'CJ186-R rollback 0105: PASS'
