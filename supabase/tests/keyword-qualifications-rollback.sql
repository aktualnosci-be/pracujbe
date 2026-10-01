-- =============================================================================
-- KQ866-R — rollback migracji 0957 (słowo kluczowe w kwalifikacjach oferty, #866).
-- Uruchamiany przez scripts/test-rls.sh po rls.sql. Rollback w transakcji cofanej:
-- baza po teście nadal ma stan po 0957. Zachowanie obu wersji sprawdza rls.sql KQ866.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

create function pg_temp.kq_uses_qualifications() returns boolean language sql as $$
  select bool_and(pg_get_functiondef(p.oid) like '%job_keyword_qualification_match%')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('get_public_jobs', 'get_public_jobs_count', 'get_public_job_filter_facets',
                      'saved_search_jobs_after');
$$;

select pg_temp.assert(
  pg_temp.kq_uses_qualifications()
  and to_regprocedure('public.search_keyword_candidates(text)') is not null
  and to_regclass('public.idx_job_certificates_label_fold_trgm') is not null,
  'KQ866-R0 baza w stanie po 0957');

begin;
\ir ../rollback/0957_keyword_job_qualifications.down.sql

select pg_temp.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('get_public_jobs', 'get_public_jobs_count',
                                  'get_public_job_filter_facets', 'saved_search_jobs_after')
                and pg_get_functiondef(p.oid) like '%job_keyword_qualification_match%')
  and to_regprocedure('public.search_keyword_candidates(text)') is null
  and to_regprocedure('public.job_keyword_qualification_match(uuid, text, text, text)') is null
  and to_regclass('public.idx_job_skills_label_fold_trgm') is null
  and to_regclass('public.idx_job_certificates_label_fold_trgm') is null
  and to_regclass('public.idx_job_requirements_content_fold_trgm') is null
  and to_regprocedure('public.search_title_candidates(text)') is not null,
  'KQ866-R1 rollback przywraca definicje z 0960 i usuwa funkcje pomocnicze oraz indeksy');
select pg_temp.assert(
  has_function_privilege('anon', 'public.get_public_jobs(text, text, text, text[], text[], text[], integer, integer, boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean, text, text, text, text, integer)', 'EXECUTE')
  and (select count(*) from public.get_public_jobs('pl', 'vca', p_limit => 5)) <= 5
  and public.get_public_jobs_count('pl', 'vca') >= 0,
  'KQ866-R2 funkcje z 0960 działają po rollbacku, granty bez zmian');
rollback;

select pg_temp.assert(pg_temp.kq_uses_qualifications(),
  'KQ866-R3 po cofnięciu transakcji stan 0957 zostaje');
