-- =============================================================================
-- BN976-R — rollback migracji 0229 (strukturalne świadczenia oferty, #826). Uruchamiany przez
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
  values ('b9760000-0000-4000-8000-00000000f000', 'BN976-R Firma', 'verified');
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,
                        published_at,benefit_codes,work_time,shift_patterns) values
  ('b9760000-0000-4000-8000-00000000f001','b9760000-0000-4000-8000-00000000f000','bn976r-a','Rollback BN976R','warehouse','permanent','Gent','Flandria','active','pl', now(), array['eco_vouchers'], 'part_time', array['night']),
  ('b9760000-0000-4000-8000-00000000f002','b9760000-0000-4000-8000-00000000f000','bn976r-b','Rollback BN976R','warehouse','permanent','Gent','Flandria','active','pl', now(), '{}', null, null);
-- Przed rollbackiem: filtr 0229 działa.
select pg_temp.assert(
  public.get_public_jobs_count('pl', 'bn976r', p_benefits => array['eco_vouchers']) = 1
  and public.get_public_jobs_count('pl', 'bn976r', p_shift_patterns => array['night'], p_benefits => array['eco_vouchers']) = 1
  and public.get_public_jobs_count('pl', 'bn976r', p_shift_patterns => array['weekend'], p_benefits => array['eco_vouchers']) = 0
  and (select codes from public.get_public_job_benefits('b9760000-0000-4000-8000-00000000f001', 'pl')) = array['eco_vouchers'],
  'BN976-R0 stan przed rollbackiem');

set constraints all immediate;
\ir ../rollback/0229_job_benefits.down.sql

-- Po rollbacku: sygnatury i zachowanie DOKŁADNIE stanu 0227 (grafik pracy i filtry 0194 działają).
select pg_temp.assert(
  to_regprocedure('public.get_public_jobs(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,integer,integer,text,boolean,text,text,text,text,integer,text[])') is not null
  and to_regprocedure('public.get_public_jobs(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,integer,integer,text,boolean,text,text,text,text,integer,text[],text[])') is null
  and to_regprocedure('public.get_public_jobs(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,integer,integer,text,boolean,text,text,text,text,integer)') is null
  and to_regprocedure('public.get_public_jobs_count(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean,text,text,text,text,integer,text[])') is not null
  and to_regprocedure('public.get_public_jobs_count(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean,text,text,text,text,integer,text[],text[])') is null
  and to_regprocedure('public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean,text,text,text,text,integer,text[])') is not null
  and to_regprocedure('public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean,text,text,text,text,integer,text[],text[])') is null
  and to_regprocedure('public.saved_search_jobs_after(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,timestamptz,uuid,integer,boolean,text,text,text,text,integer,text[])') is not null
  and to_regprocedure('public.saved_search_jobs_after(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,timestamptz,uuid,integer,boolean,text,text,text,text,integer,text[],text[])') is null
  and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('get_public_jobs', 'get_public_jobs_count', 'get_public_job_filter_facets', 'saved_search_jobs_after')) = 4
  and to_regprocedure('public.get_public_job_benefits(uuid,text)') is null
  and to_regprocedure('public.job_effective_benefits(text[],boolean,numeric)') is null
  and to_regprocedure('public.get_public_job_shift_patterns(uuid)') is not null
  and not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'jobs' and column_name = 'benefit_codes')
  and public.get_public_jobs_count('pl', 'bn976r') = 2
  and public.get_public_jobs_count('pl', 'bn976r', p_work_time => 'part_time') = 1
  and public.get_public_jobs_count('pl', 'bn976r', p_shift_patterns => array['night']) = 1
  and position('benefit_codes' in pg_get_functiondef('public.save_job_draft(uuid,jsonb,timestamptz)'::regprocedure)) = 0
  and position('benefit_codes' in pg_get_functiondef('public.update_published_job(uuid,jsonb,timestamptz)'::regprocedure)) = 0
  and position('shift_patterns' in pg_get_functiondef('public.save_job_draft(uuid,jsonb,timestamptz)'::regprocedure)) > 0
  and position('shift_patterns' in pg_get_functiondef('public.update_published_job(uuid,jsonb,timestamptz)'::regprocedure)) > 0
  and position('work_mode' in pg_get_functiondef('public.save_job_draft(uuid,jsonb,timestamptz)'::regprocedure)) > 0
  and position('work_mode' in pg_get_functiondef('public.update_published_job(uuid,jsonb,timestamptz)'::regprocedure)) > 0
  and position('work_mode' in pg_get_functiondef('public.job_edit_audit_snapshot(public.jobs)'::regprocedure)) > 0
  and position('benefit_codes' in pg_get_functiondef('public.job_edit_audit_snapshot(public.jobs)'::regprocedure)) = 0
  and position('shiftPatterns' in pg_get_functiondef('public.saved_search_canonical_filters(jsonb,text)'::regprocedure)) > 0
  and position('''benefits''' in pg_get_functiondef('public.saved_search_canonical_filters(jsonb,text)'::regprocedure)) = 0,
  'BN976-R rollback przywraca definicje stanu 0227 (listy) i 0228 (kreator, edycja, audyt)');
rollback;
select pg_temp.assert(
  to_regprocedure('public.get_public_job_benefits(uuid,text)') is not null
  and exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'jobs' and column_name = 'benefit_codes'),
  'BN976-R2 rollback testu cofnięty');
\echo 'BN976-R rollback 0229: PASS'
