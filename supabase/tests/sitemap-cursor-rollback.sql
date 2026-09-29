-- =============================================================================
-- SM1042-R — rollback migracji 0965 (#1042). Uruchamiany przez scripts/test-rls.sh po
-- rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

select count(*) as smjobs from public.jobs \gset

begin;
\ir ../rollback/0965_public_jobs_sitemap_cursor.down.sql
select pg_temp.assert(
  to_regprocedure('public.get_public_jobs_sitemap_page(timestamptz, uuid, timestamptz, uuid, integer)') is null
  and to_regprocedure('public.get_public_jobs_sitemap_shard_starts(integer)') is null
  and to_regclass('public.idx_jobs_sitemap_cursor') is null
  and to_regprocedure('public.get_public_jobs(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean)') is not null
  and (select count(*) from public.jobs) = :smjobs,
  'SM1042-R rollback usuwa tylko funkcje i indeks 0965');
rollback;
select pg_temp.assert(
  to_regprocedure('public.get_public_jobs_sitemap_page(timestamptz, uuid, timestamptz, uuid, integer)') is not null
  and to_regclass('public.idx_jobs_sitemap_cursor') is not null,
  'SM1042-R2 rollback testu cofnięty');
\echo 'SM1042-R rollback 0965: PASS'
