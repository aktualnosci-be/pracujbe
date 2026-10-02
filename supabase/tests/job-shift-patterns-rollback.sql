-- =============================================================================
-- SP858-R — rollback migracji 0227 (grafik pracy oferty i filtr listy, #858). Uruchamiany przez
-- scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback wykonuje się w transakcji
-- i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

begin;
insert into public.companies(id, name, status)
  values ('f8580000-0000-4000-8000-00000000f000', 'SP858-R Firma', 'verified');
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,
                        published_at,work_time,shift_patterns) values
  ('f8580000-0000-4000-8000-00000000f001','f8580000-0000-4000-8000-00000000f000','sp858r-a','Rollback SP858R','production','permanent','Gent','Flandria','active','pl', now(), 'part_time', array['night']),
  ('f8580000-0000-4000-8000-00000000f002','f8580000-0000-4000-8000-00000000f000','sp858r-b','Rollback SP858R','production','permanent','Gent','Flandria','active','pl', now(), null, null);
-- Przed rollbackiem: filtr 0227 działa (obok filtrów 0194).
select pg_temp.assert(
  public.get_public_jobs_count('pl', 'sp858r', p_shift_patterns => array['night']) = 1
  and public.get_public_jobs_count('pl', 'sp858r', p_work_time => 'part_time') = 1
  and public.get_public_job_shift_patterns('f8580000-0000-4000-8000-00000000f001') = array['night'],
  'SP858-R0 stan przed rollbackiem');

-- Odroczone triggery kolejki tłumaczeń (0146) z insertów fikstury — przed ALTER TABLE.
set constraints all immediate;
-- 0976 (świadczenia, numer tymczasowy) dodaje parametr do tych funkcji — najpierw jej rollback.
\ir ../rollback/0976_job_benefits.down.sql
\ir ../rollback/0227_job_shift_patterns.down.sql

-- Po rollbacku: sygnatury i zachowanie stanu 0194 (filtry 0194 nadal działają).
select pg_temp.assert(
  to_regprocedure('public.get_public_jobs(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,integer,integer,text,boolean,text,text,text,text,integer)') is not null
  and to_regprocedure('public.get_public_jobs(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,integer,integer,text,boolean,text,text,text,text,integer,text[])') is null
  and to_regprocedure('public.get_public_jobs_count(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean,text,text,text,text,integer)') is not null
  and to_regprocedure('public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean,text,text,text,text,integer)') is not null
  and to_regprocedure('public.saved_search_jobs_after(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,timestamptz,uuid,integer,boolean,text,text,text,text,integer)') is not null
  and to_regprocedure('public.get_public_job_shift_patterns(uuid)') is null
  and to_regprocedure('public.job_shift_patterns_from_jsonb(jsonb)') is null
  and not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'jobs' and column_name = 'shift_patterns')
  and public.get_public_jobs_count('pl', 'sp858r', p_work_time => 'part_time') = 1
  and public.get_public_jobs_count('pl', 'sp858r') = 2
  and position('shift_patterns' in pg_get_functiondef('public.save_job_draft(uuid,jsonb,timestamptz)'::regprocedure)) = 0
  and position('shift_patterns' in pg_get_functiondef('public.update_published_job(uuid,jsonb,timestamptz)'::regprocedure)) = 0,
  'SP858-R rollback przywraca definicje stanu 0194/0203');
rollback;
select pg_temp.assert(
  to_regprocedure('public.get_public_job_shift_patterns(uuid)') is not null
  and exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'jobs' and column_name = 'shift_patterns'),
  'SP858-R2 rollback testu cofnięty');
\echo 'SP858-R rollback 0227: PASS'
