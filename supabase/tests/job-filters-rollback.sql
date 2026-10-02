-- =============================================================================
-- FL974-R — rollback migracji 0194 (filtry listy ofert: waluta, język i poziom, wymiar pracy,
-- promień). Uruchamiany przez scripts/test-rls.sh po rls.sql, na tej samej bazie. Rollback
-- wykonuje się w transakcji i jest cofany.
-- =============================================================================
\set ON_ERROR_STOP on

create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

begin;
insert into public.companies(id, name, status)
  values ('f9740000-0000-4000-8000-00000000f000', 'FL974-R Firma', 'verified');
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,
                        published_at,salary_min,salary_max,currency,salary_period,work_time) values
  ('f9740000-0000-4000-8000-00000000f001','f9740000-0000-4000-8000-00000000f000','fl974r-a','Rollback FL974R','warehouse','permanent','Gent','Flandria','active','pl', now(), 3000, 3000, 'PLN', 'month', 'part_time'),
  ('f9740000-0000-4000-8000-00000000f002','f9740000-0000-4000-8000-00000000f000','fl974r-b','Rollback FL974R','warehouse','permanent','Liège','Walonia','active','pl', now(), 3000, 3000, 'EUR', 'month', null);
-- Przed rollbackiem: filtry 0194 działają.
select pg_temp.assert(
  public.get_public_jobs_count('pl', 'fl974r', p_work_time => 'part_time') = 1
  and public.get_public_jobs_count('pl', 'fl974r', p_near => 'Gent', p_radius_km => 25) = 1
  and public.get_public_jobs_count('pl', 'fl974r', p_salary_min => 4000) = 1
  and (select work_time from public.get_public_job('fl974r-a', 'pl')) = 'part_time',
  'FL974-R0 stan przed rollbackiem');

-- Odroczone triggery kolejki tłumaczeń (0146) z insertów fikstury — przed ALTER TABLE.
set constraints all immediate;
-- 0975 (grafik pracy, numer tymczasowy) redefiniuje te same funkcje z nowym parametrem — najpierw jej rollback.
\ir ../rollback/0975_job_shift_patterns.down.sql

-- 0213 (#1215) zależy od 0194 (indeksy na job_salary_sort_key z 0194) — najpierw jej rollback.
\ir ../rollback/0213_public_jobs_custom_plan.down.sql

\ir ../rollback/0194_job_filters_language_worktime_radius.down.sql

-- Po rollbacku: sygnatury i zachowanie sprzed 0194 (PLN porównywane liczbowo, bez work_time).
select pg_temp.assert(
  to_regprocedure('public.get_public_jobs(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,integer,integer,text,boolean)') is not null
  and to_regprocedure('public.get_public_jobs(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,integer,integer,text,boolean,text,text,text,text,integer)') is null
  and to_regprocedure('public.get_public_jobs_count(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean)') is not null
  and to_regprocedure('public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean)') is not null
  and to_regprocedure('public.saved_search_jobs_after(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,timestamptz,uuid,integer,boolean)') is not null
  and to_regprocedure('public.locations_within_radius(text,integer)') is null
  and to_regprocedure('public.job_requires_language(uuid,text,text)') is null
  and not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'jobs' and column_name = 'work_time')
  and public.get_public_jobs_count('pl', 'fl974r', p_salary_min => 4000) = 0
  and public.get_public_jobs_count('pl', 'fl974r') = 2
  and (select count(*) from public.get_public_job('fl974r-a', 'pl')) = 1,
  'FL974-R rollback przywraca definicje sprzed 0194');
rollback;
select pg_temp.assert(
  to_regprocedure('public.locations_within_radius(text,integer)') is not null
  and exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'jobs' and column_name = 'work_time'),
  'FL974-R2 rollback testu cofnięty');
\echo 'FL974-R rollback 0194: PASS'
