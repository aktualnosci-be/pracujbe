-- =============================================================================
-- PF1215-R — rollback migracji 0213 (publiczne RPC ofert z planem dla wartości parametrów,
-- #1215). Uruchamiany przez scripts/test-rls.sh po rls.sql. Rollback w transakcji cofanej:
-- baza po teście nadal ma stan po 0213. Zgodność wyników obu wersji sprawdza rls.sql PF1215.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

create function pg_temp.pf_lang(p_fn regprocedure) returns text language sql as $$
  select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = p_fn;
$$;

\set PF_LIST 'public.get_public_jobs(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean, text, text, text, text, integer)'
\set PF_COUNT 'public.get_public_jobs_count(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer)'
\set PF_FACETS 'public.get_public_job_filter_facets(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer)'
\set PF_SAVED 'public.saved_search_jobs_after(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean, text, text, text, text, integer)'
-- Stan bieżący: 0975 (grafik pracy, numer tymczasowy) dodaje parametr p_shift_patterns.
\set PF_LIST_CUR 'public.get_public_jobs(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean, text, text, text, text, integer, text[])'
\set PF_COUNT_CUR 'public.get_public_jobs_count(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer, text[])'
\set PF_FACETS_CUR 'public.get_public_job_filter_facets(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, boolean, text, text, text, text, integer, text[])'
\set PF_SAVED_CUR 'public.saved_search_jobs_after(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean, text, text, text, text, integer, text[])'

select pg_temp.assert(
  pg_temp.pf_lang(:'PF_LIST_CUR'::regprocedure) = 'plpgsql'
  and pg_temp.pf_lang(:'PF_COUNT_CUR'::regprocedure) = 'plpgsql'
  and pg_temp.pf_lang(:'PF_FACETS_CUR'::regprocedure) = 'plpgsql'
  and pg_temp.pf_lang(:'PF_SAVED_CUR'::regprocedure) = 'plpgsql'
  and to_regclass('public.idx_jobs_public_salary_month') is not null
  and to_regclass('public.idx_jobs_public_salary_hour') is not null,
  'PF1215-R0 baza w stanie po 0213');

begin;
-- 0975 (grafik pracy, numer tymczasowy) dodaje parametr do tych funkcji — najpierw jej rollback.
\ir ../rollback/0975_job_shift_patterns.down.sql
\ir ../rollback/0213_public_jobs_custom_plan.down.sql

select pg_temp.assert(
  pg_temp.pf_lang(:'PF_LIST'::regprocedure) = 'sql'
  and pg_temp.pf_lang(:'PF_COUNT'::regprocedure) = 'sql'
  and pg_temp.pf_lang(:'PF_FACETS'::regprocedure) = 'sql'
  and pg_temp.pf_lang(:'PF_SAVED'::regprocedure) = 'sql'
  and (select proconfig from pg_proc where oid = :'PF_LIST'::regprocedure) = array['search_path=public, pg_temp']
  and to_regclass('public.idx_jobs_public_salary_month') is null
  and to_regclass('public.idx_jobs_public_salary_hour') is null,
  'PF1215-R1 rollback przywraca definicje LANGUAGE sql z 0194 i usuwa indeksy wynagrodzenia');
select pg_temp.assert(
  has_function_privilege('anon', :'PF_LIST', 'EXECUTE')
  and has_function_privilege('authenticated', :'PF_COUNT', 'EXECUTE')
  and has_function_privilege('anon', :'PF_FACETS', 'EXECUTE')
  and has_function_privilege('service_role', :'PF_SAVED', 'EXECUTE')
  and not has_function_privilege('anon', :'PF_SAVED', 'EXECUTE')
  and not has_function_privilege('authenticated', :'PF_SAVED', 'EXECUTE'),
  'PF1215-R2 granty bez zmian po rollbacku');
select pg_temp.assert(
  (select count(*) from public.get_public_jobs('pl', p_limit => 5)) <= 5
  and public.get_public_jobs_count('pl') >= 0,
  'PF1215-R3 funkcje z 0194 działają po rollbacku');
rollback;

select pg_temp.assert(
  pg_temp.pf_lang(:'PF_LIST_CUR'::regprocedure) = 'plpgsql'
  and to_regclass('public.idx_jobs_public_salary_month') is not null,
  'PF1215-R4 po cofnięciu transakcji stan 0213 zostaje');
